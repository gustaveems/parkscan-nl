#!/usr/bin/env bash
# ParkScan NL — one-command launcher for hackathon judges and developers.
#
# What it does:
#   1. Verifies Node 18+
#   2. Brings up PostGIS via Docker if available (else falls back to in-memory)
#   3. Ensures backend/.env exists (copies from .env.example, prompts for keys)
#   4. Installs deps (Bun if available, else npm) for backend + frontend
#   5. Starts backend on :3001 and frontend on :5173
#   6. Streams logs and traps Ctrl+C to clean up
#
# Without any API keys the product still runs end-to-end on mock providers.

set -euo pipefail

# ── Pretty output ────────────────────────────────────────────────────────────
BOLD="$(printf '\033[1m')"
DIM="$(printf '\033[2m')"
GREEN="$(printf '\033[32m')"
YELLOW="$(printf '\033[33m')"
BLUE="$(printf '\033[34m')"
RED="$(printf '\033[31m')"
RESET="$(printf '\033[0m')"

step()  { printf "${BLUE}▸${RESET} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${RESET} %s\n" "$1"; }
fail()  { printf "${RED}✗${RESET} %s\n" "$1"; exit 1; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── Banner ───────────────────────────────────────────────────────────────────
cat <<'BANNER'

  ██████╗  █████╗ ██████╗ ██╗  ██╗███████╗ ██████╗ █████╗ ███╗   ██╗
  ██╔══██╗██╔══██╗██╔══██╗██║ ██╔╝██╔════╝██╔════╝██╔══██╗████╗  ██║
  ██████╔╝███████║██████╔╝█████╔╝ ███████╗██║     ███████║██╔██╗ ██║
  ██╔═══╝ ██╔══██║██╔══██╗██╔═██╗ ╚════██║██║     ██╔══██║██║╚██╗██║
  ██║     ██║  ██║██║  ██║██║  ██╗███████║╚██████╗██║  ██║██║ ╚████║
  ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═══╝

  Vacancy Intelligence & Parking Conversion — Netherlands
  PDOK / BAG · Kadaster · Google Maps · Gemini · Cloud Vision

BANNER

# ── Step 1: Node version check ───────────────────────────────────────────────
step "Checking Node.js version..."
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js not found. Install Node 18+ from https://nodejs.org and re-run."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node 18+ required (you have $(node -v))."
fi
ok "Node $(node -v) detected"

# ── Step 2: backend/.env ─────────────────────────────────────────────────────
step "Checking backend/.env..."
if [ ! -f "backend/.env" ]; then
  if [ -f "backend/.env.example" ]; then
    cp backend/.env.example backend/.env
    ok "Copied backend/.env.example → backend/.env"
    warn "No API keys set — product will run on MOCK providers."
    echo "  ${DIM}To go live, edit backend/.env and add:${RESET}"
    echo "    GOOGLE_MAPS_API_KEY    (Maps Static + Street View + Places)"
    echo "    GEMINI_API_KEY         (real Dutch outreach emails)"
    echo "    GOOGLE_VISION_API_KEY  (real frontage analysis)"
    echo "  ${DIM}Then re-run ./start.sh${RESET}"
  else
    warn "No backend/.env or .env.example found — using process env only."
  fi
else
  ok "backend/.env exists"
fi

# ── Step 3: Postgres via Docker (optional) ───────────────────────────────────
step "Checking Docker for persistent Postgres..."
USE_DOCKER=false
if [ -f "docker-compose.yml" ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker compose up -d --wait >/dev/null 2>&1; then
    USE_DOCKER=true
    export DATABASE_URL="${DATABASE_URL:-postgres://parkscan:parkscan@localhost:5433/parkscan}"
    ok "PostGIS up on :5433"
  else
    warn "docker compose up failed — falling back to in-memory store"
  fi
else
  warn "Docker not running — falling back to in-memory store (data resets on restart)"
fi

# ── Step 4: install deps (Bun preferred, npm fallback) ───────────────────────
step "Installing backend deps..."
if command -v bun >/dev/null 2>&1; then
  (cd backend && bun install) || fail "backend install failed"
else
  (cd backend && npm install --silent --no-audit --no-fund) || fail "backend npm install failed"
fi
ok "backend deps ready"

step "Installing frontend deps..."
if command -v bun >/dev/null 2>&1; then
  (cd frontend && bun install) || fail "frontend install failed"
else
  (cd frontend && npm install --silent --no-audit --no-fund) || fail "frontend npm install failed"
fi
ok "frontend deps ready"

# ── Step 5: free up ports if needed ──────────────────────────────────────────
free_port() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    warn "Port $port already in use ($label) — killing $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}
free_port 3001 "backend"
free_port 5173 "frontend"

# ── Step 6: launch ───────────────────────────────────────────────────────────
mkdir -p .logs
BACKEND_LOG="$ROOT/.logs/backend.log"
FRONTEND_LOG="$ROOT/.logs/frontend.log"
: > "$BACKEND_LOG"
: > "$FRONTEND_LOG"

step "Starting backend → http://localhost:3001"
if command -v bun >/dev/null 2>&1; then
  (cd backend && bun run start >"$BACKEND_LOG" 2>&1) &
else
  (cd backend && npm start >"$BACKEND_LOG" 2>&1) &
fi
BACKEND_PID=$!

# Wait until backend answers /health (max 15s).
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -sf http://localhost:3001/health >/dev/null 2>&1; then
  warn "Backend slow to come up — check $BACKEND_LOG"
else
  ok "Backend healthy"
fi

step "Starting frontend → http://localhost:5173"
if command -v bun >/dev/null 2>&1; then
  (cd frontend && bun run dev -- --port 5173 --host >"$FRONTEND_LOG" 2>&1) &
else
  (cd frontend && npm run dev -- --port 5173 --host >"$FRONTEND_LOG" 2>&1) &
fi
FRONTEND_PID=$!

sleep 2

# ── Final banner ─────────────────────────────────────────────────────────────
PROVIDERS="$(curl -s http://localhost:3001/api/providers 2>/dev/null || echo '{}')"
echo ""
echo "${BOLD}${GREEN}  ParkScan NL is running.${RESET}"
echo ""
echo "  ${BOLD}Frontend${RESET}  →  ${BLUE}http://localhost:5173${RESET}"
echo "  ${BOLD}Backend${RESET}   →  ${BLUE}http://localhost:3001${RESET}"
echo "  ${BOLD}Health${RESET}    →  ${BLUE}http://localhost:3001/health${RESET}"
echo "  ${BOLD}Providers${RESET} →  ${DIM}${PROVIDERS}${RESET}"
echo ""
if [ "$USE_DOCKER" = true ]; then
  echo "  ${DIM}Postgres logs:${RESET}  docker compose logs -f postgres"
fi
echo "  ${DIM}Backend logs:${RESET}   tail -f .logs/backend.log"
echo "  ${DIM}Frontend logs:${RESET}  tail -f .logs/frontend.log"
echo ""
echo "  ${YELLOW}Press Ctrl+C to stop.${RESET}"
echo ""

# ── Cleanup on exit ──────────────────────────────────────────────────────────
cleanup() {
  echo ""
  step "Stopping..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  ok "Stopped."
  exit 0
}
trap cleanup INT TERM

wait
