#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  SyncTool macOS Installer
#  Usage:  bash install-macos.sh
#  Or via curl:  curl -fsSL https://yourdomain.com/install.sh | bash
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

APP_NAME="SyncTool"
APP_ID="com.synctool"
INSTALL_DIR="$HOME/.synctool"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/SyncTool"
DATA_DIR="$HOME/Library/Application Support/SyncTool"
NODE_VERSION="20"          # minimum Node.js major version
REQUIRED_DISK_MB=200

# ── Colours ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${BLUE}→${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✗${RESET} $*" >&2; exit 1; }
header()  { echo -e "\n${BOLD}$*${RESET}"; }

# ── Banner ────────────────────────────────────────────────────────────────────

echo -e "${BOLD}"
echo "  ╔═══════════════════════════════╗"
echo "  ║   SyncTool Installer  v0.1    ║"
echo "  ╚═══════════════════════════════╝"
echo -e "${RESET}"

# ── Preflight checks ──────────────────────────────────────────────────────────

header "Checking prerequisites..."

# macOS only
[[ "$(uname -s)" == "Darwin" ]] || error "This installer is for macOS only."

# Disk space
AVAILABLE_MB=$(df -m "$HOME" | awk 'NR==2 {print $4}')
(( AVAILABLE_MB >= REQUIRED_DISK_MB )) || error "Need at least ${REQUIRED_DISK_MB}MB free. Found ${AVAILABLE_MB}MB."

# ── Node.js ───────────────────────────────────────────────────────────────────

header "Checking Node.js..."

