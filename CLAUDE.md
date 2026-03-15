# Takumi — Personal Trading Intelligence Platform

> **IMPORTANT: Keep this file updated.** Whenever you add new packages, change project structure, modify conventions, add services, create new routes/pages, or shift architectural decisions — update the relevant section of this file immediately so future sessions have accurate context. This is a mandatory part of every task.

## What This Is

A single-user web app for an independent investor (Nitzan) who trades Israeli (TASE) and US (NYSE/NASDAQ) equities through IBI broker. Connects to IBI's reverse-engineered Spark REST API for automatic data sync, provides analytics dashboards, and features a persistent AI chat agent powered by Claude.

The full PRD is in `Takumi_PRD.md` at the project root — refer to it for detailed requirements, agent tool definitions, alert types, and example conversations.

## Architecture

```
Browser (Next.js 14 :3000)  →  Express API (:3001)  →  SQLite (Prisma)
                                       ↕                       ↕
                               Python sidecar (:8100)   Anthropic Claude API
                               (IBI Spark sync)
```

- **Frontend** talks only to Express. Never directly to Python or IBI.
- **Express** is the single gateway — orchestrates sync, analytics, AI, alerts.
- **Python sidecar** handles only IBI auth (Playwright + Auth0 PKCE) and API calls. Communicates with Express over `localhost:8100`.
- **Database** is SQLite for dev (`packages/db/prisma/takumi.db`), PostgreSQL for prod.

## Monorepo Structure

```
takumi/
├── apps/
│   ├── web/                  # Next.js 14, App Router, Tailwind, TanStack Query
│   │   └── src/
│   │       ├── app/          # Pages: dashboard, positions, history, analytics, import, alerts, settings
│   │       ├── components/   # Providers.tsx, layout/Sidebar.tsx, layout/TopBar.tsx
│   │       └── lib/          # api-client.ts, formatters.ts
│   └── api/                  # Express 5, TypeScript, Prisma, node-cron
│       └── src/
│           ├── index.ts      # App entry — registers routes, starts scheduler
│           ├── routes/       # trades.ts, sync.ts
│           ├── services/     # trade.service.ts, sync.service.ts, scheduler.service.ts
│           ├── middleware/    # error-handler.ts
│           ├── lib/          # config.ts, db.ts
│           └── ai/tools/     # (empty — Phase 3)
├── packages/
│   ├── db/                   # Prisma schema + client (shared via @takumi/db)
│   │   └── prisma/schema.prisma
│   └── types/                # Shared TypeScript interfaces (shared via @takumi/types)
│       └── src/              # trade.ts, sync.ts, position.ts, alert.ts, analytics.ts, api.ts
├── services/
│   └── ibi-sync/             # Python FastAPI microservice (venv in .venv/)
│       └── src/
│           ├── server.py     # FastAPI app entry
│           ├── auth/         # pkce.py (Playwright Auth0), jwt_manager.py (15s refresh)
│           ├── api/          # client.py (IBIClient), endpoints.py
│           ├── sync/         # transactions.py, holdings.py (parsers)
│           └── models/       # Pydantic models
├── scripts/
│   ├── dev.sh                # Start all 3 services
│   └── seed.ts               # Populate DB with 12 sample trades
├── .env                      # Local secrets (never committed)
├── .env.example              # Template with all required vars
└── Takumi_PRD.md             # Full product requirements document
```

**Package manager:** pnpm (workspaces) + turbo for orchestration.

## Key Commands

```bash
# Start everything
bash scripts/dev.sh

# Start individual services
pnpm --filter @takumi/api dev          # Express API on :3001
pnpm --filter @takumi/web dev          # Next.js on :3000
cd services/ibi-sync && .venv/bin/uvicorn src.server:app --port 8100  # Python

# Database
pnpm --filter @takumi/db db:generate   # Regenerate Prisma client
pnpm --filter @takumi/db db:push       # Push schema to SQLite
DATABASE_URL="file:/home/nitzan/Takumi/packages/db/prisma/takumi.db" pnpm --filter @takumi/api exec tsx ../../scripts/seed.ts

# Python venv
cd services/ibi-sync && uv pip install -e ".[dev]" --python .venv/bin/python
```

