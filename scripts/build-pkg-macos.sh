#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Build SyncTool.pkg — native macOS installer package
#  Run this on a Mac with Xcode Command Line Tools installed.
#
#  Requirements:
#    - macOS 12+
#    - Xcode CLT: xcode-select --install
#    - pnpm
#    - (optional) Apple Developer ID for signing + notarization
#
#  Output: dist/SyncTool-0.1.0.pkg
#
#  To sign + notarize (requires Apple Developer account):
#    export DEVELOPER_ID="Developer ID Installer: Your Name (TEAMID)"
#    export APPLE_ID="you@example.com"
#    export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # app-specific password
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

VERSION="0.1.0"
BUNDLE_ID="com.synctool"
DIST_DIR="$(pwd)/dist"
PKG_ROOT="$(pwd)/.pkg-root"
PKG_SCRIPTS="$(pwd)/scripts/installer/scripts"

GREEN='\033[0;32m'; BOLD='\033[1m'; RESET='\033[0m'
step() { echo -e "\n${BOLD}▶ $*${RESET}"; }
ok()   { echo -e "${GREEN}✓${RESET} $*"; }

# ── Sanity checks ─────────────────────────────────────────────────────────────

[[ "$(uname -s)" == "Darwin" ]] || { echo "Must run on macOS."; exit 1; }
command -v pkgbuild    &>/dev/null || { echo "pkgbuild not found. Install Xcode CLT."; exit 1; }
command -v productbuild &>/dev/null || { echo "productbuild not found. Install Xcode CLT."; exit 1; }
command -v pnpm        &>/dev/null || { echo "pnpm not found."; exit 1; }

# ── Build TypeScript ──────────────────────────────────────────────────────────

step "Building TypeScript..."
pnpm install --frozen-lockfile
pnpm -r build
ok "Build complete"

# ── Determine Node.js path ────────────────────────────────────────────────────

NODE_BIN=$(command -v node)
NODE_DIR=$(dirname "$NODE_BIN")    # e.g. /opt/homebrew/bin or /usr/local/bin
ok "Node.js: $NODE_BIN"

# ── Build package root filesystem ─────────────────────────────────────────────
#
#  The .pkg will install to:
#    /usr/local/share/synctool/   — app files
#    /usr/local/bin/synctool      — CLI symlink (written by postinstall)
#
#  LaunchAgents are written per-user in the postinstall script, since
#  we don't know the username at build time.

step "Building package root..."

rm -rf "$PKG_ROOT"
mkdir -p "$PKG_ROOT/usr/local/share/synctool/app"

# Copy app (no dev artifacts)
rsync -a \
    --exclude='node_modules/.cache' \
    --exclude='.data' \
    --exclude='.git' \
    --exclude='*.map' \
    . "$PKG_ROOT/usr/local/share/synctool/app/"

# Copy the LaunchAgent templates (postinstall will personalise and load them)
mkdir -p "$PKG_ROOT/usr/local/share/synctool/launchd"
cp scripts/launchd/*.plist "$PKG_ROOT/usr/local/share/synctool/launchd/"

ok "Package root at $PKG_ROOT"

# ── Build component .pkg ──────────────────────────────────────────────────────

step "Building component package..."

mkdir -p "$DIST_DIR"

pkgbuild \
    --root "$PKG_ROOT" \
    --scripts "$PKG_SCRIPTS" \
    --identifier "${BUNDLE_ID}.pkg" \
    --version "$VERSION" \
    --install-location "/" \
    "$DIST_DIR/synctool-component.pkg"

ok "Component package built"

# ── Build distribution .pkg ───────────────────────────────────────────────────

step "Building distribution package..."

productbuild \
    --distribution scripts/installer/Distribution.xml \
    --package-path "$DIST_DIR" \
    --resources scripts/installer/resources \
    "$DIST_DIR/SyncTool-${VERSION}-unsigned.pkg"

ok "Distribution package built"

# ── Sign (optional) ───────────────────────────────────────────────────────────

OUTPUT_PKG="$DIST_DIR/SyncTool-${VERSION}.pkg"

if [[ -n "${DEVELOPER_ID:-}" ]]; then
    step "Signing with Developer ID..."
    productsign \
        --sign "$DEVELOPER_ID" \
        "$DIST_DIR/SyncTool-${VERSION}-unsigned.pkg" \
        "$OUTPUT_PKG"
    ok "Signed: $OUTPUT_PKG"
else
    mv "$DIST_DIR/SyncTool-${VERSION}-unsigned.pkg" "$OUTPUT_PKG"
    echo ""
    echo "  ⚠  Not signed (no DEVELOPER_ID set)."
    echo "     Users will need to right-click → Open to bypass Gatekeeper."
    echo "     To sign: export DEVELOPER_ID=\"Developer ID Installer: Name (TEAM)\""
fi

# ── Notarize (optional) ───────────────────────────────────────────────────────

if [[ -n "${DEVELOPER_ID:-}" && -n "${APPLE_ID:-}" ]]; then
    step "Notarizing (this takes 1–5 minutes)..."
    xcrun notarytool submit "$OUTPUT_PKG" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_APP_PASSWORD" \
        --team-id "${TEAM_ID:-$(echo "$DEVELOPER_ID" | grep -oE '\([A-Z0-9]+\)' | tr -d '()')}" \
        --wait
    xcrun stapler staple "$OUTPUT_PKG"
    ok "Notarized and stapled"
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────

rm -rf "$PKG_ROOT"
rm -f "$DIST_DIR/synctool-component.pkg"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}Done!${RESET}"
echo ""
echo "  Package: $OUTPUT_PKG"
echo "  Size:    $(du -sh "$OUTPUT_PKG" | cut -f1)"
echo ""
echo "  Test it:  open \"$OUTPUT_PKG\""
echo "  Distribute: upload to GitHub Releases, your website, etc."
