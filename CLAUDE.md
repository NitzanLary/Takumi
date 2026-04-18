# Takumi — Personal Trading Intelligence Platform

> **IMPORTANT: Keep this file updated.** Whenever you add new packages, change project structure, modify conventions, add services, create new routes/pages, or shift architectural decisions — update the relevant section of this file immediately so future sessions have accurate context. This is a mandatory part of every task.

## What This Is

A single-user web app for an independent investor (Nitzan) who trades Israeli (TASE) and US (NYSE/NASDAQ) equities through IBI broker. Transactions are imported from IBI's XLSX exports. Provides analytics dashboards and features a persistent AI chat agent powered by Claude.

The full PRD is in `Takumi_PRD.md` at the project root — refer to it for detailed requirements, agent tool definitions (24 tools across 3 tiers), alert types, data enrichment strategy, and example conversations.

## Architecture

```
Browser (Next.js 14 :3000)  →  Express API (:3001)  →  SQLite (Prisma)
                                                              ↕
                                                      Anthropic Claude API
```

- **Frontend** talks only to Express.
- **Express** is the single gateway — orchestrates import, analytics, AI, alerts.
- **Data import** — XLSX files exported from IBI are uploaded via the `/import` page and parsed by `xlsx-import.service.ts`.
- **Database** is SQLite for dev (`packages/db/prisma/takumi.db`), PostgreSQL for prod.

## Monorepo Structure

```
takumi/
├── apps/
│   ├── web/                  # Next.js 14, App Router, Tailwind, TanStack Query
│   │   └── src/
│   │       ├── app/          # Pages: dashboard, positions, history, analytics, import, alerts, settings
│   │       ├── components/   # Providers.tsx, layout/Sidebar.tsx, layout/TopBar.tsx, ai/ChatDrawer.tsx, ai/MessageBubble.tsx, ai/ChatInput.tsx, ai/QuickActions.tsx
│   │       ├── stores/       # chat-store.ts (Zustand store for AI chat state)
│   │       └── lib/          # api-client.ts, formatters.ts, sse-client.ts
│   └── api/                  # Express 5, TypeScript, Prisma
│       └── src/
│           ├── index.ts      # App entry — registers routes
│           ├── routes/       # trades.ts, sync.ts, positions.ts, analytics.ts, market.ts, exchange-rates.ts, snapshots.ts, chat.ts
│           ├── services/     # trade.service.ts, sync.service.ts, xlsx-import.service.ts, pnl.service.ts, position.service.ts, analytics.service.ts, market.service.ts, exchange-rate.service.ts, snapshot.service.ts, risk.service.ts, whatif.service.ts
│           ├── data/         # tase-ticker-map.json, sector-map.json
│           ├── middleware/    # error-handler.ts
│           ├── lib/          # config.ts, db.ts
│           └── ai/           # system-prompt.ts, chat-handler.ts, conversation.service.ts, tools/ (core-tools.ts, tier1-tools.ts, tier2-tools.ts, index.ts)
├── packages/
│   ├── db/                   # Prisma schema + client (shared via @takumi/db)
│   │   └── prisma/schema.prisma
│   └── types/                # Shared TypeScript interfaces (shared via @takumi/types)
│       └── src/              # trade.ts, sync.ts, position.ts, alert.ts, analytics.ts, api.ts, market.ts
├── scripts/
│   ├── dev.sh                # Start API + frontend
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

# Database
pnpm --filter @takumi/db db:generate   # Regenerate Prisma client
pnpm --filter @takumi/db db:push       # Push schema to SQLite
DATABASE_URL="file:/home/nitzan/Takumi/packages/db/prisma/takumi.db" pnpm --filter @takumi/api exec tsx ../../scripts/seed.ts
```

## Environment Variables

All secrets live in `.env` at project root. The API loads it via `dotenv` in `apps/api/src/lib/config.ts`. Required variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Must be an **absolute** `file:` path for SQLite |
| `ANTHROPIC_API_KEY` | Claude API key (Phase 3) |
| `API_PORT` / `WEB_PORT` | Express (:3001) and Next.js (:3000) ports |