## Environment Variables

All secrets live in `.env` at project root. The API loads it via `dotenv` in `apps/api/src/lib/config.ts`. Required variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Must be an **absolute** `file:` path for SQLite |
| `ANTHROPIC_API_KEY` | Claude API key (Phase 3) |
| `IBI_ACCOUNT_KEY` | `ACC_000-118390` |
| `IBI_AUTH0_CLIENT_ID` | Auth0 client ID for PKCE flow |
| `IBI_USERNAME` / `IBI_PASSWORD` | For automated Auth0 login; if blank, Playwright opens visible browser |
| `IBI_SYNC_URL` | Python sidecar URL (default `http://localhost:8100`) |
| `API_PORT` / `WEB_PORT` | Express (:3001) and Next.js (:3000) ports |

## Database

Schema in `packages/db/prisma/schema.prisma`. SQLite provider, Prisma ORM.

**Tables (9 total):**

| Table | Purpose | Key Notes |
|---|---|---|
| `trades` | All trade records | Unique on `(tradeId, source)` — prevents duplicate imports |
| `securities` | Security reference data | Unique on `ticker` |
| `sync_log` | Sync run history | Indexed by `synced_at DESC` |
| `alerts` | Price/P&L/duration alerts | 6 types: price_drop, price_target, holding_duration, portfolio_pnl, sync_failure, inactivity |
| `market_prices` | Cached market prices | Indexed by `(ticker, fetched_at DESC)` |
| `exchange_rates` | Daily ILS/USD rates | Unique on `date` |
| `ai_conversations` | Chat sessions | Has many `ai_messages` |
| `ai_messages` | Individual chat messages | Role: user/assistant/tool; optional `tool_calls` JSON |
| `user_preferences` | Single-row settings | id="default"; currency, cost basis method, sync intervals |

All monetary fields use `Decimal` (not Float).

## API Routes (Express)

| Method | Route | Handler | Purpose |
|---|---|---|---|
| GET | `/api/health` | inline | Health check |
| GET | `/api/trades` | trades.ts | List trades (paginated, filterable by ticker/market/direction) |
| GET | `/api/sync/status` | sync.ts | Last sync status |
| POST | `/api/sync/trigger` | sync.ts | Trigger manual sync via Python sidecar |

## Frontend Pages

| Route | Status | Description |
|---|---|---|
| `/dashboard` | Scaffold with sync widget + KPI placeholders | Sync button works, KPIs show "—" |
| `/positions` | Stub | Empty page |
| `/history` | **Functional** | Full trade table with filters (ticker/market/direction), pagination |
| `/analytics` | Stub | Empty page |
| `/import` | Stub | Note: PRD renamed this to `/sync` — update in Phase 2 |
| `/alerts` | Stub | Empty page |
| `/settings` | Stub | Empty page |

**Layout:** Sidebar (left, 60px wide) + TopBar (14px tall) + main content. Sidebar nav has 7 items.

## Conventions

- **TypeScript** for all Node.js code (ESM — `"type": "module"` everywhere)
- **File extensions in imports** — always use `.js` in TypeScript import paths (`./lib/config.js`)
- **Shared types** live in `@takumi/types`, not duplicated across apps
- **Prisma client** is re-exported from `@takumi/db` as a singleton (`packages/db/src/index.ts`)
- **API routes** follow `/api/<resource>` pattern
- **Frontend pages** are in `apps/web/src/app/<route>/page.tsx` (Next.js App Router, all `"use client"`)
- **Data fetching** on frontend uses TanStack Query (`useQuery`, `useMutation`)
- **API client** helper in `apps/web/src/lib/api-client.ts` — wraps `fetch` with base URL
- **Python** uses FastAPI + Pydantic models, `httpx` for HTTP, `asyncio` throughout
- **Formatting** helpers in `apps/web/src/lib/formatters.ts` — `formatCurrency`, `formatDate`, `formatNumber`

## IBI Spark API

