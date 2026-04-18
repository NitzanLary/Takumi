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
echo ""
echo "Press Ctrl+C to stop all services."

# Wait and cleanup
cleanup() {
    echo ""
    echo "==> Shutting down..."
    kill $API_PID $WEB_PID 2>/dev/null
    wait $API_PID 2>/dev/null
    wait $WEB_PID 2>/dev/null
    echo "==> All services stopped."
    exit 0
}
trap cleanup INT TERM
wait
