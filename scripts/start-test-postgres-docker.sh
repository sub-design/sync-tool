#!/usr/bin/env bash
set -euo pipefail

NAME="${SYNC_TOOL_TEST_POSTGRES_NAME:-sync-tool-test-postgres}"
PORT="${SYNC_TOOL_TEST_POSTGRES_PORT:-55432}"
IMAGE="${SYNC_TOOL_TEST_POSTGRES_IMAGE:-postgres:16-alpine}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not available" >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker start "$NAME" >/dev/null
else
  docker run -d \
    --name "$NAME" \
    -e POSTGRES_DB=sync_tool \
    -e POSTGRES_HOST_AUTH_METHOD=trust \
    -p "127.0.0.1:${PORT}:5432" \
    "$IMAGE" >/dev/null
fi

until docker exec "$NAME" pg_isready -U postgres -d sync_tool >/dev/null 2>&1; do
  sleep 0.2
done

echo "DATABASE_URL=postgresql://postgres@127.0.0.1:${PORT}/sync_tool"
