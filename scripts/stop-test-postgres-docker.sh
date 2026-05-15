#!/usr/bin/env bash
set -euo pipefail

NAME="${SYNC_TOOL_TEST_POSTGRES_NAME:-sync-tool-test-postgres}"

if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null
fi