## Database

Schema in `packages/db/prisma/schema.prisma`. SQLite provider, Prisma ORM.

**Tables (10 total):**

| Table | Purpose | Key Notes |
|---|---|---|
| `trades` | All transaction records (trades + non-trades) | Unique on `(tradeId, source)`. `direction` field: BUY/SELL for core trades; DIVIDEND, TAX, FEE, TRANSFER, CONVERSION, CREDIT, DEPOSIT, WITHDRAWAL, SPLIT for non-trades. Extra fields: `proceeds_fx`, `proceeds_ils`, `capital_gains_tax`. All services filter to BUY/SELL by default. |
| `securities` | Security reference data | Unique on `ticker`. Extended with `yahoo_symbol`, `industry`, `market_cap_bucket` (Phase 3). |
| `sync_log` | Import run history | Indexed by `synced_at DESC`. Has `file_name` column for tracking imported XLSX filenames. |
| `alerts` | Price/P&L/duration alerts | 6 types: price_drop, price_target, holding_duration, portfolio_pnl, sync_failure, inactivity |
| `market_prices` | Cached market prices | Indexed by `(ticker, fetched_at DESC)`. Extended with `day_change`, `day_change_pct`, `high_52w`, `low_52w`, `volume` (Phase 3). |
| `exchange_rates` | Daily ILS/USD rates | Unique on `date` |
| `portfolio_snapshots` | Daily portfolio value snapshots | Unique on `date`. Stores total value, cost basis, unrealized/realized P&L, position count, positions JSON. Used for equity curve. |
| `ai_conversations` | Chat sessions | Has many `ai_messages` |
| `ai_messages` | Individual chat messages | Role: user/assistant/tool; optional `tool_calls` JSON |
| `user_preferences` | Single-row settings | id="default"; currency, cost basis method |

All monetary fields use `Decimal` (not Float).

## API Routes (Express)

| Method | Route | Handler | Purpose |
|---|---|---|---|
| GET | `/api/health` | inline | Health check |
| GET | `/api/trades` | trades.ts | List trades (paginated, filterable by ticker/market/direction). Defaults to core trades (BUY/SELL) only; pass `includeNonTrades=true` for all transactions |
| GET | `/api/sync/status` | sync.ts | Last import status |
| GET | `/api/sync/log` | sync.ts | Import history (limit query param) |
| POST | `/api/sync/import` | sync.ts | Upload XLSX file (multipart) for import via `xlsx-import.service.ts` |
| GET | `/api/positions` | positions.ts | Open positions from FIFO lot matching, enriched with live market prices. Auto-triggers daily snapshot. |
| GET | `/api/analytics/summary` | analytics.ts | Portfolio KPIs, behavioral stats, win/loss analysis |
| GET | `/api/analytics/pnl` | analytics.ts | P&L breakdown by ticker, month, or market (groupBy param) |
| GET | `/api/analytics/risk` | analytics.ts | Portfolio risk metrics (Herfindahl, max drawdown, Sharpe, Sortino) |
| GET | `/api/market/prices` | market.ts | Get cached/fresh prices for specified tickers (?tickers=X,Y) |
| POST | `/api/market/refresh` | market.ts | Force-refresh all open position tickers from Yahoo Finance |
| GET | `/api/market/benchmarks` | market.ts | TA-125 and S&P 500 latest quotes |
| GET | `/api/market/unmapped` | market.ts | TASE tickers missing Yahoo Finance mapping |
| POST | `/api/market/map` | market.ts | Save a TASE ticker → Yahoo symbol mapping |
| GET | `/api/exchange-rates` | exchange-rates.ts | Current rate or historical (?date=YYYY-MM-DD) |
| POST | `/api/exchange-rates/backfill` | exchange-rates.ts | Backfill exchange rates from earliest trade date |
| GET | `/api/snapshots` | snapshots.ts | Portfolio snapshots for equity curve (?from=&to=) |
| POST | `/api/snapshots/capture` | snapshots.ts | Manually trigger today's portfolio snapshot |
| POST | `/api/chat` | chat.ts | Send message to AI agent, receive SSE stream response |
| GET | `/api/chat/conversations` | chat.ts | List all AI conversations |
| GET | `/api/chat/conversations/:id` | chat.ts | Get conversation with full message history |
| DELETE | `/api/chat/conversations/:id` | chat.ts | Delete a conversation |

