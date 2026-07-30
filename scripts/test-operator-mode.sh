#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${MAT_OPERATOR_API_PORT:-13070}"
FRONTEND_PORT="${MAT_OPERATOR_FRONTEND_PORT:-13071}"
PG_PORT="${MAT_OPERATOR_PG_PORT:-15432}"
CONTAINER_NAME="mat-operator-test-pg-$$"
LOG_DIR="${TMPDIR:-/tmp}/mat-operator-test-$$"
API_PID=""
FRONTEND_PID=""

mkdir -p "$LOG_DIR"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  [[ -n "$FRONTEND_PID" ]] && kill -- "-$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$API_PID" ]] && kill -- "-$API_PID" 2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && wait "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$API_PID" ]] && wait "$API_PID" 2>/dev/null || true
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  if [[ $exit_code -ne 0 ]]; then
    echo "Operator Mode test failed. Logs:"
    echo "  API:      $LOG_DIR/api.log"
    echo "  Frontend: $LOG_DIR/frontend.log"
  else
    rm -rf "$LOG_DIR"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

cd "$ROOT_DIR"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is required for the temporary PostgreSQL test database." >&2
  exit 1
fi
if [[ ! -x node_modules/.bin/tsx || ! -x node_modules/.bin/playwright ]]; then
  echo "Dependencies are missing. Run: corepack yarn install --immutable" >&2
  exit 1
fi
if ! command -v setsid >/dev/null; then
  echo "setsid is required to isolate and clean up test process groups." >&2
  exit 1
fi

for port in "$API_PORT" "$FRONTEND_PORT" "$PG_PORT"; do
  if command -v ss >/dev/null && ss -ltn "sport = :$port" | grep -q LISTEN; then
    echo "Port $port is already in use. Override MAT_OPERATOR_*_PORT or stop the process." >&2
    exit 1
  fi
done

echo "[1/4] Starting temporary PostgreSQL on 127.0.0.1:$PG_PORT"
docker run -d \
  --name "$CONTAINER_NAME" \
  --tmpfs /var/lib/postgresql/data:rw,size=256m \
  -e POSTGRES_USER=matop \
  -e POSTGRES_PASSWORD=matop_test_only \
  -e POSTGRES_DB=matop \
  -p "127.0.0.1:$PG_PORT:5432" \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U matop >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec "$CONTAINER_NAME" pg_isready -U matop >/dev/null 2>&1; then
  echo "PostgreSQL did not become ready." >&2
  exit 1
fi

echo "[2/4] Starting feature API on 127.0.0.1:$API_PORT"
setsid env \
  DB_HOST=127.0.0.1 \
  DB_PORT="$PG_PORT" \
  DB_USER=matop \
  DB_PASSWORD=matop_test_only \
  DB_NAME=matop \
  PORT="$API_PORT" \
  ENABLE_TEST_ENDPOINTS=true \
  NODE_ENV=test \
  MAP_IMAGES_DIR="$LOG_DIR/map-images" \
  SESSION_SECRET=operator-test-session \
  SERVER_TOKEN=operator-test-server \
  PUBLIC_URL="http://127.0.0.1:$API_PORT" \
  node_modules/.bin/tsx api/src/index.ts >"$LOG_DIR/api.log" 2>&1 &
API_PID=$!

for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "API exited before becoming ready." >&2
    exit 1
  fi
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
  echo "API did not become ready." >&2
  exit 1
fi

echo "[3/4] Starting frontend on 127.0.0.1:$FRONTEND_PORT"
setsid env VITE_API_PROXY_TARGET="http://127.0.0.1:$API_PORT" \
  corepack yarn workspace @matchzy/client dev --host 127.0.0.1 --port "$FRONTEND_PORT" \
  >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:$FRONTEND_PORT/" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "Frontend exited before becoming ready." >&2
    exit 1
  fi
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:$FRONTEND_PORT/" >/dev/null 2>&1; then
  echo "Frontend did not become ready." >&2
  exit 1
fi

echo "[4/4] Verifying Assisted queue, 1→3→4→2, veto gate, and Control Room UI"
PLAYWRIGHT_BASE_URL="http://127.0.0.1:$API_PORT" \
FRONTEND_BASE_URL="http://127.0.0.1:$FRONTEND_PORT" \
TEST_SERVER_TOKEN=operator-test-server \
SKIP_WEBSERVER=1 \
  node_modules/.bin/playwright test \
  -c tests/playwright.config.ts \
  tests/api/operator-control.spec.ts \
  --reporter=line

echo "Operator Mode acceptance test passed."
