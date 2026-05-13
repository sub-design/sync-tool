#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  SyncTool Uninstaller for macOS
#  Usage: synctool uninstall
#         OR: bash ~/.synctool/app/scripts/uninstall-macos.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "  → $*"; }
success() { echo -e "  ${GREEN}✓${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET}  $*"; }

echo ""
echo -e "${BOLD}Uninstalling SyncTool...${RESET}"
echo ""

# Prompt for confirmation
read -rp "  This will stop services and remove all SyncTool files. Continue? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# Keep data?
read -rp "  Delete your sync jobs and settings too? [y/N] " DELETE_DATA

echo ""

# ── Stop and remove LaunchAgents ──────────────────────────────────────────────

for label in com.synctool.api com.synctool.agent; do
    plist="$HOME/Library/LaunchAgents/${label}.plist"
    if [[ -f "$plist" ]]; then
        launchctl unload "$plist" 2>/dev/null || true
        rm -f "$plist"
        success "Removed $label"
    fi
done

# ── Remove app files ──────────────────────────────────────────────────────────

if [[ -d "$HOME/.synctool" ]]; then
    rm -rf "$HOME/.synctool"
    success "Removed ~/.synctool"
fi

# ── Remove CLI ────────────────────────────────────────────────────────────────

if [[ -f "$HOME/.local/bin/synctool" ]]; then
    rm -f "$HOME/.local/bin/synctool"
    success "Removed synctool CLI"
fi

# ── Remove logs ───────────────────────────────────────────────────────────────

if [[ -d "$HOME/Library/Logs/SyncTool" ]]; then
    rm -rf "$HOME/Library/Logs/SyncTool"
    success "Removed logs"
fi

# ── Remove data (optional) ────────────────────────────────────────────────────

if [[ "$DELETE_DATA" =~ ^[Yy]$ ]]; then
    DATA_DIR="$HOME/Library/Application Support/SyncTool"
    if [[ -d "$DATA_DIR" ]]; then
        rm -rf "$DATA_DIR"
        success "Removed data and settings"
    fi
else
    warn "Keeping data at: $HOME/Library/Application Support/SyncTool"
    warn "(Delete manually if you want a clean slate)"
fi

echo ""
echo -e "${GREEN}${BOLD}SyncTool uninstalled.${RESET}"
echo ""