## Frontend Pages

| Route | Status | Description |
|---|---|---|
| `/dashboard` | **Functional** | 4 KPI cards (P&L, win rate, trades, avg return) + summary row + equity curve chart (Recharts, from portfolio snapshots) |
| `/positions` | **Functional** | Open positions table with live market prices (Yahoo Finance), day change %, unrealized P&L, weight %. Refresh Prices button. Auto-refetch every 60s. Shows placeholder warning for unmapped TASE tickers. |
| `/history` | **Functional** | Full trade table with filters (ticker/market/direction), pagination, "Show all transactions" toggle for non-trade types |
| `/analytics` | **Functional** | Behavioral stats (8 cards), TASE vs US comparison, per-ticker P&L breakdown table, monthly P&L heatmap (color-coded grid), risk metrics cards (HHI, drawdown, Sharpe, Sortino) |
| `/import` | **Functional** | XLSX drag-and-drop import with file tracking, import status, import history table |
| `/alerts` | Stub | Empty page |
| `/settings` | Stub | Empty page |

**Layout:** Sidebar (left, 240px wide) + TopBar (56px tall) + main content. Sidebar nav has 7 items.

## Conventions

- **TypeScript** for all Node.js code (ESM — `"type": "module"` everywhere)
- **File extensions in imports** — always use `.js` in TypeScript import paths (`./lib/config.js`)
- **Shared types** live in `@takumi/types`, not duplicated across apps
- **Prisma client** is re-exported from `@takumi/db` as a singleton (`packages/db/src/index.ts`)
- **API routes** follow `/api/<resource>` pattern
- **Frontend pages** are in `apps/web/src/app/<route>/page.tsx` (Next.js App Router, all `"use client"`)
- **Data fetching** on frontend uses TanStack Query (`useQuery`, `useMutation`)
- **API client** helper in `apps/web/src/lib/api-client.ts` — wraps `fetch` with base URL
- **Formatting** helpers in `apps/web/src/lib/formatters.ts` — `formatCurrency`, `formatDate`, `formatNumber`, `isHebrew`
- **RTL handling** — Hebrew security names wrapped with `<span dir="rtl">` using `isHebrew()` helper; applied in positions, analytics, and history pages
- **TASE security identification** — TASE securities use paper number (מספר נייר) as `ticker` and paper name (שם נייר) as `securityName`. US securities use standard ticker symbols (e.g., AAPL). The XLSX parser uses the symbol column (paper number) for TASE securities.
- **Per-currency P&L** — `getPortfolioSummary()` returns `pnlByCurrency` array alongside `totalRealizedPnl`. Dashboard shows separate ILS/USD P&L lines. Never mix currencies in a single formatted amount.
- **XLSX import** — `xlsx-import.service.ts` parses IBI Excel exports (Hebrew column headers), maps 14 transaction types to `Direction` enum, extracts real tickers from `שם נייר` patterns, generates deterministic `tradeId` hashes for dedup. Uses `source: "xlsx_import"`. Re-uploading same file is safe (upsert).
- **Transaction linking** — Related transactions (e.g., dividend + tax withholding) share the same `ticker` and `tradeDate`. Query by ticker to see all related activity. No explicit `groupId` field.
- **Market data caching** — Yahoo Finance prices are cached in `market_prices` with 15-minute staleness. The `market.service.ts` checks cache first, fetches from Yahoo only for stale/missing tickers. On failure, serves stale cache. Benchmarks (TA-125, S&P 500) are cached the same way.
- **TASE ticker mapping** — TASE securities use IBI paper numbers as `ticker` (e.g., `1081820`), but Yahoo Finance requires trading symbols with `.TA` suffix (e.g., `LUMI.TA`). The mapping is maintained in `apps/api/src/data/tase-ticker-map.json` and synced to the `securities.yahooSymbol` column.
- **Portfolio snapshots** — Auto-captured once per day after 15:00 UTC (~17:00 IST) on first API request. Also manually triggerable via `POST /api/snapshots/capture`. One snapshot per calendar day (upsert on date).
- **AI chat** — Persistent right-side drawer (400px, fixed overlay). Uses Zustand store (`chat-store.ts`) for state, SSE streaming from `POST /api/chat`. Messages rendered with `react-markdown`. Tool calls shown as collapsible indicators.
- **AI tool architecture** — Tools defined in `apps/api/src/ai/tools/` grouped by tier. Each file exports schemas (Anthropic format) + executor map. Registry in `tools/index.ts` combines all. Chat handler in `ai/chat-handler.ts` runs the agentic loop (stream → detect tool_use → execute → stream again).
- **FIFO caching** — `runFifoMatching()` results cached in-memory with 1-minute TTL to avoid redundant re-computation when multiple AI tools call it within the same chat turn.

