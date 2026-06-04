# Takumi — Personal Trading Intelligence Platform

> **Keep this file updated.** When you change structure, conventions, services, routes, or architecture, update the relevant section so future sessions have accurate context.

## What This Is

A multi-user web app for independent investors trading Israeli (TASE) and US equities through IBI broker. Transactions are imported from IBI XLSX exports. Provides analytics dashboards and a persistent AI chat agent powered by Claude. All data is per-user — scoped by `user_id`.

Full PRD in `Takumi_PRD.md`. Remaining work (alert engine, Tier 3 enrichment, hardening) is tracked in **GitHub issues**, not here — this doc describes the system as it exists today.

## Working Guidelines

> Adapted from [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills). Bias toward caution over speed; use judgment on trivial tasks.

1. **Think before coding** — state assumptions, surface tradeoffs, ask when unclear instead of guessing silently.
2. **Simplicity first** — minimum code that solves the stated problem; no speculative features, abstractions, or error handling for impossible cases.
3. **Surgical changes** — touch only what the request needs; match existing style; don't refactor what isn't broken; only remove orphans your change created.
4. **Goal-driven execution** — turn the task into a verifiable success criterion and loop until verified.

## Architecture

```
Browser → Next.js web (session cookie gate) → rewrites /api/* → Express API (private) → Postgres
                                                      ↕
                                       Anthropic Claude API · Resend (email)
```

- **Frontend** calls relative `/api/*`; Next.js rewrites server-side to `API_URL`. Browser never sees the API origin. `src/middleware.ts` redirects unauthenticated requests to `/login` (checks `takumi_session` cookie).
- **Express** is the single gateway. All routes except `/api/health` and `/api/auth/*` require a session (`requireAuth`); `req.user.id` is set on every authed request and every service scopes Prisma queries by it.
- **Auth** — email+password, bcrypt cost 12. Session tokens are 32-byte randoms stored as SHA-256 hashes in `sessions`; httpOnly cookie, 30-day rolling expiry. **Email verification is currently disabled** (no verified Resend domain): signup auto-verifies and logs in; verify/reset endpoints remain in code for when a domain is configured.
- **Database** — Postgres (Railway for prod), Prisma ORM.

## Monorepo Structure

pnpm workspaces + turbo.

```
apps/
  web/   # Next.js 14, App Router, Tailwind, TanStack Query
    src/app/         # Pages (see Frontend Pages) + api/chat/route.ts (SSE proxy, bypasses rewrites)
    src/components/  # layout/, auth/, ai/ (ChatDrawer, MessageBubble, ChatInput…), stock/, dashboard/, profile/
    src/stores/      # chat-store.ts, ui-store.ts
    src/lib/         # api-client.ts (401→/login), formatters.ts, sse-client.ts
  api/   # Express 5, TypeScript, Prisma
    src/index.ts     # auth router (public) + requireAuth + resource routers
    src/routes/      # auth, trades, sync, positions, analytics, market, exchange-rates, stock, chat
    src/services/    # trade, sync, xlsx-import, pnl, position, analytics, market, themarker, stooq, funder,
                     #   exchange-rate, equity-curve, risk, whatif, alt-investment, stock-detail, email
    src/data/        # tase-ticker-map.json, sector-map.json
    src/ai/          # system-prompt, chat-handler, conversation.service, tools/ (core, tier1, tier2)
packages/
  db/      # Prisma schema + client (@takumi/db singleton)
  types/   # Shared TS interfaces (@takumi/types)
scripts/   # dev.sh, seed.ts, bootstrap-users.ts (one-time primary-user backfill, idempotent)
```

## Key Commands

```bash
bash scripts/dev.sh                      # start API + web
pnpm --filter @takumi/api dev            # Express on :3001
pnpm --filter @takumi/web dev            # Next.js on :3000
pnpm --filter @takumi/db db:generate     # regenerate Prisma client
pnpm --filter @takumi/db db:push         # push schema
```

## Environment Variables

`.env` at project root, loaded via `dotenv` in `apps/api/src/lib/config.ts`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `ANTHROPIC_API_KEY` | Claude API key |
| `API_PORT` / `WEB_PORT` | Express (:3001) / Next.js (:3000) ports |
| `APP_URL` | Public web URL — embedded in verification/reset email links |
| `RESEND_API_KEY` | Resend email key. Unset = email sends become console logs. |
| `EMAIL_FROM` | Resend from address |
| `AUTH_DEV_BYPASS_USER_ID` | **Dev-only.** `requireAuth` resolves this user without a session. Never set in prod. |
| `BOOTSTRAP_USER_EMAIL` / `BOOTSTRAP_USER_PASSWORD` | Consumed only by `bootstrap-users.ts`. |

## Database

