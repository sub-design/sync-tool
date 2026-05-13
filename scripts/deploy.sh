#!/usr/bin/env bash
# deploy.sh — one-shot deployment: Railway (API) + Vercel (web)
# Usage: bash scripts/deploy.sh

set -e

# ── Colors ────────────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step()  { echo -e "\n${BOLD}${BLUE}▶ $*${NC}"; }
ok()    { echo -e "${GREEN}✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $*${NC}"; }
fail()  { echo -e "${RED}✗ $*${NC}"; exit 1; }
ask()   { echo -e "${BOLD}$*${NC}"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo -e "\n${BOLD}Sync Tool — Deploy${NC}"
echo "This script will deploy:"
echo "  • API   → Railway  (Express + PostgreSQL)"
echo "  • Web   → Vercel   (React SPA)"
echo ""

# ── 1. Install CLIs ───────────────────────────────────────────────────────────
step "1/7  Checking CLIs"

if ! command -v railway &>/dev/null; then
  echo "Installing Railway CLI..."
  if command -v brew &>/dev/null; then
    brew install railway
  else
    curl -fsSL https://cli.new | sh
  fi
fi
command -v railway &>/dev/null || fail "Railway CLI install failed. Run manually: brew install railway"
ok "Railway CLI: $(railway --version 2>/dev/null | head -1)"

if ! command -v vercel &>/dev/null; then
  echo "Installing Vercel CLI..."
  if command -v brew &>/dev/null; then
    brew install vercel-cli
  else
    pnpm add -g vercel
  fi
fi
command -v vercel &>/dev/null || fail "Vercel CLI install failed. Run manually: brew install vercel-cli"
ok "Vercel CLI:  $(vercel --version 2>/dev/null | head -1)"

# ── 2. Railway login ──────────────────────────────────────────────────────────
step "2/7  Railway — login"
echo "Opening browser for Railway authentication..."
railway login
ok "Logged in to Railway"

# ── 3. Railway project ────────────────────────────────────────────────────────
step "3/7  Railway — create project"

ask "Enter a name for your Railway project (e.g. sync-tool):"
read -r PROJECT_NAME
[ -z "$PROJECT_NAME" ] && PROJECT_NAME="sync-tool"

railway init --name "$PROJECT_NAME"
ok "Railway project '$PROJECT_NAME' created"

# ── 4. PostgreSQL ─────────────────────────────────────────────────────────────
step "4/7  Railway — provision PostgreSQL"
echo ""
echo "Opening Railway dashboard — you need to add a PostgreSQL database manually:"
echo ""
echo "  1. In your project, click  '+ New'  →  'Database'  →  'PostgreSQL'"
echo "  2. Wait ~30 seconds for it to start"
echo "  3. Click the PostgreSQL service → 'Variables' tab"
echo "  4. Copy the value of  DATABASE_URL"
echo ""
echo "Tip: Railway will auto-inject DATABASE_URL into your API service."
echo ""
open "https://railway.app/dashboard" 2>/dev/null || true

ask "Paste your DATABASE_URL here (postgresql://...):"
read -r DATABASE_URL
[ -z "$DATABASE_URL" ] && fail "DATABASE_URL is required"

# ── 5. Generate JWT secret + set env vars ────────────────────────────────────
step "5/7  Railway — set environment variables"

JWT_SECRET="$(openssl rand -hex 32)"

railway variables set \
  DATABASE_URL="$DATABASE_URL" \
  JWT_SECRET="$JWT_SECRET" \
  NODE_ENV="production"

ok "DATABASE_URL set"
ok "JWT_SECRET set  (auto-generated)"
echo ""
warn "Save this JWT_SECRET — you'll need it if you recreate the service:"
echo "  $JWT_SECRET"

# ── 6. Deploy API ─────────────────────────────────────────────────────────────
step "6/7  Railway — deploy API"
echo "Building and deploying (this takes ~2 minutes)..."
railway up --detach

# Get the deployed URL
echo "Fetching deployment URL..."
sleep 10  # let Railway register the deployment
API_URL="$(railway status --json 2>/dev/null | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"

if [ -z "$API_URL" ]; then
  warn "Could not auto-detect URL. Check Railway dashboard for the domain."
  ask "Paste your Railway API URL (e.g. https://sync-tool-api.up.railway.app):"
  read -r API_URL
fi

API_URL="${API_URL%/}"   # remove trailing slash
WS_URL="${API_URL/https:\/\//wss://}"
WS_URL="${WS_URL/http:\/\//ws://}"

ok "API URL: $API_URL"

# ── 7. Deploy Web to Vercel ──────────────────────────────────────────────────
step "7/7  Vercel — deploy web"
cd "$ROOT/packages/web"

echo "Logging in to Vercel..."
vercel login

echo "Deploying to production..."
vercel \
  --prod \
  --yes \
  --env "VITE_API_URL=$API_URL" \
  --env "VITE_WS_URL=$WS_URL"

WEB_URL="$(vercel ls --scope "$(vercel whoami)" 2>/dev/null | grep "sync-tool\|web" | head -1 | awk '{print $2}' || true)"

# ── Done ──────────────────────────────────────────────────────────────────────
cd "$ROOT"
echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  Deployment complete!${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  API     →  ${BOLD}${API_URL}${NC}"
[ -n "$WEB_URL" ] && echo -e "  Web UI  →  ${BOLD}https://${WEB_URL}${NC}"
echo ""
echo "Next steps:"
echo "  1. Open the Web UI and create your account (first registration is open)"
echo "  2. Go to Devices → create an agent token"
echo "  3. Open Sync Tool app on your Mac → Preferences"
echo "     Server URL:  $API_URL"
echo "     Agent Token: <paste token>"
echo ""
echo -e "${BOLD}Agent env for other machines:${NC}"
echo "  API_URL=$WS_URL/agent"
echo "  AGENT_TOKEN=<your token>"
