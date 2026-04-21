# Takumi — Personal Trading Intelligence Platform

A single-user web application for an independent investor trading Israeli (TASE) and US (NYSE/NASDAQ) equities through IBI broker. Provides portfolio analytics, live market data, and a persistent AI chat agent powered by Claude.

---

## Features

- **Portfolio analytics** — Realized P&L via FIFO lot matching, open positions, win rate, avg holding period, profit factor, behavioral stats
- **Live market data** — Yahoo Finance (primary), TheMarker Finance (TASE fallback), Stooq (US fallback); 15-minute cache
- **Equity curve** — Daily portfolio snapshots with a chart of portfolio value over time
- **Risk metrics** — Herfindahl concentration index, max drawdown, Sharpe ratio, Sortino ratio
- **XLSX import** — Upload IBI Excel exports; Hebrew column headers parsed, 14 transaction types mapped, duplicate-safe upserts
- **AI agent** — Streaming chat drawer powered by `claude-sonnet-4-20250514` with 21 tools across three tiers (portfolio queries, market data, what-if scenarios, risk reports, and more)
- **Persistent conversations** — Chat history stored in Postgres; conversations resumable across sessions
- **Exchange rates** — Bank of Israel official ILS/USD rates backfilled from first trade date
- **Basic auth** — Single shared credential protects both the web and API services

---

## Architecture

```
Browser  →  Next.js (basic auth)  →  rewrites /api/*  →  Express API  →  PostgreSQL
                                                               ↕
                                                        Anthropic Claude API
                                                        Yahoo Finance / Stooq
                                                        TheMarker Finance (scrape)
                                                        Bank of Israel SDMX API
```

- The browser calls relative `/api/*` URLs. Next.js rewrites them server-side to the private Express service — one auth prompt, no CORS.
- Express is the single backend gateway — it orchestrates import, analytics, market data, snapshots, and AI.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS, TanStack Query, Zustand, Recharts |
| Backend | Express 5, TypeScript (ESM), tsx |
| Database | PostgreSQL (Railway) / SQLite (local dev), Prisma ORM |
| AI | Anthropic Claude (`claude-sonnet-4-20250514`), SSE streaming |
| Market data | yahoo-finance2, Stooq CSV API, TheMarker Finance scrape |
| Monorepo | pnpm workspaces, Turbo |

---

## Project Structure

```
takumi/
├── apps/
│   ├── web/                  # Next.js 14, App Router, Tailwind, TanStack Query
│   │   └── src/
│   │       ├── app/          # Pages: dashboard, positions, history, analytics, import, alerts, settings
│   │       ├── components/   # Sidebar, TopBar, ChatDrawer, MessageBubble, QuickActions
│   │       ├── stores/       # chat-store.ts (Zustand), ui-store.ts
│   │       └── lib/          # api-client.ts, formatters.ts, sse-client.ts
│   └── api/                  # Express 5, TypeScript, Prisma
│       └── src/
│           ├── index.ts      # Entry point — registers all routes
│           ├── routes/       # trades, sync, positions, analytics, market, exchange-rates, snapshots, chat
│           ├── services/     # trade, pnl, position, analytics, market, xlsx-import, snapshot, risk, whatif, …
│           ├── data/         # tase-ticker-map.json, sector-map.json
│           ├── middleware/   # error-handler.ts
│           ├── lib/          # config.ts, db.ts
│           └── ai/           # system-prompt, chat-handler, conversation.service, tools/
├── packages/
│   ├── db/                   # Prisma schema + client (shared as @takumi/db)
│   └── types/                # Shared TypeScript interfaces (shared as @takumi/types)
├── scripts/
│   ├── dev.sh                # Start API + frontend together
│   └── seed.ts               # Populate DB with sample trades
├── docs/
│   └── ai-agent.md
├── .env.example
└── Takumi_PRD.md             # Full product requirements document
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+
- A running PostgreSQL instance (or use SQLite for local dev by changing `DATABASE_URL` in `.env`)
- An Anthropic API key

### Install dependencies

```bash
pnpm install
```

### Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in all required values (see [Environment Variables](#environment-variables) below).

### Set up the database

```bash
# Push schema to the database
pnpm --filter @takumi/db db:push

