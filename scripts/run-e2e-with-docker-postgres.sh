#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cleanup() {
  if [[ "${KEEP_TEST_POSTGRES:-false}" != "true" ]]; then
    scripts/stop-test-postgres-docker.sh
  fi
}
trap cleanup EXIT

DATABASE_URL="$(scripts/start-test-postgres-docker.sh | tail -1 | cut -d= -f2-)"
export DATABASE_URL

pnpm build:engine
pnpm test:e2e
