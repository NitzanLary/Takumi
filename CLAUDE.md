# Takumi — Personal Trading Intelligence Platform

> **IMPORTANT: Keep this file updated.** Whenever you add new packages, change project structure, modify conventions, add services, create new routes/pages, or shift architectural decisions — update the relevant section of this file immediately so future sessions have accurate context. This is a mandatory part of every task.

## What This Is

A multi-user web app for independent investors trading Israeli (TASE) and US (NYSE/NASDAQ) equities through IBI broker. Transactions are imported from IBI's XLSX exports. Provides analytics dashboards and a persistent AI chat agent powered by Claude. All data is per-user — trades, positions, alerts, conversations, and snapshots are scoped by `user_id`.

The full PRD is in `Takumi_PRD.md` at the project root — refer to it for detailed requirements, agent tool definitions (24 tools across 3 tiers), alert types, data enrichment strategy, and example conversations.

## Architecture

```
Browser  →  Next.js web (session cookie gate)  →  rewrites /api/*  →  Express API (private)  →  Postgres
                                                                                ↕
                                                                         Anthropic Claude API
                                                                                ↕
                                                                         Resend (transactional email)
```

- **Frontend** calls relative `/api/*` URLs. Next.js rewrites them server-side to the API service (via `API_URL` env var). The browser never sees the API origin directly. `src/middleware.ts` redirects unauthenticated requests to `/login` (checked via presence of `takumi_session` cookie).
- **Express** is the single gateway. All routes except `/api/health` and `/api/auth/*` require a valid session (enforced by `requireAuth` middleware). `req.user.id` is set on every authenticated request — services accept `userId` as their first argument and every Prisma query scopes by it.
- **Auth** — email + password. Passwords hashed with bcrypt (cost 12). Session tokens are 32-byte random strings, stored as SHA-256 hashes in the `sessions` table. Cookie is httpOnly, Secure (prod), SameSite=Lax, 30-day rolling expiry. Verification + password-reset tokens live in `verification_tokens`. **Email verification is currently disabled** (no verified Resend sending domain yet — see "External Services"): signup auto-sets `emailVerifiedAt`, creates a session and logs the user in directly; login and `requireAuth` no longer gate on verification. The verify/reset-password endpoints and pages are still in the codebase and will work again once a domain is verified and `EMAIL_FROM` is pointed at it — the "Forgot?" link on the login page has been hidden in the meantime.
- **Data import** — XLSX files exported from IBI are uploaded via the `/import` page and parsed by `xlsx-import.service.ts`.
- **Database** — Prisma schema is PostgreSQL. Dev and prod both use Postgres (Railway for prod).

## Monorepo Structure