Schema in `packages/db/prisma/schema.prisma` (Postgres). All monetary fields use `Decimal`. **12 tables:**

| Table | Purpose / Key Notes |
|---|---|
| `users` | Accounts. `password_hash`, `email_verified_at`, `display_name`, `currency_pref`, `cost_basis_method`, investor-profile fields. |
| `sessions` | `token_hash` = SHA-256 of cookie. 30-day rolling expiry, cascades on user delete. |
| `verification_tokens` | Email-verify + password-reset. `purpose ∈ {email_verify, password_reset}`. |
| `trades` | All transactions. Unique `(userId, tradeId, source)`. `direction`: BUY/SELL (core) + DIVIDEND/TAX/FEE/TRANSFER/CONVERSION/… Services filter to BUY/SELL and scope by `userId`. Extra: `proceeds_fx`, `proceeds_ils`, `capital_gains_tax`. |
| `securities` | Shared reference data. Unique `ticker`. Has `yahoo_symbol`, `industry`, `market_cap_bucket`, `funder_kind`. |
| `sync_log` | Per-user import history; has `file_name`. |
| `alerts` | Per-user. 6 types: price_drop, price_target, holding_duration, portfolio_pnl, sync_failure, inactivity. |
| `market_prices` | Shared cached quotes. `volume` is `BigInt`. Has dayChange/dayChangePct/high52w/low52w. |
| `exchange_rates` | Shared daily ILS/USD. Unique `date`. |
| `price_history` | Shared daily closes (close-only). Unique `(ticker, date)`. Populated lazily by `market.service.getHistoricalPrices`. |
| `ai_conversations` / `ai_messages` | Per-user chat sessions + messages (role user/assistant/tool, optional `tool_calls`). |

## API Routes (Express)

All except `/api/health` and `/api/auth/*` need a session.

- **auth** (`auth.ts`): `signup` (auto-verifies + session), `login`, `logout`, `me`, `verify-email`, `resend-verification`, `forgot-password`, `reset-password`, `PUT profile` (investor horizon/goal/notes).
- **trades** `GET /api/trades` — paginated/filterable; BUY/SELL by default, `includeNonTrades=true` for all.
- **sync** `GET /api/sync/status|log`, `POST /api/sync/import` (multipart XLSX).
- **positions** `GET /api/positions` — open positions (FIFO) + live prices.
- **analytics** `GET /api/analytics/summary|pnl|risk|equity-curve`. `pnl?groupBy=ticker|month|market` (market supports `window=all|ytd|12m`, adds `realizedPnlIls`); `equity-curve?window=1w|1m|ytd|1y|all`.
- **market** `GET prices|benchmarks|unmapped`, `POST refresh|map`.
- **exchange-rates** `GET /api/exchange-rates`, `POST /backfill`.
- **stock** `GET /api/stock/:ticker/summary|open-lots|round-trips|chart` (works for open & closed positions).
- **chat** `POST /api/chat` (SSE), `GET|DELETE /api/chat/conversations[/:id]`.

## Frontend Pages

Auth pages render without sidebar/topbar chrome; all others require a session (middleware → `/login?next=…`). Layout: 240px sidebar + 56px topbar, mobile-first (sidebar collapses to drawer <md).

| Route | Description |
|---|---|
| `/login` `/signup` `/verify-email` `/forgot-password` `/reset-password` | Auth flow. |
| `/dashboard` | Portfolio Total + per-market cards (ILS home currency, native + cross-currency). Equity Curve card (Recharts, 1W/1M/YTD/1Y/All): Account Value vs Cumulative External Capital — gap = total P&L. Components in `components/dashboard/`. |
| `/positions` | Open positions table, live prices, day change %, weight %, auto-refetch 60s. Ticker → `/positions/:ticker`. |
| `/positions/:ticker` | Per-stock detail. Header + tabs (Overview, Trades, Round-trips, Dividends & Fees) + price chart with buy/sell markers. Open & closed. Components in `components/stock/`. |
| `/history` | Trade table, filters, "show all transactions" toggle. |
| `/analytics` | Realized P&L, behavioral stats, TASE-vs-US, per-ticker breakdown, monthly heatmap, risk cards (HHI/drawdown/Sharpe/Sortino). |
| `/import` | XLSX drag-drop import with history. |
| `/alerts` | Stub. |
| `/settings` | Investor profile editor + account info. |

## Conventions