## Implementation Status

### Phase 1 — Foundation ✅ COMPLETE
- [x] Monorepo scaffolding (pnpm workspaces, turbo, TypeScript configs)
- [x] Prisma schema — 9 tables with all indexes and constraints
- [x] Shared types package (`@takumi/types`) — Trade, SyncState, Position, Alert, Analytics, API types
- [x] Express API — health, trades (paginated + filtered), sync status routes
- [x] Next.js frontend — app shell, sidebar, topbar, 7 page routes
- [x] Trade history page — full table with ticker/market/direction filters + pagination
- [x] Dashboard page — KPI cards
- [x] Seed script with 12 sample trades
- [x] `.env.example` with all required variables

### Phase 2 — Analytics & Dashboard ✅ COMPLETE
- [x] P&L engine — FIFO lot matching (`pnl.service.ts`) calculates realized P&L per matched lot, per ticker, per month, per market
- [x] Positions service (`position.service.ts`) — derives open positions from unmatched buy lots with weighted avg cost basis
- [x] Analytics service (`analytics.service.ts`) — win rate, avg holding period, profit factor, largest win/loss, behavioral stats
- [x] API routes: `GET /api/positions`, `GET /api/analytics/summary`, `GET /api/analytics/pnl?groupBy=ticker|month|market`
- [x] Dashboard page — 4 live KPI cards + 3 summary cards + equity curve placeholder
- [x] Positions page — open positions table (ticker, qty, avg cost, current price placeholder, unrealized P&L, weight %)
- [x] Analytics page — 8 behavioral stat cards, TASE vs US comparison, per-ticker P&L breakdown table, monthly heatmap placeholder
- [x] Transaction filtering — only core trades (BUY/SELL) used by P&L, positions, analytics; all raw transactions stored for future processing (dividends, taxes, fees, etc.)
- [x] **Previously deferred, now complete in Phase 3**: equity curve chart, monthly heatmap, live market prices for positions

### Data Import — XLSX ✅ COMPLETE
- [x] XLSX parser (`xlsx-import.service.ts`) — parses Hebrew columns, maps 14 transaction types, extracts tickers from שם נייר patterns
- [x] Schema extended with `proceeds_fx`, `proceeds_ils`, `capital_gains_tax` fields
- [x] API route `POST /api/sync/import` with multer file upload
- [x] Frontend import page at `/import` with drag-and-drop upload, import history with filenames
- [x] IBI live sync code fully removed (Python sidecar, scheduler, trigger route)