```
takumi/
├── apps/
│   ├── web/                  # Next.js 14, App Router, Tailwind, TanStack Query
│   │   └── src/
│   │       ├── app/          # Pages: dashboard, positions, positions/[ticker], history, analytics, import, alerts, settings, login, signup, verify-email, forgot-password, reset-password
│   │       ├── middleware.ts # Session-cookie gate; redirects to /login when unauthenticated
│   │       ├── components/   # Providers.tsx, UserProvider.tsx, layout/AppShell.tsx, layout/Sidebar.tsx, layout/TopBar.tsx (with UserMenu), auth/AuthCard.tsx, ai/ChatDrawer.tsx, ai/MessageBubble.tsx, ai/ChatInput.tsx, ai/QuickActions.tsx, stock/StockHeader.tsx, stock/OverviewTab.tsx, stock/TradesTab.tsx, stock/RoundTripsTab.tsx, stock/DividendsFeesTab.tsx, stock/StockChart.tsx
│   │       ├── stores/       # chat-store.ts, ui-store.ts
│   │       └── lib/          # api-client.ts (401→/login redirect), formatters.ts, sse-client.ts
│   └── api/                  # Express 5, TypeScript, Prisma
│       └── src/
│           ├── index.ts      # App entry — registers auth router (public) + requireAuth + resource routers
│           ├── routes/       # auth.ts, trades.ts, sync.ts, positions.ts, analytics.ts, market.ts, exchange-rates.ts, snapshots.ts, stock.ts, chat.ts
│           ├── services/     # trade.service.ts, sync.service.ts, xlsx-import.service.ts, pnl.service.ts, position.service.ts, analytics.service.ts, market.service.ts, themarker.service.ts, stooq.service.ts, exchange-rate.service.ts, snapshot.service.ts, risk.service.ts, whatif.service.ts, stock-detail.service.ts, email.service.ts
│           ├── data/         # tase-ticker-map.json, sector-map.json
│           ├── middleware/   # error-handler.ts, require-auth.ts
│           ├── lib/          # config.ts, db.ts
│           └── ai/           # system-prompt.ts, chat-handler.ts, conversation.service.ts, tools/ (core-tools.ts, tier1-tools.ts, tier2-tools.ts, index.ts)
├── packages/
│   ├── db/                   # Prisma schema + client (shared via @takumi/db)
│   │   └── prisma/schema.prisma
│   └── types/                # Shared TypeScript interfaces (shared via @takumi/types)
│       └── src/              # trade.ts, sync.ts, position.ts, alert.ts, analytics.ts, api.ts, market.ts, stock.ts
├── scripts/
│   ├── dev.sh                # Start API + frontend
│   ├── seed.ts               # Populate DB with 12 sample trades
│   └── bootstrap-users.ts    # One-time: create primary user from BOOTSTRAP_USER_EMAIL/PASSWORD and backfill user_id on legacy rows. Idempotent.
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
| `DATABASE_URL` | Postgres connection string |
| `ANTHROPIC_API_KEY` | Claude API key |
| `API_PORT` / `WEB_PORT` | Express (:3001) and Next.js (:3000) ports |
| `APP_URL` | Public URL of the web app — embedded into verification + password-reset email links |
| `RESEND_API_KEY` | Resend transactional email API key. Unset = email sends become console logs (fine for dev). |
| `EMAIL_FROM` | From address used by Resend (e.g. `"Takumi <onboarding@resend.dev>"`) |
| `AUTH_DEV_BYPASS_USER_ID` | **Dev-only.** If set, `requireAuth` resolves this user without session lookup. Never set in prod. |
| `BOOTSTRAP_USER_EMAIL` / `BOOTSTRAP_USER_PASSWORD` | Consumed only by `scripts/bootstrap-users.ts` (one-time migration to backfill the primary user). |

## Database

Schema in `packages/db/prisma/schema.prisma`. PostgreSQL provider, Prisma ORM.

**Tables (12 total):**

| Table | Purpose | Key Notes |
|---|---|---|
| `users` | Accounts | Unique on `email`. Columns: `password_hash` (bcrypt cost 12), `email_verified_at`, `display_name`, `currency_pref`, `cost_basis_method`, timestamps. |
| `sessions` | Active login sessions | `token_hash` = SHA-256 of the opaque cookie value. 30-day expiry with rolling refresh on activity. Cascades on user delete. |
| `verification_tokens` | Email-verify + password-reset tokens | `purpose` ∈ {`email_verify`, `password_reset`}. `token_hash`, `expires_at`, `consumed_at`. Indexed by `(userId, purpose)`. |
| `trades` | All transaction records (trades + non-trades) | Unique on `(userId, tradeId, source)`. `user_id` FK cascades. `direction` field: BUY/SELL for core trades; DIVIDEND, TAX, FEE, TRANSFER, CONVERSION, CREDIT, DEPOSIT, WITHDRAWAL, SPLIT for non-trades. Extra fields: `proceeds_fx`, `proceeds_ils`, `capital_gains_tax`. All services filter to BUY/SELL by default and scope by `userId`. |
| `securities` | Security reference data (shared across users) | Unique on `ticker`. Extended with `yahoo_symbol`, `industry`, `market_cap_bucket` (Phase 3). |
| `sync_log` | Import run history | Per-user. Indexed by `(userId, synced_at DESC)`. Has `file_name` column for tracking imported XLSX filenames. |
| `alerts` | Price/P&L/duration alerts | Per-user. 6 types: price_drop, price_target, holding_duration, portfolio_pnl, sync_failure, inactivity |
| `market_prices` | Cached market prices (shared) | Indexed by `(ticker, fetched_at DESC)`. |
| `exchange_rates` | Daily ILS/USD rates (shared) | Unique on `date` |
| `portfolio_snapshots` | Daily portfolio value snapshots | Per-user, unique on `(userId, date)`. |
| `ai_conversations` | Chat sessions | Per-user, indexed by `(userId, updatedAt)`. Has many `ai_messages`. |
| `ai_messages` | Individual chat messages | Role: user/assistant/tool; optional `tool_calls` JSON. Scoped by conversation (which is per-user). |

All monetary fields use `Decimal` (not Float). The legacy `user_preferences` singleton table was dropped in Commit B — per-user prefs now live on `users.currency_pref` / `users.cost_basis_method`.

## API Routes (Express)

All routes except `/api/health` and `/api/auth/*` require a valid session cookie. `requireAuth` middleware sets `req.user = { id, email }`.

| Method | Route | Handler | Purpose |
|---|---|---|---|
| GET | `/api/health` | inline | Health check (public) |
| POST | `/api/auth/signup` | auth.ts | Create account (email+password+optional displayName). Auto-verifies + issues a session cookie (email verification currently disabled). |
| POST | `/api/auth/login` | auth.ts | Exchange email+password for session cookie. |
| POST | `/api/auth/logout` | auth.ts | Delete session row and clear cookie |
| GET | `/api/auth/me` | auth.ts | Current user (used by UserProvider to bootstrap) |
| POST | `/api/auth/verify-email` | auth.ts | Consume verification token |
| POST | `/api/auth/resend-verification` | auth.ts | Re-send verification email (always 200 to avoid user enumeration) |
| POST | `/api/auth/forgot-password` | auth.ts | Issue reset token, send email (always 200) |
| POST | `/api/auth/reset-password` | auth.ts | Consume reset token, set new password, invalidate existing sessions |
| GET | `/api/trades` | trades.ts | List trades (paginated, filterable by ticker/market/direction). Defaults to core trades (BUY/SELL) only; pass `includeNonTrades=true` for all transactions |
| GET | `/api/sync/status` | sync.ts | Last import status |
| GET | `/api/sync/log` | sync.ts | Import history (limit query param) |
| POST | `/api/sync/import` | sync.ts | Upload XLSX file (multipart) for import via `xlsx-import.service.ts` |
| GET | `/api/positions` | positions.ts | Open positions from FIFO lot matching, enriched with live market prices. Auto-triggers daily snapshot. |
| GET | `/api/analytics/summary` | analytics.ts | Portfolio KPIs, behavioral stats, win/loss analysis |
| GET | `/api/analytics/pnl` | analytics.ts | P&L breakdown by ticker, month, or market (groupBy param). `groupBy=market` accepts optional `window=all|ytd|12m` (default `all`) and includes `realizedPnlIls` (ILS-normalized realized P&L via current BOI USD/ILS rate) on each row. |
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
| GET | `/api/stock/:ticker/summary` | stock.ts | Per-stock detail page header + KPIs (position, realized P&L, fees, dividends, currency impact). Works for open AND closed positions. |
| GET | `/api/stock/:ticker/open-lots` | stock.ts | Unsold FIFO buy lots for a ticker, each enriched with current price and per-lot unrealized P&L |
| GET | `/api/stock/:ticker/round-trips` | stock.ts | Completed FIFO-matched buy→sell cycles (entry/exit/holding/realized P&L) |
| GET | `/api/stock/:ticker/chart` | stock.ts | Daily-close price history from first buy → today (?from=&to= to override). Returns `{ available: false, reason, message }` for unmapped TASE funds. |
| POST | `/api/chat` | chat.ts | Send message to AI agent, receive SSE stream response |
| GET | `/api/chat/conversations` | chat.ts | List all AI conversations |
| GET | `/api/chat/conversations/:id` | chat.ts | Get conversation with full message history |
| DELETE | `/api/chat/conversations/:id` | chat.ts | Delete a conversation |

## Frontend Pages

Auth pages (`/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`) are rendered by `AppShell` without the sidebar/topbar chrome. Every other page requires a session cookie — unauthenticated requests are redirected to `/login?next=<original-path>` by `src/middleware.ts`.

| Route | Status | Description |
|---|---|---|
| `/login` | **Functional** | Email + password sign-in. Preserves `?next=` for post-login redirect. |
| `/signup` | **Functional** | Email + password + optional display name. Sends verification email; user can't log in until verified. |
| `/verify-email` | **Functional** | Consumes `?token=`, shows success/error state, links to `/login`. |
| `/forgot-password` | **Functional** | Email → reset link. Always shows "check your email" to avoid user enumeration. |
| `/reset-password` | **Functional** | `?token=` + new password + confirm. Invalidates all existing sessions for that user on success. |
| `/dashboard` | **Functional** | Single pane of glass for portfolio state and performance. **Portfolio Total** card (ILS home currency) showing Market Value, Unrealized P&L, Realized P&L, and Total P&L with USD equivalent under each. **Per-market cards** (TASE, US) showing the same four rows in native currency with cross-currency equivalent. **Realized-window toggle** (All-time / YTD / 12M, persisted in URL `?window=`) affects only Realized P&L and Total P&L. Equity curve (Recharts, from portfolio snapshots). Components live in `apps/web/src/components/dashboard/` (`MoneyLine`, `WindowToggle`, `PortfolioTotalCard`, `MarketCard`). |
| `/positions` | **Functional** | Open positions table with live market prices (Yahoo Finance), day change %, unrealized P&L, weight %. Refresh Prices button. Auto-refetch every 60s. Shows placeholder warning for unmapped TASE tickers. Ticker cells link to `/positions/:ticker`. |
| `/positions/:ticker` | **Functional** | Per-stock detail page. Header (shares, avg cost, current price, day change, market value, unrealized P&L, weight, sector, first buy date, holding duration). Tabs: Overview (KPI cards + open FIFO lots), Trades (raw BUY/SELL list), Round-trips (completed buy→sell cycles with holding and return), Dividends & Fees (dividend payments with withheld tax + per-trade commissions). Price chart docked at bottom with green/red buy/sell markers and dashed avg-cost line. Works for open AND closed positions. Also reachable from `/history` and `/analytics` ticker cells. Components in `apps/web/src/components/stock/`. |
| `/history` | **Functional** | Full trade table with filters (ticker/market/direction), pagination, "Show all transactions" toggle for non-trade types. Ticker cells link to `/positions/:ticker`. |
| `/analytics` | **Functional** | Realized P&L summary (per-currency P&L, total/closed trade counts, avg return, avg holding period), behavioral stats (8 cards), TASE vs US comparison, per-ticker P&L breakdown table (ticker cells link to `/positions/:ticker`), monthly P&L heatmap (color-coded grid), risk metrics cards (HHI, drawdown, Sharpe, Sortino) |
| `/import` | **Functional** | XLSX drag-and-drop import with file tracking, import status, import history table |
| `/alerts` | Stub | Empty page |
| `/settings` | Stub | Empty page |

**Layout:** Sidebar (left, 240px wide) + TopBar (56px tall) + main content. Sidebar nav has 7 items.

## Conventions

- **Per-user data scoping (CRITICAL)** — every backend service function that touches per-user tables (`trades`, `alerts`, `portfolio_snapshots`, `ai_conversations`, `sync_log`) takes `userId` as its first argument and threads it into the Prisma `where` clause. Route handlers get `userId` from `req.user!.id` (guaranteed by `requireAuth`). The in-memory FIFO match cache in `pnl.service.ts` is keyed by `userId` — a single-key cache would leak one user's FIFO results to another within the 1-minute TTL. The `securities`, `market_prices`, and `exchange_rates` tables are shared and intentionally NOT scoped by user. AI tool executors have the signature `(userId, input) => Promise<unknown>` and the chat handler passes `req.user!.id` through `executeTool`.
- **Auth middleware** — `requireAuth` is mounted once via `app.use("/api", requireAuth)` in `apps/api/src/index.ts`, AFTER the public routes (`/api/health`, `/api/auth/*`). It checks the `takumi_session` cookie against the `sessions` table (SHA-256 of the raw value is stored), rejects expired or email-unverified sessions, and sets `req.user`. Rolling refresh: if the session hasn't been touched in >24h, its expiry is bumped by 30d (fire-and-forget).
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
- **TASE price units** — IBI's `שער ביצוע` for Israeli securities is quoted in **agorot** (1/100 ILS), not shekels. The XLSX parser divides by 100 when `market === "TASE"` so `trades.price` is always per-share ILS. US trades are stored as-is. Sanity check: for any TASE buy/sell, `quantity × price + commission ≈ |proceedsIls|`. Migration script `scripts/fix-tase-prices.ts` corrects rows imported before this fix (idempotent, uses `rawPayload`).
- **Per-currency P&L** — `getPortfolioSummary()` returns `pnlByCurrency` array alongside `totalRealizedPnl`. Dashboard shows separate ILS/USD P&L lines. Never mix currencies in a single formatted amount.
- **ILS home currency for aggregation** — `position.service.ts` pre-computes `marketValueIls`, `totalCostIls`, `unrealizedPnlIls` on every `OpenPosition` using the current BOI USD/ILS rate (USD positions converted; ILS positions pass through 1:1). Portfolio weights and any cross-position aggregate (snapshot `totalValue`/`totalCostBasis`, analytics `totalOpenValue`, system-prompt portfolio context, AI `get_portfolio_summary.totalPortfolioValueIls`, AI `get_sector_exposure.marketValueIls`, Positions page summary strip) MUST use the `*Ils` fields. Summing native `marketValue` across ILS+USD inflates TASE weights by ~3.7× (USD magnitudes are naked). The per-position native `marketValue`/`unrealizedPnl` are still correct and used for per-row display in the native currency.
- **XLSX import** — `xlsx-import.service.ts` parses IBI Excel exports (Hebrew column headers), maps 14 transaction types to `Direction` enum, extracts real tickers from `שם נייר` patterns, generates deterministic `tradeId` hashes for dedup. Uses `source: "xlsx_import"`. Re-uploading same file is safe (upsert).
- **Transaction linking** — Related transactions (e.g., dividend + tax withholding) share the same `ticker` and `tradeDate`. Query by ticker to see all related activity. No explicit `groupId` field.
- **Market data caching** — Yahoo Finance prices are cached in `market_prices` with 15-minute staleness. The `market.service.ts` checks cache first, fetches from Yahoo only for stale/missing tickers. On failure, serves stale cache. Benchmarks (TA-125, S&P 500) are cached the same way.
- **TASE ticker mapping** — TASE securities use IBI paper numbers as `ticker` (e.g., `1081820`), but Yahoo Finance requires trading symbols with `.TA` suffix (e.g., `LUMI.TA`). The mapping is maintained in `apps/api/src/data/tase-ticker-map.json` and synced to the `securities.yahooSymbol` column.
- **TheMarker Finance fallback** — TASE tickers without a Yahoo mapping (notably Israeli mutual funds / קרנות נאמנות which have no `.TA` trading symbol, e.g., `1143726`, `1169408`) fall back to TheMarker Finance. `themarker.service.ts` fetches `https://finance.themarker.com/stock/{paperId}`, parses the server-rendered Apollo cache from `<script id="__NEXT_DATA__">`, and reads `ROOT_QUERY.assets({"ids":"<paperId>"}).0`. Prices are quoted in agorot and divided by 100 to normalize to ILS (same convention as IBI). No API key, no mapping — IBI paper number is the URL. Yahoo remains the primary source for mapped tickers (provides 52w high/low); TheMarker fills daily change/volume only. Also invoked if Yahoo returns no data for a mapped TASE ticker.
- **Stooq fallback (US)** — Yahoo Finance is unreliable from Railway (the `yahoo-finance2` crumb fetch to `fc.yahoo.com` frequently fails with `ETIMEDOUT` or 429, taking the whole library offline). `stooq.service.ts` is a reliable fallback for US equities and the S&P 500 (`^GSPC` → `^spx`). Endpoint: `https://stooq.com/q/l/?s=<sym>.us&f=spd2t2ohlcv` — CSV fields: symbol, prevClose, date, time, open, high, low, close, volume. `dayChange` derived as `close - prevClose`. Delayed ~15 min, no 52w high/low. Kicks in whenever Yahoo fails for a US ticker (per-ticker `No quote data` response OR the whole Yahoo call throwing). Does NOT cover TASE — TASE fallback is TheMarker.
- **Portfolio snapshots** — Auto-captured once per day after 15:00 UTC (~17:00 IST) on first API request. Also manually triggerable via `POST /api/snapshots/capture`. One snapshot per calendar day (upsert on date).
- **AI chat** — Persistent right-side drawer (400px on ≥md, full-width on mobile). Uses Zustand store (`chat-store.ts`) for state, SSE streaming from `POST /api/chat`. Messages rendered with `react-markdown`. Tool calls shown as collapsible indicators.
- **Responsive layout** — Mobile-first. Sidebar is a fixed 240px column on ≥md and collapses to an off-canvas drawer on <md (hamburger in TopBar, state in `ui-store.ts`). ChatDrawer is full-width on <md, 400px on ≥md. Tables wrap in `overflow-x-auto` containers. Grid layouts use `grid-cols-{1|2} … lg:grid-cols-4` pattern. Main padding is `p-3 sm:p-6`. Viewport meta set via `viewport` export in `apps/web/src/app/layout.tsx`.
- **AI tool architecture** — Tools defined in `apps/api/src/ai/tools/` grouped by tier. Each file exports schemas (Anthropic format) + executor map. Registry in `tools/index.ts` combines all. Chat handler in `ai/chat-handler.ts` runs the agentic loop (stream → detect tool_use → execute → stream again).
- **FIFO caching** — `runFifoMatching()` results cached in-memory with 1-minute TTL to avoid redundant re-computation when multiple AI tools call it within the same chat turn.
- **Stock detail page** — `/positions/:ticker` is backed by `stock-detail.service.ts` + `routes/stock.ts` and composes existing services (trade, pnl, position, market, exchange-rate). `StockSummary` aggregates per-currency realized P&L, commissions paid, and dividends (with tax withheld). The service does NOT run its own SQL queries for P&L/lots — it filters the cached `runFifoMatching()` output via `getMatchedLotsForTicker()` / `getOpenLotsForTicker()`. Currency impact (USD tickers only) decomposes unrealized P&L into "price move" vs "FX move" per open FIFO lot using historical BOI rates from `getRate(buyDate)`. The small interaction term is folded into price-move so the two components sum to the total unrealized ILS P&L cleanly. URL uses `encodeURIComponent(ticker)` everywhere — TASE paper numbers like `1081820` are fine as URL segments.
- **Historical price chart** — `market.service.getHistoricalPrices(ticker, market, from, to)` returns daily closes via `yahoo-finance2.chart()` (primary) with `stooq.service.fetchStooqHistorical()` as the US fallback. Unmapped TASE tickers (TheMarker-only) return `{ available: false, reason: 'unmapped_tase' }` — TheMarker exposes only current quote, no history. Results cached in-memory for 24h keyed by `ticker|from|to`. `StockChart.tsx` renders a Recharts `LineChart` with `<ReferenceDot>` per BUY (green) / SELL (red) executed-price marker and a dashed `<ReferenceLine>` at the current avg cost (only when position is open). Buy/sell dates that fall on market holidays snap to the nearest prior data point so markers still render on the X axis (category scale). No new `price_history` DB table — persistent OHLCV storage is deferred to Phase 5.

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

## Deployment (Railway)

Hosted on Railway at https://web-production-7a48c.up.railway.app — project ID `3a1f80a2-97df-4762-9187-4e6cf4781e76`. Three services: `web`, `api`, `Postgres`.

**Access** — Email + password with email verification (Resend). Session cookies (`takumi_session`) are validated on every API request. The previous HTTP Basic Auth layer was removed in the multi-user migration. The primary user (`nitzan.lary@gmail.com`) was created and backfilled with all pre-migration data by `scripts/bootstrap-users.ts`.

**Service topology:**
- `web` (Next.js) — only service with a public domain. `src/middleware.ts` redirects unauthenticated requests (no session cookie) to `/login`. `next.config.mjs` rewrites `/api/:path*` to `${API_URL}/api/:path*` server-side, where `API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`.
- `api` (Express) — private-only (no public domain). Explicitly listens on `::` (IPv6+IPv4) which Railway's private networking requires. `PORT=3001` must be set as a service variable so `${{api.PORT}}` resolves in the web service's `API_URL`.
- `Postgres` — managed plugin, referenced as `${{Postgres.DATABASE_URL}}` from api.

**Deploy flow:**
- We now deploy by pushing to GitHub — Railway auto-deploys on push to `master`.
- API build: `pnpm install --frozen-lockfile=false && pnpm --filter @takumi/db exec prisma generate`.
- API preDeploy: `pnpm --filter @takumi/db exec prisma db push && pnpm --filter @takumi/api run bootstrap-users` (schema sync + idempotent primary-user bootstrap; script is a no-op after first successful run).
- API start: `pnpm --filter @takumi/api start` (uses `tsx`, not a compiled `dist/`, so workspace TypeScript deps work).
- Web build: `pnpm install --frozen-lockfile=false && pnpm --filter @takumi/web build`.
- Web start: `pnpm --filter @takumi/web start` → `next start -H ::`.

**Required service variables:**

| Service | Variable | Value |
|---|---|---|
| api | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| api | `ANTHROPIC_API_KEY` | Claude key |
| api | `PORT` | `3001` (explicit, so `${{api.PORT}}` resolves for web's `API_URL`) |
| api | `APP_URL` | Public URL of the web service — used in verification + reset emails |
| api | `RESEND_API_KEY` | Resend API key for transactional email (unset = log-only) |
| api | `EMAIL_FROM` | `"Takumi <onboarding@resend.dev>"` (or your verified domain sender) |
| api | `BOOTSTRAP_USER_EMAIL` / `BOOTSTRAP_USER_PASSWORD` | One-time, consumed by bootstrap-users.ts. Safe to leave set — script is idempotent. |
| web | `API_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` |

**Local dev vs prod** — `API_URL` defaults to `http://localhost:3001`. Same `/api/*` paths work locally via the same rewrite. For local dev without running the full auth flow, set `AUTH_DEV_BYPASS_USER_ID` on the api service to your user's id — `requireAuth` will resolve that user without a session cookie. NEVER set this in prod.

## External Services

| Service | Purpose | Phase | Status | Notes |
|---|---|---|---|---|
| Resend | Transactional email (verification, password reset) | 5 | **Active** | REST API called directly (no SDK). No-op when `RESEND_API_KEY` unset — logs the email instead. |
| Yahoo Finance (`yahoo-finance2` v3) | Live prices, benchmarks (TA-125, S&P 500) | 3 | **Active** | TASE tickers resolved via `tase-ticker-map.json` → `.TA` suffix. 15-min cache staleness. |
| TheMarker Finance (scrape) | Price fallback for unmapped TASE tickers (mutual funds) | 3 | **Active** | Scrapes `finance.themarker.com/stock/{paperId}` `__NEXT_DATA__` Apollo cache. No auth, no mapping. Agorot → ILS. No 52w high/low. |
| Stooq (CSV API) | Price fallback for US tickers + S&P 500 when Yahoo is blocked | 3 | **Active** | `https://stooq.com/q/l/?s=<sym>.us&f=spd2t2ohlcv`. No auth. Delayed ~15 min. Derives `dayChange` from prevClose. No 52w high/low. |
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
- **Transaction filtering**: XLSX import stores ALL transaction types (trades, dividends, fees, taxes, etc.) in the `trades` table. Only `BUY`/`SELL` directions are "core trades" used by P&L, positions, analytics, and the default trades API. Non-trade types are preserved for future processing. The relevant IBI סוג פעולה values for core trades are: `קניה רצף` (TASE buy), `מכירה רצף` (TASE sell), `קניה חול מטח` (US buy), `מכירה חול מטח` (US sell), plus `קניה שח` / `מכירה שח` when the security is a TASE mutual fund (see next bullet). `CORE_DIRECTIONS` constant in `@takumi/types` defines `['BUY', 'SELL']`.
- **XLSX שם נייר patterns** — The XLSX parser extracts tickers from security name prefixes: `דיב/` (dividend), `מסח/` (dividend tax), `מס/` (tax), `COMPANY(TICKER)` (trade), `TICKER US` (trade). FX conversions use `B USD/ILS X.XXX`. TASE uses paper numbers. Admin uses code 900 plus the full 999xxxx range (`/^9{3}\d{4}$/`) — e.g., 9992975, 9992983, 9993975, 9993983 are all tax/admin pseudo-tickers.
- **`קניה שח` / `מכירה שח` disambiguation** — IBI reuses these two action types for three unrelated events: (a) FX conversions on `B USD/ILS X.XXX` rows, (b) TASE mutual-fund buys/sells paid in shekels (funds like 5124573 that don't trade continuously so don't use `קניה רצף` / `מכירה רצף`), and (c) tax/admin entries on 999xxxx codes. The parser defaults both to `CONVERSION`/`CREDIT` (FX case) and `refineDirection` promotes them to `BUY`/`SELL` when `parseSecurity` classifies the row as `TASE`. Without this refinement TASE mutual-fund positions are invisible to /positions and analytics. Migration script for pre-fix data: `scripts/fix-tase-shekel-trades.ts` (idempotent, re-parses `rawPayload`).