- **TypeScript ESM everywhere** — always use `.js` extensions in import paths (`./lib/config.js`). Shared types in `@takumi/types`; Prisma client re-exported from `@takumi/db`. Frontend pages are `"use client"`, data via TanStack Query (`lib/api-client.ts`), formatting via `lib/formatters.ts`.
- **Per-user scoping (CRITICAL)** — every service touching per-user tables takes `userId` first and threads it into the Prisma `where`. Route handlers read `req.user!.id`. The FIFO match cache in `pnl.service.ts` is **keyed by userId** (single-key would leak across users). `securities`/`market_prices`/`exchange_rates` are shared, not scoped.
- **ILS home currency (CRITICAL)** — `position.service.ts` precomputes `marketValueIls`/`totalCostIls`/`unrealizedPnlIls` via current BOI rate. Every cross-position aggregate (weights, analytics totals, AI tools, system prompt) MUST use the `*Ils` fields — summing native `marketValue` across ILS+USD inflates TASE weights ~3.7×. Per-row native values stay correct for display.
- **Per-currency P&L** — `getPortfolioSummary()` returns `pnlByCurrency`; never mix currencies in one formatted amount.
- **TASE price units** — IBI `שער ביצוע` for Israeli securities is in **agorot** (÷100 → ILS); parser divides by 100 when `market==="TASE"`. Sanity: `qty × price + commission ≈ |proceedsIls|`.
- **TASE identification** — TASE uses IBI paper number as `ticker`, paper name as `securityName`. US uses standard symbols. Hebrew names wrapped `dir="rtl"` via `isHebrew()`.
- **US ticker renames** — IBI updates `symbol` but not `securityName` on renames (FIVG→SIXG, FB→META…). `parseSecurity` prefers `symbol` when it matches the US-ticker regex so pre/post rows key to the same ticker. `StockSummary.priorNames` drives the "Formerly known as…" UI.
- **Display-name caching** — `market.service` upserts `securities.name` from Yahoo `longName`; positions/stock-detail prefer it over IBI's stale names.
- **XLSX import** — `xlsx-import.service.ts` parses Hebrew columns, maps transaction types via `DIRECTION_MAP`, extracts tickers from `שם נייר` patterns, dedups via deterministic `tradeId`. Writes are **bulk/parallel** (createMany + chunked updates) — do not revert to serial upsert (hit Next.js ~30s proxy timeout). Re-upload is safe.
- **Equity curve (on-demand)** — `equity-curve.service.ts` walks trades chronologically (cash + holdings × historical close, USD→ILS at per-day BOI rate). Two lines: Account Value and Cumulative External Capital (deposits−withdrawals); **gap = total P&L**. Implicit-deposit detection credits negative-cash shortfalls; TRANSFER rows carry real cash moves. Total Return % via Modified Dietz; 60s per-user memo. Also powers `risk.service` and AI `get_benchmark_comparison`.
- **Price sources** — Yahoo (`yahoo-finance2`) primary, cached in `market_prices` (15-min staleness). Fallbacks: **Stooq** (US + S&P 500, Yahoo unreliable from Railway), **TheMarker** (current quotes for unmapped TASE funds), **funder.co.il** (TASE history — securities `seco/` ÷100, funds `fundo/` already ILS). TASE→Yahoo mapping in `tase-ticker-map.json` (`.TA` suffix). If TASE history returns `[]` with `FunderParseError`, re-run `funder/discover-endpoints.ts` (Playwright).
- **Historical prices** — `market.service.getHistoricalPrices` is DB-first: read `price_history`, fill only the **tail gap** from upstream (mid-range gaps = market holidays), bulk-insert (immutable, no UPDATE), merge+dedupe. `source ∈ {yahoo,stooq,funder}`. `StockChart.tsx` plots closes with buy/sell ReferenceDots + avg-cost ReferenceLine.
- **AI chat** — right-side drawer (400px / full-width mobile), Zustand `chat-store.ts`, SSE from `POST /api/chat` via Next route handler `app/api/chat/route.ts` (NOT the rewrite — flushes per event). `react-markdown` rendering, collapsible tool indicators, Stop via AbortController. `FloatingChatBar` hands off draft text on open.
- **AI tools** — defined in `apps/api/src/ai/tools/` by tier; registry in `tools/index.ts`; agentic loop in `chat-handler.ts`. Executor signature `(userId, input)`. `runFifoMatching()` cached 1-min TTL.
- **Investor profile (AI framing)** — `users.investor_horizon`/`investor_goal`/`investor_notes` declared at onboarding, editable in `/settings`. `buildSystemPrompt` injects them plus an inferred horizon from `avgHoldingDays`. Enum values mirrored in `auth.ts`, `UserProvider.tsx`, `InvestorProfileForm.tsx` — keep in sync.
- **Stock detail** — `stock-detail.service.ts` composes existing services (no own SQL), filtering cached FIFO output. USD currency-impact splits unrealized P&L into price vs FX move via historical BOI rates. URLs use `encodeURIComponent(ticker)`.
- **Logging (API)** — structured via **pino** (`lib/logger.ts`). `pino-http` (mounted in `index.ts` after `express.json()`) attaches a per-request child logger on `req.log` + a `req.id` (reuses incoming `x-request-id`, else a UUID, echoed back as a response header) and logs every request with method/url/status/responseTime/`userId`. Pretty output in dev, raw JSON in prod (`LOG_LEVEL` env, default `info`). In services (no `req`) import the base `logger`; pass context as the first arg object with a `module` field, e.g. `logger.warn({ module: 'market', ticker, err }, 'msg')`. Don't add new `console.*`.
- **Errors (API)** — central `error-handler.ts` (last middleware). Express 5 auto-forwards async rejections here, so routes need no try/catch. Throw `AppError(statusCode, code, message)` (`lib/errors.ts`) for precise non-500s; anything else is a 500 (message hidden in prod). Always responds `{ error: code, message, statusCode, requestId }` and logs the full stack with request/user context.
- **Error boundaries (web)** — App Router `error.tsx` per major segment (`dashboard`, `positions`, `positions/[ticker]`, `analytics`, `history`, `settings`) + a root `app/error.tsx` and `app/global-error.tsx` (own `<html>`, catches root-layout failures). Each is a thin `"use client"` wrapper rendering the shared `components/ErrorFallback.tsx` (Try-again via `reset()`) and `console.error`-logging the error. A segment crash keeps sidebar/topbar chrome; no external telemetry sink yet.