- Base URL: `https://sparkibi.ordernet.co.il`
- Auth: Auth0 PKCE (one-time Playwright bootstrap) → IBI JWT (4-min TTL)
- JWT refresh: every 15 seconds via `GET /api/Auth/GetAuthData`
- Account key: `ACC_000-118390` (env var, never hardcode)
- API responses may contain Hebrew field names — parsed in `services/ibi-sync/src/sync/transactions.py`
- The exact field names in IBI responses are **not yet confirmed** — parsers have best-guess mappings that need validation against a live API call

**Key endpoints:**
| Endpoint | Purpose |
|---|---|
| `GET /api/Auth/AuthenticateAuth0?token=<TOKEN>` | Exchange Auth0 token for IBI JWT |
| `GET /api/Auth/GetAuthData` | Refresh JWT (call every 15s) |
| `GET /api/Account/GetAccountTransactions` | Historical transactions (full backfill) |
| `GET /api/Account/GetNewAccountTransactions` | Recent transactions (incremental sync) |
| `GET /api/Account/GetAccountSecurities` | Current holdings + live prices |
| `GET /api/Account/GetAccountDailyYields?year=YYYY` | Daily P&L (equity curve) |
| `GET /api/Account/GetAccountMonthlyYields` | Monthly P&L (heatmap) |

## Implementation Status

### Phase 1 — Foundation & IBI Integration ✅ COMPLETE
- [x] Monorepo scaffolding (pnpm workspaces, turbo, TypeScript configs)
- [x] Prisma schema — 9 tables with all indexes and constraints
- [x] Shared types package (`@takumi/types`) — Trade, SyncState, Position, Alert, Analytics, API types
- [x] Express API — health, trades (paginated + filtered), sync status/trigger routes
- [x] Scheduled sync via node-cron (every 30 minutes)
- [x] Sync service orchestration (Express → Python sidecar)
- [x] Next.js frontend — app shell, sidebar, topbar, 7 page routes
- [x] Trade history page — full table with ticker/market/direction filters + pagination
- [x] Dashboard page — sync status widget + manual sync button + KPI card placeholders
- [x] Python IBI sync service — FastAPI server, Auth0 PKCE auth, IBIClient, JWT auto-refresh, transaction/holdings parsers
- [x] Seed script with 12 sample trades
- [x] `.env.example` with all required variables

### Phase 2 — Analytics & Dashboard (NEXT)
See PRD Section 7 + Section 14 "Phase 2" for full requirements. Key deliverables:
- P&L engine (FIFO lot matching), per-ticker breakdown
- Market data service (live prices from IBI `GetAccountSecurities`)
- Dashboard: real KPI cards (total P&L, win rate, total trades, avg return)
- Equity curve chart (Recharts, data from `GetAccountDailyYields`)
- Monthly P&L heatmap (data from `GetAccountMonthlyYields`)
- Positions page with live prices + unrealized P&L
- Analytics page: win rate, behavioral patterns, TASE vs US comparison
- Rename `/import` to `/sync` per PRD

### Phase 3 — AI Agent
- Claude integration with 11 tools (see PRD Section 8.4)
- Persistent chat drawer (right side), SSE streaming
- Conversation history stored in `ai_conversations` / `ai_messages`
- System prompt with live portfolio context

### Phase 4 — Alerts, Import & Settings
- Alert engine (6 types), alert inbox at `/alerts`
- CSV/Excel fallback import
- Settings page (currency, cost basis method, sync schedule)

### Phase 5 — Hardening
- Error boundaries, structured logging
- Docker Compose for all services
- Performance optimization for 5,000+ trades
- E2E tests

## Gotchas

- `DATABASE_URL` must be **absolute** `file:` path — relative paths break when commands run from different directories
- Express `.env` loading uses hardcoded relative path in `config.ts` — update if you move the file
- Python venv is in `services/ibi-sync/.venv/` — not managed by pnpm
- `pnpm-workspace.yaml` has `onlyBuiltDependencies` for prisma and esbuild — add new native packages there if they need build scripts
- Next.js `create-next-app` generated some files we don't use (e.g., `public/` SVGs) — safe to ignore
- Sidebar currently links to `/import` but PRD says this should be `/sync` — fix in Phase 2
- Dashboard KPI cards currently show placeholder "—" values — wire up in Phase 2
- IBI field name mappings in Python parsers are best-guesses — need validation against live API response