install_node() {
    info "Installing Node.js ${NODE_VERSION} via Homebrew..."
    if ! command -v brew &>/dev/null; then
        info "Installing Homebrew first..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add brew to PATH for Apple Silicon
        [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    brew install node@${NODE_VERSION}
    # Brew installs node@20 without linking by default
    brew link --overwrite node@${NODE_VERSION} 2>/dev/null || true
}

NODE_BIN=""
if command -v node &>/dev/null; then
    INSTALLED_MAJOR=$(node --version | grep -oE '[0-9]+' | head -1)
    if (( INSTALLED_MAJOR >= NODE_VERSION )); then
        NODE_BIN=$(command -v node)
        success "Node.js $(node --version) found at $NODE_BIN"
    else
        warn "Node.js $INSTALLED_MAJOR is too old (need $NODE_VERSION+)"
        install_node
        NODE_BIN=$(command -v node)
    fi
elif [[ -f "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$HOME/.nvm/nvm.sh"
    nvm install "$NODE_VERSION" --lts
    nvm use "$NODE_VERSION"
    NODE_BIN=$(command -v node)
    success "Node.js installed via nvm: $(node --version)"
else
    install_node
    NODE_BIN=$(command -v node)
    success "Node.js installed: $(node --version)"
fi

# ── pnpm ──────────────────────────────────────────────────────────────────────

header "Checking pnpm..."

if ! command -v pnpm &>/dev/null; then
    info "Installing pnpm..."
    curl -fsSL https://get.pnpm.io/install.sh | sh -
    export PNPM_HOME="$HOME/.local/share/pnpm"
    export PATH="$PNPM_HOME:$PATH"
fi
success "pnpm $(pnpm --version) found"

# ── Install app ───────────────────────────────────────────────────────────────

header "Installing SyncTool..."

# Determine source: running from git repo or from a downloaded bundle?
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -f "$REPO_ROOT/package.json" ]] && grep -q '"name": "sync-tool"' "$REPO_ROOT/package.json" 2>/dev/null; then
    # Running from the repo — install in-place
    info "Using existing repo at $REPO_ROOT"
    APP_SOURCE="$REPO_ROOT"
else
    # Downloading from release
    RELEASE_URL="${SYNCTOOL_RELEASE_URL:-https://github.com/yourusername/sync-tool/archive/refs/heads/main.tar.gz}"
    TMP_DIR=$(mktemp -d)
    info "Downloading SyncTool..."
    curl -fsSL "$RELEASE_URL" -o "$TMP_DIR/synctool.tar.gz"
    tar -xzf "$TMP_DIR/synctool.tar.gz" -C "$TMP_DIR"
    APP_SOURCE=$(find "$TMP_DIR" -name "package.json" -maxdepth 3 | head -1 | xargs dirname)
    rm -rf "$TMP_DIR/synctool.tar.gz"
fi

# Create install directory
mkdir -p "$INSTALL_DIR"

# Copy app files (exclude dev artifacts)
rsync -a \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='.data' \
    --exclude='.git' \
    "$APP_SOURCE/" "$INSTALL_DIR/app/"

info "Installing dependencies..."
cd "$INSTALL_DIR/app"
pnpm install --frozen-lockfile 2>&1 | tail -3

info "Building TypeScript..."
pnpm -r build 2>&1 | grep -E '(error|warning|✓|Done)' || true

success "App installed to $INSTALL_DIR"

# ── Create directories ────────────────────────────────────────────────────────

mkdir -p "$LOG_DIR"
mkdir -p "$DATA_DIR"
mkdir -p "$LAUNCH_AGENTS_DIR"

# ── Generate stable device ID ─────────────────────────────────────────────────

DEVICE_ID_FILE="$DATA_DIR/device-id"
if [[ -f "$DEVICE_ID_FILE" ]]; then
    DEVICE_ID=$(cat "$DEVICE_ID_FILE")
    info "Existing device ID: $DEVICE_ID"
else
    DEVICE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
    echo "$DEVICE_ID" > "$DEVICE_ID_FILE"
    success "Generated device ID: $DEVICE_ID"
fi

# ── Install LaunchAgents ──────────────────────────────────────────────────────

header "Setting up background services..."

install_plist() {
    local label="$1"
    local plist_src="$INSTALL_DIR/app/scripts/launchd/${label}.plist"
    local plist_dst="$LAUNCH_AGENTS_DIR/${label}.plist"

    # Substitute placeholders with real paths
    sed \
        -e "s|INSTALL_DIR_PLACEHOLDER|$INSTALL_DIR|g" \
        -e "s|HOME_PLACEHOLDER|$HOME|g" \
        -e "s|DEVICE_ID_PLACEHOLDER|$DEVICE_ID|g" \
        -e "s|INSTALL_DIR_PLACEHOLDER/bin/node|$NODE_BIN|g" \
        "$plist_src" > "$plist_dst"

    # Unload if already running (update scenario)
    launchctl unload "$plist_dst" 2>/dev/null || true
    # Load
    launchctl load -w "$plist_dst"
    success "Loaded $label"
}

install_plist "com.synctool.api"
install_plist "com.synctool.agent"

# ── Wait for API to start ─────────────────────────────────────────────────────

header "Starting services..."

MAX_WAIT=20
WAITED=0
until curl -sf http://localhost:3001/api/health &>/dev/null; do
    if (( WAITED >= MAX_WAIT )); then
        warn "API server did not start in ${MAX_WAIT}s. Check logs:"
        warn "  tail -f $LOG_DIR/api.error.log"
        break
    fi
    sleep 1
    (( WAITED++ ))
    printf "  Waiting for API server... %ds\r" "$WAITED"
done

if curl -sf http://localhost:3001/api/health &>/dev/null; then
    success "API server is running at http://localhost:3001"
fi

# ── Write CLI helper ──────────────────────────────────────────────────────────

header "Installing synctool CLI..."

CLI_DIR="$HOME/.local/bin"
mkdir -p "$CLI_DIR"

cat > "$CLI_DIR/synctool" << HEREDOC
#!/usr/bin/env bash
# SyncTool CLI helper
SYNCTOOL_API="http://localhost:3001"

case "\$1" in
  start)
    launchctl load -w "$LAUNCH_AGENTS_DIR/com.synctool.api.plist"
    launchctl load -w "$LAUNCH_AGENTS_DIR/com.synctool.agent.plist"
    echo "SyncTool started."
    ;;
  stop)
    launchctl unload "$LAUNCH_AGENTS_DIR/com.synctool.api.plist"
    launchctl unload "$LAUNCH_AGENTS_DIR/com.synctool.agent.plist"
    echo "SyncTool stopped."
    ;;
  restart)
    "\$0" stop; sleep 1; "\$0" start
    ;;
  status)
    echo "API:   \$(launchctl list | grep -q com.synctool.api   && echo running || echo stopped)"
    echo "Agent: \$(launchctl list | grep -q com.synctool.agent && echo running || echo stopped)"
    curl -sf \$SYNCTOOL_API/api/health | python3 -m json.tool 2>/dev/null || echo "(API not responding)"
    ;;
  log)
    tail -f "$LOG_DIR/\${2:-api}.log"
    ;;
  open)
    open http://localhost:3001
    ;;
  uninstall)
    bash "$INSTALL_DIR/app/scripts/uninstall-macos.sh"
    ;;
  *)
    echo "Usage: synctool [start|stop|restart|status|log [api|agent]|open|uninstall]"
    ;;
esac
HEREDOC

chmod +x "$CLI_DIR/synctool"

# Add to PATH if needed
SHELL_RC=""
[[ "$SHELL" == *zsh  ]] && SHELL_RC="$HOME/.zshrc"
[[ "$SHELL" == *bash ]] && SHELL_RC="$HOME/.bash_profile"

if [[ -n "$SHELL_RC" ]] && ! grep -q "/.local/bin" "$SHELL_RC" 2>/dev/null; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
    info "Added ~/.local/bin to PATH in $SHELL_RC"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║   SyncTool installed successfully!    ║${RESET}"
echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Web UI:${RESET}    http://localhost:3001"
echo -e "  ${BOLD}Device ID:${RESET} $DEVICE_ID"
echo -e "  ${BOLD}Data:${RESET}      $DATA_DIR"
echo -e "  ${BOLD}Logs:${RESET}      $LOG_DIR"
echo ""
echo -e "  ${BOLD}CLI commands:${RESET}"
echo "    synctool status     — check if running"
echo "    synctool log api    — tail API log"
echo "    synctool open       — open web UI"
echo "    synctool uninstall  — remove everything"
echo ""

# Open the web UI
if curl -sf http://localhost:3001/api/health &>/dev/null; then
    open "http://localhost:3001" 2>/dev/null || true
fi