## Deployment (Railway)

Hosted at https://web-production-7a48c.up.railway.app (project `3a1f80a2-…`). Services: `web` (public), `api` (private, listens on `::`), `Postgres`. Push to `master` → auto-deploy.

- **web** — only public service. `next.config.mjs` rewrites `/api/:path*` → `${API_URL}`; `API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`. Start: `next start -H ::`.
- **api** — `PORT=3001` must be explicit. preDeploy runs `prisma db push` + `bootstrap-users`. Starts via `tsx` (not compiled dist).
- **Required vars** — api: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `ANTHROPIC_API_KEY`, `PORT=3001`, `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`. web: `API_URL`.
- **Local dev** — `API_URL` defaults to `http://localhost:3001`. Set `AUTH_DEV_BYPASS_USER_ID` (api) to skip auth locally; never in prod.

## External Services

| Service | Use | Notes |
|---|---|---|
| Resend | Email (verify/reset) | REST direct. No-op (logs) when key unset. |
| Yahoo Finance (`yahoo-finance2`) | Live prices, benchmarks | TASE via `.TA` map. 15-min cache. |
| Stooq | US + S&P 500 fallback | CSV, delayed ~15min, no 52w hi/lo. |
| TheMarker (scrape) | Unmapped-TASE current quotes | `__NEXT_DATA__` Apollo cache, agorot→ILS. |
| funder.co.il (scrape) | TASE history (securities + funds) | `seco/`+`fundo/` JS literals; only source for fund history. Fragile to markup drift. |
| Bank of Israel SDMX | Official ILS/USD rates | Free, backfills `exchange_rates`. |

## AI Agent Tools (22 built)

- **Core (11)**: portfolio summary, query trades, P&L breakdown, behavioral report, what-if, market price, create/list/delete alert, trigger/get sync status.
- **Tier 1 (7)** — no external APIs: dividend summary, cost analysis, performance timeline, streaks, sector exposure, security info, holding-period analysis.
- **Tier 2 (4)**: benchmark comparison, currency impact, risk report, alternative-investment sim.
- Tier 3 (technical indicators, news/events, tax) not built — see GitHub issues.

## Gotchas

- `DATABASE_URL` must be an **absolute** path.
- **Transaction filtering** — XLSX stores ALL types; only BUY/SELL are core (P&L/positions/analytics). `CORE_DIRECTIONS = ['BUY','SELL']`. Migration scripts for pre-fix data live in `scripts/` (idempotent, re-parse `rawPayload`).
- **DIRECTION_MAP must cover every IBI `סוג פעולה`** — unmapped rows are skipped + logged "Unknown transaction type". Add new Hebrew types in `xlsx-import.service.ts`.
- **`קניה שח`/`מכירה שח` disambiguation** — reused for FX conversions, TASE mutual-fund trades, and tax/admin rows. `refineDirection` promotes to BUY/SELL only when `parseSecurity` says TASE; without it fund positions are invisible.
- **Admin pseudo-tickers** — code 900 + the full `/^9{3}\d{4}$/` range are tax/admin, not securities.
- Pre-existing TS2742 errors in Express routes (Express 5 + `declaration: true`) — runtime-harmless (tsx skips type checking).
- Unmapped TASE tickers fall back to placeholder prices (= avg cost) on /positions; manage via `GET /api/market/unmapped` / `POST /api/market/map`.