# (Optional) Seed with sample trades
DATABASE_URL="file:/absolute/path/to/takumi.db" pnpm --filter @takumi/api exec tsx ../../scripts/seed.ts
```

### Start development servers

```bash
bash scripts/dev.sh
```

Or start each service individually:

```bash
pnpm --filter @takumi/api dev    # Express API on :3001
pnpm --filter @takumi/web dev    # Next.js on :3000
```

---

## Environment Variables

All secrets live in `.env` at the project root. The API loads them via `dotenv` in `apps/api/src/lib/config.ts`.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Absolute `file:` path for SQLite, or a PostgreSQL connection string for prod |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for the AI agent |
| `API_PORT` | No | Express port (default `3001`) |
| `WEB_PORT` | No | Next.js port (default `3000`) |
| `API_URL` | No | Web → API proxy target (default `http://localhost:3001`) |
| `CORS_ORIGIN` | No | Allowed CORS origin (default `http://localhost:3000`) |
| `BASIC_AUTH_USER` | No | HTTP Basic Auth username (leave unset in dev to disable auth) |
| `BASIC_AUTH_PASS` | No | HTTP Basic Auth password |

**Note:** `DATABASE_URL` must be an absolute `file:` path for SQLite — relative paths break when commands run from different directories.

---

## Key Commands

```bash
# Run the full monorepo build
pnpm build

# Regenerate Prisma client after schema changes
pnpm --filter @takumi/db db:generate

# Push schema changes to the database (dev/prod)
pnpm --filter @takumi/db db:push

# Run tests
pnpm test

# Lint
pnpm lint
```

---

## API Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/trades` | List trades (paginated, filterable) |
| GET | `/api/positions` | Open positions with live market prices |
| GET | `/api/analytics/summary` | Portfolio KPIs and behavioral stats |
| GET | `/api/analytics/pnl` | P&L by ticker, month, or market |
| GET | `/api/analytics/risk` | Risk metrics (HHI, drawdown, Sharpe, Sortino) |
| POST | `/api/sync/import` | Upload XLSX file for import |
| GET | `/api/sync/status` | Last import status |
| GET | `/api/market/prices` | Cached/fresh prices for specified tickers |
| POST | `/api/market/refresh` | Force-refresh prices for all open positions |
| GET | `/api/market/benchmarks` | TA-125 and S&P 500 latest quotes |
| GET | `/api/exchange-rates` | Current or historical ILS/USD rate |
| GET | `/api/snapshots` | Portfolio snapshots for equity curve |
| POST | `/api/chat` | Send message to AI agent (SSE stream response) |
| GET | `/api/chat/conversations` | List all AI conversations |

---

## Frontend Pages

| Route | Description |
|---|---|
| `/dashboard` | KPI cards, per-market unrealized P&L, equity curve chart |
| `/positions` | Open positions table with live prices, day change, and weights |
| `/history` | Full trade table with filters and pagination |
| `/analytics` | Realized P&L, behavioral stats, heatmap, risk metrics |
| `/import` | XLSX drag-and-drop import with history |
| `/alerts` | Alert inbox (stub — Phase 5) |
| `/settings` | User preferences (stub — Phase 5) |

---

## AI Agent

The chat drawer (right side, always accessible) connects to Claude via a streaming SSE endpoint. The agent has 21 tools across three tiers:

- **Core tools (11):** portfolio summary, trade queries, P&L breakdown, behavioral report, what-if scenarios, market prices, alert management, sync status
- **Tier 1 tools (7):** derived from existing data — dividend summary, cost analysis, performance timeline, streaks, sector exposure, security info, holding period analysis
- **Tier 2 tools (3):** powered by live market data — benchmark comparison, currency impact, risk report

Conversations are persisted in Postgres and resumable. Each chat turn supports up to 10 sequential tool calls. Context is kept to the last 40 messages.

---

## Data Import

Transactions are imported from IBI's XLSX exports via the `/import` page. The parser handles:

- Hebrew column headers
- 14 transaction types (trades, dividends, taxes, fees, FX conversions, deposits, etc.)
- TASE paper numbers as ticker identifiers
- Agorot → ILS price normalization for TASE securities
- Deterministic `tradeId` hashing for safe re-uploads (idempotent upserts)

Only `BUY` and `SELL` directions are used by the P&L engine, positions, and analytics. All other transaction types are stored for reference.

---

## Deployment

Hosted on Railway. Three services: `web` (Next.js, public domain), `api` (Express, private), `Postgres`.

```bash
# Deploy the API
railway up --service api --detach -m "deploy message"

# Deploy the web frontend
railway up --service web --detach -m "deploy message"
```

The web service rewrites `/api/*` to the private API service via `API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`. Basic auth is enforced at both layers.

See `CLAUDE.md` for full Railway service variable configuration.

---

## Database Schema

10 tables managed by Prisma:

`trades`, `securities`, `sync_log`, `alerts`, `market_prices`, `exchange_rates`, `portfolio_snapshots`, `ai_conversations`, `ai_messages`, `user_preferences`

All monetary fields use `Decimal` (not `Float`). Schema lives in `packages/db/prisma/schema.prisma`.
