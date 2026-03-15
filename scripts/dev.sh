#!/usr/bin/env bash
# Start all Takumi services for development
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Starting Takumi development environment..."

# Load .env
set -a
source "$ROOT_DIR/.env"
set +a

# Start Python IBI sync service
echo "==> Starting IBI sync service (port 8100)..."
(cd "$ROOT_DIR/services/ibi-sync" && .venv/bin/uvicorn src.server:app --host 0.0.0.0 --port 8100 --reload) &
IBI_PID=$!

# Start Express API
echo "==> Starting API server (port 3001)..."
(cd "$ROOT_DIR" && pnpm --filter @takumi/api dev) &
API_PID=$!

# Start Next.js frontend
echo "==> Starting frontend (port 3000)..."
(cd "$ROOT_DIR" && pnpm --filter @takumi/web dev) &
WEB_PID=$!

echo ""
echo "==> All services running:"
echo "    Frontend:  http://localhost:3000"
echo "    API:       http://localhost:3001"
echo "    IBI Sync:  http://localhost:8100"
echo ""
echo "Press Ctrl+C to stop all services."

# Wait and cleanup
trap "kill $IBI_PID $API_PID $WEB_PID 2>/dev/null; exit" INT TERM
wait