### Phase 3 — Market Data & Live Prices ✅ COMPLETE
- [x] Live market prices via Yahoo Finance (`yahoo-finance2` v3) — `market.service.ts` fetches and caches in `market_prices` with 15-min staleness
- [x] TASE ticker mapping — manual JSON map (`apps/api/src/data/tase-ticker-map.json`) maps IBI paper numbers to Yahoo `.TA` symbols. `yahooSymbol` column on `securities` table. API endpoints for managing unmapped tickers.
- [x] Benchmark indices (TA-125 via `^TA125`, S&P 500 via `^GSPC`) — `GET /api/market/benchmarks`
- [x] Exchange rate history backfill via Bank of Israel SDMX API → `exchange_rates` table — `exchange-rate.service.ts`
- [x] Portfolio risk metrics: Herfindahl concentration, max drawdown, Sharpe/Sortino ratios — `risk.service.ts`, `GET /api/analytics/risk`
- [x] Daily portfolio snapshots (`portfolio_snapshots` table) — auto-captured after 17:00 IST on first API hit, manual capture via `POST /api/snapshots/capture`
- [x] Positions page updated with live prices, day change %, Refresh Prices button, auto-refetch
- [x] Equity curve chart on dashboard (Recharts LineChart from portfolio snapshots)
- [x] Monthly P&L heatmap on analytics page (color-coded year×month grid)
- [x] Risk metrics cards on analytics page (HHI, max drawdown, Sharpe, Sortino)
- [x] Schema extended: `market_prices` +5 fields, `securities` +3 fields, new `portfolio_snapshots` table
- [x] Shared types: new `@takumi/types/market.ts` (MarketQuote, ExchangeRateEntry, PriceSource, PortfolioSnapshotData, RiskMetrics)
- [x] Position interface extended with `priceSource`, `dayChange`, `dayChangePct`

### Phase 4 — AI Agent ✅ COMPLETE
- [x] Claude integration via `@anthropic-ai/sdk` v0.52 — model: `claude-sonnet-4-20250514`
- [x] SSE streaming chat endpoint (`POST /api/chat`) with agentic tool execution loop (max 10 tool calls per turn, 4096 max tokens)
- [x] Persistent chat drawer (right side, 400px) — toggle via TopBar button, visible on all pages
- [x] System prompt dynamically built with live portfolio context (positions, P&L, sync status)
- [x] Conversation CRUD — persistence in `ai_conversations` / `ai_messages`, list/delete/load history
- [x] Zustand store for frontend chat state (messages, streaming, drawer, conversations)
- [x] SSE client helper for POST-based SSE (browser EventSource is GET-only)
- [x] Markdown rendering in assistant messages via `react-markdown`, collapsible tool call indicators
- [x] Quick-action chips for common queries (shown when no messages)
- [x] FIFO matching results cached with 1-minute TTL to avoid redundant computation during multi-tool chat turns
- [x] **11 core tools**: `get_portfolio_summary`, `query_trades`, `get_pnl_breakdown`, `get_behavioral_report`, `run_what_if`, `get_market_price`, `create_alert`, `list_alerts`, `delete_alert`, `trigger_sync`, `get_sync_status`
- [x] **7 Tier 1 tools** (no external APIs — derived from existing DB data): `get_dividend_summary`, `get_cost_analysis`, `get_performance_timeline`, `get_streaks`, `get_sector_exposure`, `get_security_info`, `get_holding_period_analysis`
- [x] **3 Tier 2 tools** (powered by Phase 3 market data): `get_benchmark_comparison`, `get_currency_impact`, `get_risk_report`
- [x] What-if scenario engine (`whatif.service.ts`) — stop-loss simulation and modified sell date scenarios
- [x] Static sector/industry mapping (`sector-map.json`) for ~25 tickers
- [x] Context management: last 40 raw messages kept in full for API calls; conversation title auto-generated from first message

### Phase 5 — Alerts, Settings & Hardening
- Alert engine (6 types), alert inbox at `/alerts`
- Settings page (currency, cost basis method)
- Error boundaries, structured logging
- Performance optimization for 5,000+ trades
- E2E tests
- **Tier 3 data enrichment** (advanced intelligence):
  - Technical indicators (50/200-day MA, RSI) from daily OHLCV history (new `price_history` table)
  - News & corporate events via Finnhub free tier (new `security_events` table)
  - Tax intelligence: short/long-term gains classification, tax-loss harvesting candidates
- New Tier 3 agent tools: `get_technical_indicators`, `get_news`, `get_upcoming_events`, `get_tax_report`

## External Services

| Service | Purpose | Phase | Status | Notes |
|---|---|---|---|---|
| Yahoo Finance (`yahoo-finance2` v3) | Live prices, benchmarks (TA-125, S&P 500) | 3 | **Active** | TASE tickers resolved via `tase-ticker-map.json` → `.TA` suffix. 15-min cache staleness. |
| Bank of Israel SDMX API | Official daily ILS/USD exchange rates | 3 | **Active** | Free, no auth. Backfills into `exchange_rates` table. Endpoint: `edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI/EXR/1.0/` |
| Finnhub | News headlines, earnings calendar, corporate events | 5 | Planned | Free tier: 60 calls/min. Cache in `security_events` table. |

## AI Agent Data Enrichment Tiers

See PRD Section 7.5 for full details. Summary:

- **Tier 1 (Phase 4)**: No external APIs — dividend aggregation, cost analysis, performance attribution, streaks, sector metadata, holding period analysis. All derived from existing `trades` table data.
- **Tier 2 (Phase 3 infra + Phase 4 tools)**: External APIs — live prices, benchmarks, exchange rates, risk metrics, portfolio snapshots. Market data services built in Phase 3; agent tools that consume them ship in Phase 4.
- **Tier 3 (Phase 5)**: Advanced — technical indicators, news/events, tax intelligence. Requires Finnhub + daily OHLCV history.

**Total agent tools**: 24 (11 core + 7 Tier 1 + 3 Tier 2 + 3 Tier 3 + `get_tax_report`).

**DB tables added in Phase 3**: `portfolio_snapshots`. **Planned new tables**: `price_history` (Phase 5), `security_events` (Phase 5). Existing `securities` table extended with `yahooSymbol`, `industry`, `marketCapBucket` (Phase 3). Existing `market_prices` extended with `dayChange`, `dayChangePct`, `high52w`, `low52w`, `volume` (Phase 3).

## Gotchas

- `DATABASE_URL` must be **absolute** `file:` path — relative paths break when commands run from different directories
- Express `.env` loading uses hardcoded relative path in `config.ts` — update if you move the file
- `pnpm-workspace.yaml` has `onlyBuiltDependencies` for prisma and esbuild — add new native packages there if they need build scripts
- Next.js `create-next-app` generated some files we don't use (e.g., `public/` SVGs) — safe to ignore
- Positions page shows live prices from Yahoo Finance for mapped tickers. TASE tickers without a mapping in `tase-ticker-map.json` fall back to placeholder prices (= avg cost basis). Use `GET /api/market/unmapped` or `POST /api/market/map` to manage mappings.
- Pre-existing TS2742 errors in Express routes due to `declaration: true` + Express 5 type inference — does not affect runtime (tsx skips type checking)
- **Transaction filtering**: XLSX import stores ALL transaction types (trades, dividends, fees, taxes, etc.) in the `trades` table. Only `BUY`/`SELL` directions are "core trades" used by P&L, positions, analytics, and the default trades API. Non-trade types are preserved for future processing. The relevant IBI סוג פעולה values for core trades are: `קניה רצף` (TASE buy), `מכירה רצף` (TASE sell), `קניה חול מטח` (US buy), `מכירה חול מטח` (US sell). `CORE_DIRECTIONS` constant in `@takumi/types` defines `['BUY', 'SELL']`.
- **XLSX שם נייר patterns** — The XLSX parser extracts tickers from security name prefixes: `דיב/` (dividend), `מסח/` (dividend tax), `מס/` (tax), `COMPANY(TICKER)` (trade), `TICKER US` (trade). FX conversions use `B USD/ILS X.XXX`. TASE uses paper numbers. Admin uses codes 900, 9992975, 9992983.
