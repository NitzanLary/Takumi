# Takumi — Current Requirements & Feature Inventory

> **Status:** Reverse-engineered audit of the codebase as of 2026-05-17.
> **Scope:** Only features that exist and work today. Planned Phase 5 work (alert engine, news, tax intelligence, etc.) is **not** included — see `Takumi_PRD.md` for the original product intent.
> **Purpose:** Single reference for deciding which features to keep, change, or remove now that the target product is clear.

---

## 1. Overview

Takumi is a multi-user web app for an independent investor trading Israeli (TASE) and US (NYSE/NASDAQ) equities through IBI broker. Transactions are imported from IBI XLSX exports, normalized, FIFO-matched into open positions and round-trips, enriched with live market data, and surfaced through analytics dashboards, per-stock detail pages, and a persistent Claude-powered AI chat agent (22 tools across 3 capability tiers). All data is per-user, scoped at every service boundary. Deployed on Railway across three services (web, api, Postgres).

This document catalogs **every behavior the app currently exhibits** — both backend-driven and frontend-only.

## 2. Categorization Scheme

### ID format

```
FR-{CAT}-{NNN}    Functional requirement
NFR-{CAT}-{NNN}   Non-functional requirement
[FE-ONLY]         Tag — feature has no backend counterpart
```

Numbers are stable within each category; never re-use a number even if a requirement is later removed (mark it `(removed)` instead).

### Functional categories

| Code | Domain |
|---|---|
| `AUTH` | Authentication, sessions, account & investor-profile management |
| `DATA` | XLSX import, transaction parsing, sync log |
| `PORT` | Portfolio aggregates, open positions, daily snapshots, equity curve |
| `ANLY` | Realized P&L, behavioral stats, risk metrics, breakdowns |
| `STOCK` | Per-stock detail page, FIFO round-trips, dividends/fees, price chart |
| `MKT` | Market data integration, exchange rates, ticker mapping |
| `AI` | Chat agent, tools, conversation persistence, system prompt |
| `UI` | Frontend-only UX behaviors (not reflected in any API) |
| `ADMIN` | Settings, alert CRUD, sync status surface, import history |

### Non-functional categories

| Code | Quality attribute |
|---|---|
| `SEC` | Security (auth, validation, scoping) |
| `PERF` | Performance (caches, batching) |
| `REL` | Reliability (fallbacks, idempotency) |
| `OBS` | Observability (logging, audit trails) |
| `TENANT` | Multi-tenancy & data isolation |
| `SCALE` | Scalability ceilings & limits |
| `DEPLOY` | Deployment topology & operations |
| `COMPAT` | Browser, device, locale compatibility |

---

## 3. Functional Requirements

### FR-AUTH — Authentication & Account

#### FR-AUTH-001 — Email + password signup
A visitor can create an account by submitting email (RFC-valid, ≤254 chars), password (8–200 chars), and optional display name (≤80 chars). The email is normalized (trimmed, lowercased). Duplicate emails return 409.
**Source:** apps/api/src/routes/auth.ts (`POST /api/auth/signup`), apps/web/src/app/signup/page.tsx

#### FR-AUTH-002 — Signup auto-verifies the account
Because no verified Resend sending domain has been configured, signup currently sets `emailVerifiedAt = now()` immediately, creates a session, and logs the user in directly. The email-verification email is **not** sent.
**Source:** apps/api/src/routes/auth.ts (lines 107–116)

#### FR-AUTH-003 — Login with email + password
Existing users can exchange credentials for a session cookie. Wrong-credential responses are 401 with a generic "Invalid email or password" message. A bcrypt comparison is always performed (even when the user doesn't exist) to mitigate timing-based user enumeration.
**Source:** apps/api/src/routes/auth.ts (`POST /api/auth/login`), apps/web/src/app/login/page.tsx

#### FR-AUTH-004 — Session cookie issuance
On signup or login, a 32-byte random session token is generated and stored as a SHA-256 hash in the `sessions` table. The raw token is set as the `takumi_session` cookie with `httpOnly`, `Secure` (prod only), `SameSite=Lax`, `path=/`, and a 30-day `maxAge`.
**Source:** apps/api/src/routes/auth.ts (lines 26–46), apps/api/src/middleware/require-auth.ts

#### FR-AUTH-005 — Session validation on every API request
All `/api/*` routes except `/api/health` and `/api/auth/*` are gated by `requireAuth`. The middleware parses the cookie, looks up the session by `tokenHash`, rejects missing/expired sessions with 401, and attaches `{ id, email }` to `req.user`.
**Source:** apps/api/src/middleware/require-auth.ts, apps/api/src/index.ts

#### FR-AUTH-006 — Rolling 30-day session refresh
If a session has not been touched in the last 24 hours, its `expiresAt` is bumped 30 days into the future. The update is fire-and-forget so it never blocks the request. Active users effectively stay logged in indefinitely.
**Source:** apps/api/src/middleware/require-auth.ts (lines 59–67)

#### FR-AUTH-007 — Session metadata capture
Each session row records the originating `userAgent` (truncated to 200 chars) and `ipAddress` (first entry of `X-Forwarded-For` or `req.ip`). Used only for audit, never surfaced in UI today.
**Source:** apps/api/src/routes/auth.ts (lines 121–128, 156–164)

#### FR-AUTH-008 — Logout deletes the session
`POST /api/auth/logout` looks up the session by `tokenHash`, deletes the matching row, and clears the cookie. Best-effort — succeeds even if the cookie is missing or the row is already gone.
**Source:** apps/api/src/routes/auth.ts (lines 172–184)

#### FR-AUTH-009 — Current user bootstrap (`/api/auth/me`)
The frontend fetches the current user (id, email, displayName, emailVerifiedAt, investor profile fields) on app mount via `UserProvider`. Returns 401 if not authenticated. Public paths skip the call.
**Source:** apps/api/src/routes/auth.ts (lines 244–260), apps/web/src/components/UserProvider.tsx

#### FR-AUTH-010 — Email verification endpoint exists but is inactive
`POST /api/auth/verify-email` consumes a token from the `verification_tokens` table (24h expiry, purpose=`email_verify`), marks the user verified, and consumes the token in one transaction. The verify-email page wires this up, but no live signup currently triggers the email.
**Source:** apps/api/src/routes/auth.ts (lines 188–212), apps/web/src/app/verify-email/page.tsx

#### FR-AUTH-011 — Resend verification email
`POST /api/auth/resend-verification` always returns 200 (to avoid user enumeration). If the user exists and is unverified, generates a new token and calls `sendVerificationEmail`. With email currently disabled, this is effectively dormant.
**Source:** apps/api/src/routes/auth.ts (lines 216–240)

#### FR-AUTH-012 — Forgot-password flow
`POST /api/auth/forgot-password` always returns 200. If the user exists, generates a 1-hour reset token and calls `sendPasswordResetEmail`. The "Forgot?" link on the login page is currently hidden in the UI because email isn't wired up — the endpoint still works.
**Source:** apps/api/src/routes/auth.ts (lines 313–337), apps/web/src/app/forgot-password/page.tsx

#### FR-AUTH-013 — Reset-password with token
`POST /api/auth/reset-password` validates the token, updates `passwordHash`, consumes the token, and **deletes all existing sessions** for that user in one transaction. Forces re-login on every device.
**Source:** apps/api/src/routes/auth.ts (lines 344–365), apps/web/src/app/reset-password/page.tsx

#### FR-AUTH-014 — Investor-profile update
`PUT /api/auth/profile` accepts partial updates of `horizon` (enum: intraday/swing/position/long_term/mixed), `goal` (enum: aggressive_growth/steady_growth/income/preservation/learning), and free-text `notes` (≤500 chars). `null` clears a field; `undefined` leaves it. `investorProfileUpdatedAt` is always set to now, marking onboarding as completed even on empty submits.
**Source:** apps/api/src/routes/auth.ts (lines 264–307)

#### FR-AUTH-015 — Local-dev auth bypass
If `AUTH_DEV_BYPASS_USER_ID` is set, `requireAuth` resolves to that user without any session lookup. Strict dev-only — never set in production.
**Source:** apps/api/src/middleware/require-auth.ts (lines 32–42)

#### FR-AUTH-016 — Dev bootstrap script (primary user backfill)
`scripts/bootstrap-users.ts` creates the primary user from `BOOTSTRAP_USER_EMAIL`/`BOOTSTRAP_USER_PASSWORD` env vars and backfills `user_id` on legacy rows (trades, alerts, snapshots, conversations, sync logs). Idempotent — runs as Railway preDeploy and is a no-op on subsequent deploys.
**Source:** scripts/bootstrap-users.ts

#### FR-AUTH-017 — Web middleware redirects unauthenticated visitors
`apps/web/src/middleware.ts` checks for `takumi_session` cookie on every non-public route. If missing, redirects to `/login?next=<original-path+search>`. Public allowlist: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`. `/api/*` passes through (Express enforces its own auth).
**Source:** apps/web/src/middleware.ts

#### FR-AUTH-018 — 401 auto-redirect from frontend API client [FE-ONLY]
`apiFetch` detects 401 responses (outside auth pages) and redirects to `/login?next=<current-path>`, then hangs the promise so the page can be replaced. Prevents stale UI from showing during a forced re-auth.
**Source:** apps/web/src/lib/api-client.ts

---

### FR-DATA — Data Import & Ingestion

#### FR-DATA-001 — XLSX file upload via web
The Import page accepts `.xlsx` files via drag-and-drop or click-to-pick. Multiple files can be queued and imported in a single session.
**Source:** apps/web/src/app/import/page.tsx, apps/api/src/routes/sync.ts

#### FR-DATA-002 — XLSX parsing of IBI Hebrew exports
`xlsx-import.service.ts` parses IBI Excel workbooks with Hebrew column headers, maps 23 `סוג פעולה` (transaction type) values to the `Direction` enum, and extracts ticker/quantity/price/commission/proceeds/tax from each row.
**Source:** apps/api/src/services/xlsx-import.service.ts

#### FR-DATA-003 — Hebrew security-name pattern matching
The parser extracts real tickers from `שם נייר` patterns: `דיב/TICKER` (dividend), `מסח/TICKER` (dividend tax), `מס/TICKER` (other tax), `COMPANY(TICKER)` (US trade), `TICKER US` (US trade). FX conversions match `B USD/ILS X.XXX`. TASE securities use the numeric paper number from `מס' נייר / סימבול`.
**Source:** apps/api/src/services/xlsx-import.service.ts (`parseSecurity`)

#### FR-DATA-004 — US ticker preference logic
When IBI renames a US ticker (e.g. FIVG→SIXG, FB→META), historical rows keep the old `שם נייר` but get the new `סימבול`. The parser prefers the symbol column over the name-embedded ticker for any value matching `^[A-Z][A-Z0-9.-]{0,5}$`. Numeric IBI internal IDs (e.g. 29189461) fall back to the name path.
**Source:** apps/api/src/services/xlsx-import.service.ts

#### FR-DATA-005 — TASE agorot → ILS normalization
For TASE securities, raw IBI `שער ביצוע` is in agorot (1/100 ILS). The parser divides by 100 so `trades.price` is always per-share ILS. Sanity check: `quantity × price + commission ≈ |proceedsIls|`.
**Source:** apps/api/src/services/xlsx-import.service.ts

#### FR-DATA-006 — TASE mutual fund disambiguation
`קניה שח` / `מכירה שח` are reused by IBI for FX conversions, TASE mutual-fund trades, and 999xxxx tax entries. The parser defaults to `CONVERSION`/`CREDIT` and `refineDirection` promotes to `BUY`/`SELL` when the row classifies as a TASE security. Without this, TASE mutual-fund positions are invisible to the rest of the system.
**Source:** apps/api/src/services/xlsx-import.service.ts (`refineDirection`)

#### FR-DATA-007 — Deterministic dedup via tradeId hash
Each row gets a deterministic `tradeId` hash from its content. Re-uploading the same XLSX file (or overlapping date ranges) is idempotent — duplicates are skipped via the `(userId, tradeId, source)` unique constraint.
**Source:** apps/api/src/services/xlsx-import.service.ts, packages/db/prisma/schema.prisma (Trade model)

#### FR-DATA-008 — Batched bulk writes
After parsing, the service pre-fetches existing `tradeId`s for the user+source, then does a single bulk `createMany({ skipDuplicates: true })` for new rows plus chunked parallel `update()` calls (concurrency 10) for existing rows. Serial per-row upserts would exceed Next.js' 30s proxy timeout.
**Source:** apps/api/src/services/xlsx-import.service.ts

#### FR-DATA-009 — Raw payload preservation for re-parsing
Each trade row stores its `rawPayload` JSON blob. Migration scripts (`fix-tase-prices.ts`, `fix-renamed-tickers.ts`, `fix-tase-shekel-trades.ts`) re-parse this blob to retroactively correct historical rows without needing the original XLSX file.
**Source:** apps/api/src/services/xlsx-import.service.ts, scripts/fix-*.ts

#### FR-DATA-010 — Multi-file import session
The Import page tracks each file's lifecycle (queued → uploading → success/failed), shows per-file status icons, expandable error/warning lists, and a "Clear completed" affordance. Sequential upload loop. [FE-ONLY for the session UI; backend handles one file at a time.]
**Source:** apps/web/src/app/import/page.tsx

#### FR-DATA-011 — Sync log persistence
Every import (one per file) writes a `sync_log` row with `status` (success/partial/failed), `recordsAdded`, `dateFrom`, `dateTo`, `fileName`, and `errorMessage` if applicable.
**Source:** apps/api/src/services/sync.service.ts, packages/db/prisma/schema.prisma (SyncLog model)

#### FR-DATA-012 — Sync status endpoint
`GET /api/sync/status` returns the last sync run (timestamp, status, record count). Used by the dashboard and TopBar sync indicator with 30s polling.
**Source:** apps/api/src/routes/sync.ts

#### FR-DATA-013 — Sync history endpoint
`GET /api/sync/log?limit=N` returns recent imports for display on the Import page's history table (file name, time, status pill, records added, date range, error).
**Source:** apps/api/src/routes/sync.ts, apps/web/src/app/import/page.tsx

#### FR-DATA-014 — Unknown transaction-type tolerance
Rows with `סוג פעולה` not present in `DIRECTION_MAP` are skipped and logged. The sync log status becomes `partial` and the error message lists them. Importing continues with the recognized rows.
**Source:** apps/api/src/services/xlsx-import.service.ts

#### FR-DATA-015 — Trade-record schema covers trades + non-trades
The `trades` table stores all 14+ direction types: BUY/SELL plus DIVIDEND, TAX, FEE, TRANSFER, CONVERSION, CREDIT, DEPOSIT, WITHDRAWAL, SPLIT, BONUS, INTEREST, DEBIT, REDEMPTION, RIGHTS. Only BUY/SELL feed P&L; the rest are preserved for downstream features (dividend summary, fee analysis, transaction linking).
**Source:** packages/db/prisma/schema.prisma (Trade.direction), packages/types/src/trade.ts (`Direction`)

#### FR-DATA-016 — Trade query API with filters
`GET /api/trades` accepts `ticker`, `market`, `direction`, `dateFrom`, `dateTo`, `source`, `page`, `limit`, `includeNonTrades`. Defaults to BUY/SELL only. Returns paginated response with `{ data, total, page, limit, totalPages }`.
**Source:** apps/api/src/routes/trades.ts, apps/api/src/services/trade.service.ts

---

### FR-PORT — Portfolio & Positions

#### FR-PORT-001 — FIFO open-lot derivation
Open positions are derived from unmatched buy lots using FIFO matching against sells (`pnl.service.ts`). Multiple buys → multiple lots; each lot tracks `buyDate`, `quantity`, `buyPrice`, `commission` independently.
**Source:** apps/api/src/services/pnl.service.ts (`runFifoMatching`)

#### FR-PORT-002 — Weighted average cost basis per position
Each open position aggregates remaining lots into a single weighted-average `avgCostBasis`, `quantity`, and per-currency `totalCost`.
**Source:** apps/api/src/services/position.service.ts (`getOpenPositions`)

#### FR-PORT-003 — Live price enrichment for open positions
Every open position is enriched with `currentPrice`, `dayChange`, `dayChangePct`, `priceSource`, `unrealizedPnl`, `unrealizedPnlPct`, and `marketValue`. Fetched in bulk per request via `market.service.getLatestPrices`.
**Source:** apps/api/src/services/position.service.ts

#### FR-PORT-004 — ILS-normalized cross-position aggregation
Each position carries `marketValueIls`, `totalCostIls`, `unrealizedPnlIls` computed using the current BOI USD/ILS rate (ILS positions pass through 1:1). All cross-position aggregates (portfolio totals, weights, snapshots) MUST use these fields; raw native fields would inflate TASE weights ~3.7× because USD magnitudes are naked.
**Source:** apps/api/src/services/position.service.ts (CLAUDE.md "ILS home currency for aggregation" convention)

#### FR-PORT-005 — Portfolio weight per position
Each position's `weight` is computed as its `marketValueIls / totalPortfolioValueIls`. Displayed as a percentage in the Positions table and used by `get_sector_exposure` for concentration analysis.
**Source:** apps/api/src/services/position.service.ts

#### FR-PORT-006 — Placeholder pricing for unmapped TASE tickers
TASE tickers with no Yahoo mapping AND no TheMarker quote fall back to `currentPrice = avgCostBasis` (showing zero P&L). The `priceSource: 'placeholder'` flag drives the amber warning banner in the UI.
**Source:** apps/api/src/services/position.service.ts, apps/api/src/services/market.service.ts

#### FR-PORT-007 — Open-positions endpoint
`GET /api/positions` returns the enriched open-position list. Triggers a fire-and-forget daily snapshot capture as a side effect.
**Source:** apps/api/src/routes/positions.ts

#### FR-PORT-008 — Daily portfolio snapshot capture (auto)
On any `GET /api/positions` call after 15:00 UTC (~17:00 IST, after TASE close), if no snapshot exists for today, one is captured: `totalValue`, `totalCostBasis`, `unrealizedPnl`, `realizedPnl`, `positionCount`. Fire-and-forget; never blocks the request.
**Source:** apps/api/src/services/snapshot.service.ts

#### FR-PORT-009 — Daily portfolio snapshot capture (manual)
`POST /api/snapshots/capture` triggers an immediate snapshot regardless of time of day. Used by the dashboard "Capture Snapshot" button when the equity curve is empty.
**Source:** apps/api/src/routes/snapshots.ts, apps/web/src/app/dashboard/page.tsx

#### FR-PORT-010 — Snapshot upsert per day
Snapshots use `@@unique([userId, date])` so re-capturing the same calendar day overwrites rather than duplicates. Safe to call multiple times.
**Source:** packages/db/prisma/schema.prisma (PortfolioSnapshot model)

#### FR-PORT-011 — Snapshot retrieval for equity curve
`GET /api/snapshots?from=&to=` returns snapshot points for the dashboard's equity curve. Optional date range.
**Source:** apps/api/src/routes/snapshots.ts, apps/api/src/services/snapshot.service.ts

#### FR-PORT-012 — Dashboard portfolio total card (ILS home currency)
The dashboard's PortfolioTotalCard shows Market Value, Unrealized P&L, Realized P&L, and Total P&L in ILS with USD-equivalent under each line (using current BOI rate).
**Source:** apps/web/src/components/dashboard/PortfolioTotalCard.tsx

#### FR-PORT-013 — Dashboard per-market breakdown cards
Separate cards for TASE (native ILS) and US (native USD), each showing the same four rows in native currency with the cross-currency equivalent on a second line.
**Source:** apps/web/src/components/dashboard/MarketCard.tsx

#### FR-PORT-014 — Equity curve chart on dashboard
Recharts `LineChart` of portfolio `totalValue` from snapshots. Empty state when <2 points: "Need 2+ snapshots" with a capture button.
**Source:** apps/web/src/app/dashboard/page.tsx

#### FR-PORT-015 — Positions page table
Lists every open position with columns: Ticker, Name, Market, Qty, Avg Cost, Current Price, Market Value, Unrealized P&L (% + amount), Weight. Hebrew names render RTL. Tickers link to `/positions/:ticker`. Day-change % shown when available.
**Source:** apps/web/src/app/positions/page.tsx

#### FR-PORT-016 — Positions page summary strip
Four KPI cards above the table: position count, total cost basis (ILS), total market value (ILS), unrealized P&L (ILS).
**Source:** apps/web/src/app/positions/page.tsx

#### FR-PORT-017 — Refresh-prices action
"Refresh Prices" button on the Positions page calls `POST /api/market/refresh` to force-fetch all current open-position tickers + benchmarks from Yahoo (with Stooq/TheMarker fallbacks) and update the cache.
**Source:** apps/web/src/app/positions/page.tsx, apps/api/src/routes/market.ts

#### FR-PORT-018 — Auto-refetch positions every 60s [FE-ONLY]
TanStack Query refetches `/api/positions` every 60 seconds while the page is open. Keeps market values "live-ish" without manual refresh.
**Source:** apps/web/src/app/positions/page.tsx, apps/web/src/app/dashboard/page.tsx

#### FR-PORT-019 — Auto-refetch sync status every 30s [FE-ONLY]
Sync status (used by Dashboard, Import, TopBar) polls every 30 seconds for fresh import progress.
**Source:** apps/web/src/components/layout/TopBar.tsx, apps/web/src/app/dashboard/page.tsx, apps/web/src/app/import/page.tsx

#### FR-PORT-020 — Placeholder-price warning banner [FE-ONLY]
When any open position has `priceSource: 'placeholder'`, the Positions page renders an amber warning banner suggesting Yahoo mapping in Settings. Dashboard shows a similar note in the portfolio total card.
**Source:** apps/web/src/app/positions/page.tsx

---

### FR-ANLY — Analytics & P&L

#### FR-ANLY-001 — All-time realized P&L (FIFO)
Realized P&L is computed by FIFO-matching every SELL against the oldest unmatched BUY lots. Each match yields `realizedPnl = (sellPrice − buyPrice) × matchedQty − allocated commissions`. Aggregated all-time.
**Source:** apps/api/src/services/pnl.service.ts

#### FR-ANLY-002 — Per-ticker P&L breakdown
`GET /api/analytics/pnl?groupBy=ticker` returns per-ticker rows: ticker, realizedPnl, tradeCount, winCount, lossCount, winRate, avgHoldingDays, currency. Backs the analytics page's breakdown table.
**Source:** apps/api/src/routes/analytics.ts, apps/api/src/services/analytics.service.ts

#### FR-ANLY-003 — Per-month P&L breakdown
`GET /api/analytics/pnl?groupBy=month` returns `{ year, month, pnl, tradeCount }`. Backs the monthly heatmap.
**Source:** apps/api/src/routes/analytics.ts

#### FR-ANLY-004 — Per-market P&L breakdown
`GET /api/analytics/pnl?groupBy=market` returns one row per market (TASE, NYSE, NASDAQ) with `realizedPnl`, `realizedPnlIls` (ILS-normalized via current BOI rate), `tradeCount`, `winRate`. Accepts optional `window=all|ytd|12m` (default `all`, only used by the AI tool).
**Source:** apps/api/src/routes/analytics.ts

#### FR-ANLY-005 — Portfolio summary endpoint
`GET /api/analytics/summary` returns aggregated KPIs: `totalValue`, `totalRealizedPnl` (with `pnlByCurrency` array), `totalUnrealizedPnl`, `winRate`, `totalTrades`, `avgHoldingDays`, plus the open-position list for the dashboard.
**Source:** apps/api/src/routes/analytics.ts, apps/api/src/services/analytics.service.ts

#### FR-ANLY-006 — Per-currency P&L separation
Realized P&L is reported per currency (ILS and USD separately), never mixed in a single formatted amount. Dashboard shows separate lines for each currency.
**Source:** apps/api/src/services/analytics.service.ts (`getPortfolioSummary`)

#### FR-ANLY-007 — Win rate
`% of closed trades with realizedPnl > 0` across all currencies. Surfaced in summary, behavioral report, per-ticker breakdown, and per-market breakdown.
**Source:** apps/api/src/services/analytics.service.ts

#### FR-ANLY-008 — Average holding period
Mean number of days between BUY and matching SELL across all closed trades. Reported overall, by winning vs losing trades, and per holding bucket.
**Source:** apps/api/src/services/analytics.service.ts

#### FR-ANLY-009 — Profit factor
`sum(winning P&L) / abs(sum(losing P&L))`. Reported in the behavioral report.
**Source:** apps/api/src/services/analytics.service.ts

#### FR-ANLY-010 — Largest win & largest loss
Single biggest single-trade win and loss across the entire history.
**Source:** apps/api/src/services/analytics.service.ts

#### FR-ANLY-011 — Average win amount & average loss amount
Mean absolute P&L of winning vs losing closed trades.
**Source:** apps/api/src/services/analytics.service.ts

#### FR-ANLY-012 — Average winning vs losing hold time
Mean holding days split by outcome — helps spot "selling winners too early, holding losers too long".
**Source:** apps/api/src/services/analytics.service.ts

#### FR-ANLY-013 — Best vs worst day-of-week
Day-of-week with highest and lowest aggregate P&L across all closed trades.
**Source:** apps/api/src/services/analytics.service.ts (`getBehavioralReport`)

#### FR-ANLY-014 — TASE vs US comparison
Side-by-side cards on the Analytics page showing realized P&L, trade count, and win rate per market. Derived from the per-market breakdown.
**Source:** apps/web/src/app/analytics/page.tsx

#### FR-ANLY-015 — Monthly P&L heatmap
Year × month grid colored green (positive) / red (negative), intensity scaled by max absolute monthly P&L. Hover shows P&L + trade count. Empty cells for months with no data.
**Source:** apps/web/src/app/analytics/page.tsx [FE-ONLY for color scaling]

#### FR-ANLY-016 — Risk metrics endpoint
`GET /api/analytics/risk` returns `herfindahlIndex`, `maxDrawdown`, `sharpeRatio`, `sortinoRatio`, `topConcentration: {top3, top5}`, `dataPoints`. Requires ≥10 snapshots for Sharpe/Sortino; otherwise those fields are null.
**Source:** apps/api/src/routes/analytics.ts, apps/api/src/services/risk.service.ts

#### FR-ANLY-017 — Herfindahl concentration index
Sum of squared portfolio weights (ILS-normalized). Higher = more concentrated. Surfaced in risk-report tool and Analytics page risk card.
**Source:** apps/api/src/services/risk.service.ts

#### FR-ANLY-018 — Max drawdown
Largest peak-to-trough decline in `totalValue` across the portfolio_snapshots series. Reported as a percentage.
**Source:** apps/api/src/services/risk.service.ts

#### FR-ANLY-019 — Sharpe & Sortino ratios
Annualized risk-adjusted return metrics derived from daily snapshot returns. Sharpe uses standard deviation, Sortino uses downside deviation only.
**Source:** apps/api/src/services/risk.service.ts

#### FR-ANLY-020 — Analytics page composition
Single dashboard combining: realized P&L summary cards, 8 behavioral-stat cards, TASE-vs-US comparison, per-ticker P&L table (with ticker links to `/positions/:ticker`), monthly heatmap, and 4 risk-metric cards. No refetch interval — load-once.
**Source:** apps/web/src/app/analytics/page.tsx

---

### FR-STOCK — Per-Stock Detail Page

#### FR-STOCK-001 — Stock summary endpoint
`GET /api/stock/:ticker/summary` returns the per-stock header: ticker, securityName, priorNames[], market, currency, sector, industry, firstBuyDate, lastTransactionDate, holdingDays, isClosed, position (if open), realizedPnl[], totalFeesPaid[], totalDividends[], currencyImpact. Works for open AND closed positions.
**Source:** apps/api/src/routes/stock.ts, apps/api/src/services/stock-detail.service.ts

#### FR-STOCK-002 — Open FIFO lots endpoint
`GET /api/stock/:ticker/open-lots` returns the unsold buy lots for the ticker, each enriched with current price and per-lot unrealized P&L. Empty for closed positions.
**Source:** apps/api/src/routes/stock.ts

#### FR-STOCK-003 — Round-trips endpoint
`GET /api/stock/:ticker/round-trips` returns completed FIFO-matched buy→sell cycles: entry date, exit date, qty, entry price, exit price, holding days, return %, realized P&L, currency.
**Source:** apps/api/src/routes/stock.ts

#### FR-STOCK-004 — Historical price chart endpoint
`GET /api/stock/:ticker/chart?from=&to=` returns `{ available, currency, priceSource, points: [{date, close}] }`. Daily closes from first buy → today by default. Returns `{ available: false, reason }` for unmapped TASE funds.
**Source:** apps/api/src/routes/stock.ts, apps/api/src/services/market.service.ts (`getHistoricalPrices`)

#### FR-STOCK-005 — Reuses cached FIFO matching
`stock-detail.service.ts` does NOT issue its own SQL queries for P&L/lots. It filters the cached `runFifoMatching()` output via `getMatchedLotsForTicker()` / `getOpenLotsForTicker()`, sharing the same 1-min in-memory cache as the dashboard and AI tools.
**Source:** apps/api/src/services/stock-detail.service.ts, apps/api/src/services/pnl.service.ts

#### FR-STOCK-006 — Per-currency realized P&L for the ticker
The summary aggregates realized P&L separately per currency (so dual-listed or pre/post-rename rows aren't mixed), with trade count, win count, loss count per currency.
**Source:** apps/api/src/services/stock-detail.service.ts

#### FR-STOCK-007 — Commissions paid (per currency)
Total commission across BUY and SELL transactions for the ticker, split per currency, with separate buy-count and sell-count.
**Source:** apps/api/src/services/stock-detail.service.ts

#### FR-STOCK-008 — Dividends summary (gross / tax / net)
Dividends for the ticker, summing gross payments and matching withholding-tax entries (by ticker + date), reporting net cash flow per currency with payment count.
**Source:** apps/api/src/services/stock-detail.service.ts

#### FR-STOCK-009 — Currency impact decomposition (USD positions only)
For USD-denominated open positions, decomposes unrealized P&L into "price move" vs "FX move" per open FIFO lot using historical BOI rates from `getRate(buyDate)`. The interaction term is folded into price-move so the two components sum cleanly to total unrealized ILS P&L.
**Source:** apps/api/src/services/stock-detail.service.ts

#### FR-STOCK-010 — "Formerly known as" subtitle
`StockSummary.priorNames[]` lists legacy `securityName` values from the user's own trades whose embedded ticker (e.g. "FB" in "FACEBOOK(FB)") differs from the current ticker. Filters out benign IBI-vs-Yahoo format mismatches (e.g. "ASTS US" vs "AST SpaceMobile, Inc."). Renders as a subtitle on the stock header.
**Source:** apps/api/src/services/stock-detail.service.ts (`extractEmbeddedTicker`), apps/web/src/components/stock/StockHeader.tsx

#### FR-STOCK-011 — Stock detail page header
Renders ticker, security name (RTL for Hebrew), prior-names banner, market badge, sector/industry tags, open/closed status badge, first buy date, holding days, "Ask AI about this stock" button, "← Positions" back button.
**Source:** apps/web/src/components/stock/StockHeader.tsx

#### FR-STOCK-012 — Open-position snapshot in stock header
If the position is open, the header displays Shares, Avg cost, Current price (+ day %), Market value, Unrealized P&L (+ %), Portfolio weight. If closed, shows "Fully sold" with last transaction date.
**Source:** apps/web/src/components/stock/StockHeader.tsx

#### FR-STOCK-013 — Overview tab
KPI cards: Realized P&L (by currency + trade count + W/L), Total fees, Dividends (net/gross/tax/payment count), Currency impact (price move + FX move in ILS). Plus an "Open FIFO lots" table.
**Source:** apps/web/src/components/stock/OverviewTab.tsx

#### FR-STOCK-014 — Trades tab
Chronological BUY/SELL table with Date, Direction pill, Qty, Price, Commission, Proceeds. Pre-rename rows are tagged with a muted "as [old name]" subtitle under the date.
**Source:** apps/web/src/components/stock/TradesTab.tsx

#### FR-STOCK-015 — Round-trips tab
Completed FIFO-matched buy→sell cycles displayed as a table: Entry date, Exit date, Qty, Entry price, Exit price, Holding days, Return %, Realized P&L.
**Source:** apps/web/src/components/stock/RoundTripsTab.tsx

#### FR-STOCK-016 — Dividends & Fees tab
Two tables: dividend payments (gross / tax withheld / net) and per-trade commissions (date, BUY/SELL pill, qty, amount).
**Source:** apps/web/src/components/stock/DividendsFeesTab.tsx

#### FR-STOCK-017 — Price chart with buy/sell markers
Recharts LineChart at the bottom of the stock detail page. `<ReferenceDot>` per BUY (green) and SELL (red) at the executed price. Dashed `<ReferenceLine>` at current avg cost (only when position is open). Tooltip on hover.
**Source:** apps/web/src/components/stock/StockChart.tsx

#### FR-STOCK-018 — Chart split-adjustment [FE-ONLY for the snapping logic]
The chart component tracks cumulative split ratios and retroactively divides historical prices by them so pre-split BUY markers land correctly on the line. Buy/sell dates that fall on market holidays snap to the nearest prior trading day in the price series (category scale).
**Source:** apps/web/src/components/stock/StockChart.tsx

#### FR-STOCK-019 — Chart "unavailable" state
For unmapped TASE mutual funds (TheMarker only provides current quote, no history), the chart renders an explanatory "Price chart unavailable" state with the reason code.
**Source:** apps/web/src/components/stock/StockChart.tsx

#### FR-STOCK-020 — Tab state held in component (no URL) [FE-ONLY]
The Overview / Trades / Round-trips / Dividends-Fees tab selection lives in React `useState` and is not reflected in the URL. Refreshing the page reverts to the default tab (Overview).
**Source:** apps/web/src/app/positions/[ticker]/page.tsx

#### FR-STOCK-021 — Stock detail page reachable from multiple surfaces
Ticker cells in `/positions`, `/history`, and `/analytics` (per-ticker P&L table) all link to `/positions/:ticker` via `encodeURIComponent(ticker)`. TASE paper numbers like `1081820` are safe as URL segments.
**Source:** apps/web/src/app/positions/page.tsx, apps/web/src/app/history/page.tsx, apps/web/src/app/analytics/page.tsx

#### FR-STOCK-022 — "Ask AI about this stock" hand-off
Button in StockHeader opens the chat drawer and pre-fills a tailored analysis prompt for the ticker. Uses the `chat-store.draftMessage` mechanism.
**Source:** apps/web/src/components/stock/StockHeader.tsx, apps/web/src/stores/chat-store.ts

---

### FR-MKT — Market Data & FX

#### FR-MKT-001 — Yahoo Finance as primary price source
`market.service.getLatestPrices(tickers)` fetches live quotes from Yahoo Finance via the `yahoo-finance2` v3 SDK for US equities, mapped TASE securities (`.TA` suffix), and benchmarks (`^TA125`, `^GSPC`). Returns `{ price, dayChange, dayChangePct, high52w, low52w, volume, currency, fetchedAt }`.
**Source:** apps/api/src/services/market.service.ts

#### FR-MKT-002 — TheMarker fallback for unmapped TASE tickers
Israeli mutual funds (קרנות נאמנות) with no Yahoo `.TA` symbol fall back to `themarker.service.ts`, which scrapes `https://finance.themarker.com/stock/{paperId}`, parses the server-rendered Apollo cache from `<script id="__NEXT_DATA__">`, and reads `ROOT_QUERY.assets({"ids":"<paperId>"}).0`. Prices in agorot → ILS (÷100). No API key, no mapping required.
**Source:** apps/api/src/services/themarker.service.ts

#### FR-MKT-003 — Stooq fallback for US tickers when Yahoo fails
When Yahoo errors (per-ticker `No quote data` or whole-API throw), US equities and `^GSPC`/`^spx` fall back to Stooq's free CSV endpoint: `https://stooq.com/q/l/?s=<sym>.us&f=spd2t2ohlcv`. `dayChange` derived as `close − prevClose`. Delayed ~15 min. No 52w high/low.
**Source:** apps/api/src/services/stooq.service.ts

#### FR-MKT-004 — Stooq fallback for historical chart
`market.service.getHistoricalPrices` uses `yahoo-finance2.chart()` as primary with `stooq.service.fetchStooqHistorical` as US fallback. Unmapped TASE returns `{ available: false, reason: 'unmapped_tase' }` (TheMarker has no history).
**Source:** apps/api/src/services/market.service.ts

#### FR-MKT-005 — Market-prices cache with 15-min staleness
`market_prices` table stores the most recent quote per ticker. If `fetched_at < 15 min ago`, cached value is served without an upstream call. On fetch failure, the cache is served even when stale.
**Source:** apps/api/src/services/market.service.ts, packages/db/prisma/schema.prisma (MarketPrice model)

#### FR-MKT-006 — Display-name opportunistic upsert
Every successful Yahoo quote opportunistically upserts `securities.{ticker, name, market, currency, yahooSymbol}` from `longName ?? shortName` (fire-and-forget, failures logged). UI then prefers `securities.name` over stale IBI labels (e.g. "Meta Platforms, Inc." instead of "FACEBOOK(FB)").
**Source:** apps/api/src/services/market.service.ts, apps/api/src/services/position.service.ts

#### FR-MKT-007 — Market-prices query endpoint
`GET /api/market/prices?tickers=X,Y,Z` returns cached/fresh prices for the requested tickers.
**Source:** apps/api/src/routes/market.ts

#### FR-MKT-008 — Force-refresh endpoint
`POST /api/market/refresh` re-fetches all open-position tickers + benchmarks from upstream, ignoring the 15-min cache window. Returns the fresh quote map.
**Source:** apps/api/src/routes/market.ts

#### FR-MKT-009 — Benchmarks endpoint
`GET /api/market/benchmarks` returns the latest TA-125 (`^TA125`) and S&P 500 (`^GSPC`) quotes, cached on the same 15-min staleness rule.
**Source:** apps/api/src/routes/market.ts

#### FR-MKT-010 — Unmapped TASE ticker discovery
`GET /api/market/unmapped` returns TASE tickers (IBI paper numbers) appearing in the user's trades but missing from `tase-ticker-map.json` AND lacking a Yahoo `.TA` mapping.
**Source:** apps/api/src/routes/market.ts

#### FR-MKT-011 — TASE ticker mapping save
`POST /api/market/map` upserts a TASE paper-number → Yahoo symbol mapping into the `securities.yahooSymbol` column (and conceptually into the JSON file, though file write is manual). Lets the user resolve a "(placeholder)" position.
**Source:** apps/api/src/routes/market.ts

#### FR-MKT-012 — Bank of Israel FX rate fetch
`exchange-rate.service.ts` fetches official daily ILS/USD rates from the BOI API (free, no auth). Persists into `exchange_rates` table keyed by date. Fallback chain: check today → last 7 days → fetch fresh → persist → fall back to any historical rate.
**Source:** apps/api/src/services/exchange-rate.service.ts

#### FR-MKT-013 — Exchange rate query endpoint
`GET /api/exchange-rates` returns the current rate or `?date=YYYY-MM-DD` returns the historical rate for that day (with the fallback chain above).
**Source:** apps/api/src/routes/exchange-rates.ts

#### FR-MKT-014 — Exchange rate backfill
`POST /api/exchange-rates/backfill` walks from the earliest trade date to today, fetching missing dates from BOI. Used after fresh imports to ensure FX rates exist for every trade day.
**Source:** apps/api/src/routes/exchange-rates.ts

#### FR-MKT-015 — Historical chart in-memory cache (24h)
`getHistoricalPrices` results are cached in-memory for 24h keyed by `ticker|from|to`. No persistent `price_history` table yet (deferred to Phase 5).
**Source:** apps/api/src/services/market.service.ts

---

### FR-AI — AI Chat Agent

#### FR-AI-001 — POST /api/chat SSE streaming
`POST /api/chat { message, conversationId? }` opens an SSE stream with headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`. Used by the floating chat bar and drawer.
**Source:** apps/api/src/routes/chat.ts, apps/api/src/ai/chat-handler.ts

#### FR-AI-002 — SSE chunks flow through Next.js Route Handler
SSE traffic uses `apps/web/src/app/api/chat/route.ts` (Node runtime, `dynamic = 'force-dynamic'`) instead of the rewrite proxy. The rewrite buffered chunks behind Railway's edge; the Route Handler flushes per-event via Web Streams.
**Source:** apps/web/src/app/api/chat/route.ts

#### FR-AI-003 — Agentic tool-call loop
The chat handler runs `while (toolCallCount < MAX_TOOL_CALLS=10)`: streams Claude → collects `tool_use` blocks → executes them in **parallel** via `Promise.all` → appends `tool_result` blocks → re-streams. Exits early on `stop_reason: end_turn` or zero tool calls.
**Source:** apps/api/src/ai/chat-handler.ts (lines 180–320)

#### FR-AI-004 — Per-turn token budget
`max_tokens: 4096` per Claude API call. Model: `claude-sonnet-4-20250514`.
**Source:** apps/api/src/ai/chat-handler.ts

#### FR-AI-005 — System prompt with static + dynamic blocks
`buildSystemPrompt(userId)` returns two parts: `static` (role, guidelines, tool-usage rules — identical across users) and `dynamic` (live portfolio context: positions, P&L, sync status, investor profile). The static block is marked `cache_control: { type: 'ephemeral' }` so Anthropic caches it across the agentic loop and follow-up turns (5-min TTL).
**Source:** apps/api/src/ai/chat-handler.ts (lines 166–170), apps/api/src/ai/system-prompt.ts

#### FR-AI-006 — Tool-definition prompt caching
Tool schemas are pre-wrapped with `cache_control: { type: 'ephemeral' }` on the **last entry** so Anthropic caches the entire tool-definition block. Reduces tokens on every tool-using request.
**Source:** apps/api/src/ai/chat-handler.ts (lines 44–58)

#### FR-AI-007 — Investor profile injection into system prompt
`buildSystemPrompt` injects an `INVESTOR PROFILE` block: declared horizon/goal/notes from the `users` table plus an **inferred** horizon derived from `summary.avgHoldingDays` so the agent can notice drift between declared and actual behavior. When nothing is declared, the agent is told to default to long-term framing.
**Source:** apps/api/src/ai/system-prompt.ts

#### FR-AI-008 — Conversation persistence
Each message (user / assistant / tool) is persisted to `ai_messages` after the stream completes. The conversation auto-titles from the first user message (≤60 chars + ellipsis).
**Source:** apps/api/src/ai/conversation.service.ts, apps/api/src/ai/chat-handler.ts (lines 322–326)

#### FR-AI-009 — Per-user conversation scoping
`ai_conversations.user_id` is required; `getOrCreateConversation` enforces scoping by user. A conversationId from another user is treated as not-found and a new conversation is created.
**Source:** apps/api/src/ai/conversation.service.ts

#### FR-AI-010 — Conversation list, load, delete
`GET /api/chat/conversations` lists summaries. `GET /api/chat/conversations/:id` returns full message history. `DELETE /api/chat/conversations/:id` removes it. All scoped to current user.
**Source:** apps/api/src/routes/chat.ts

#### FR-AI-011 — Message history truncation
Only the last 40 raw messages are sent to Claude per request. Older messages are discarded from the request payload (still persisted in DB).
**Source:** apps/api/src/ai/chat-handler.ts (`buildMessageHistory`)

#### FR-AI-012 — Tool-result coalescing for parallel calls
When prior turns contained parallel tool calls, the history builder coalesces consecutive tool-result rows into a single `user` message with multiple `tool_result` content blocks (Anthropic API requirement).
**Source:** apps/api/src/ai/chat-handler.ts (lines 101–123)

#### FR-AI-013 — SSE event taxonomy
The stream emits five event types: `text_delta` (token), `tool_call` (tool invocation start), `tool_result` (tool finished), `done` (turn complete), `error` (failure). Each event carries `conversationId` for client routing.
**Source:** apps/api/src/ai/chat-handler.ts

#### FR-AI-014 — Stream abort via AbortController
Client can cancel a stream by aborting the underlying fetch. `chat-store.stopStreaming()` calls `AbortController.abort()`, the server `for await` loop exits naturally, and the connection closes.
**Source:** apps/web/src/stores/chat-store.ts, apps/web/src/lib/sse-client.ts

#### FR-AI-015 — Tool: `get_portfolio_summary`
Returns open positions with live prices, total ILS value, unrealized P&L, realized P&L summary. No inputs.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-AI-016 — Tool: `query_trades`
Searches trade history with filters: ticker, dateFrom, dateTo, direction, market, limit, includeNonTrades. Returns trimmed rows to stay under token budget.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-AI-017 — Tool: `get_pnl_breakdown`
Returns realized P&L grouped by ticker / month / market. For `market`, accepts `window: all|ytd|12m`.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-AI-018 — Tool: `get_behavioral_report`
Returns win rate, avg winning/losing hold days, profit factor, largest win/loss, day-of-week stats, per-market win rates.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-AI-019 — Tool: `get_market_price`
Returns current quote for a ticker (price, day change, 52-week range, volume) via Yahoo → Stooq → TheMarker fallback chain.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-AI-020 — Tool: `get_sync_status`
Returns last-import status and recent import history.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-AI-021 — Tool: `trigger_sync` (advisory only)
Returns a guidance string explaining the user must import via the `/import` page; does NOT perform any work. Vestigial from the IBI API era.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-AI-022 — Tool: `create_alert`
Creates an `alerts` row of one of 6 types (price_drop, price_target, holding_duration, portfolio_pnl, sync_failure, inactivity). **The row is created but no alert engine evaluates it** — Phase 5 work.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-AI-023 — Tool: `list_alerts`
Lists alerts, optionally filtered by status or ticker.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-AI-024 — Tool: `delete_alert`
Deletes an alert by id.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-AI-025 — Tool: `run_what_if`
Scenario analysis: `stop_loss` (cut losers at −X%) or `modified_sell_date` (counterfactual exit date). Per-ticker or whole portfolio.
**Source:** apps/api/src/ai/tools/core-tools.ts, apps/api/src/services/whatif.service.ts

#### FR-AI-026 — Tool: `get_dividend_summary` (Tier 1)
Aggregates DIVIDEND and TAX rows: gross, withholding, net, per-currency, optionally filtered by year and ticker.
**Source:** apps/api/src/ai/tools/tier1-tools.ts

#### FR-AI-027 — Tool: `get_cost_analysis` (Tier 1)
Total commissions, avg commission rate, cost as % of gains, identifies high-cost trades. Optional year and market filters.
**Source:** apps/api/src/ai/tools/tier1-tools.ts

#### FR-AI-028 — Tool: `get_performance_timeline` (Tier 1)
P&L timeline grouped monthly or quarterly with per-ticker attribution per period.
**Source:** apps/api/src/ai/tools/tier1-tools.ts

#### FR-AI-029 — Tool: `get_streaks` (Tier 1)
Detects winning/losing streaks (longest), highlights potential overtrading periods.
**Source:** apps/api/src/ai/tools/tier1-tools.ts

#### FR-AI-030 — Tool: `get_sector_exposure` (Tier 1)
Portfolio allocation by sector/industry (from `sector-map.json`); concentration warnings using ILS-normalized weights.
**Source:** apps/api/src/ai/tools/tier1-tools.ts, apps/api/src/data/sector-map.json

#### FR-AI-031 — Tool: `get_security_info` (Tier 1)
Sector, industry, market, total trade count for a single ticker. Looks up `sector-map.json` + `securities` table.
**Source:** apps/api/src/ai/tools/tier1-tools.ts

#### FR-AI-032 — Tool: `get_holding_period_analysis` (Tier 1)
Win/loss distribution across holding-period buckets (day trades, swing, position, long-term), identifies the user's optimal bucket.
**Source:** apps/api/src/ai/tools/tier1-tools.ts

#### FR-AI-033 — Tool: `get_benchmark_comparison` (Tier 2)
Compares portfolio or a single ticker against TA-125 and S&P 500 over `ytd|1y|all` windows.
**Source:** apps/api/src/ai/tools/tier2-tools.ts

#### FR-AI-034 — Tool: `get_currency_impact` (Tier 2)
Decomposes realized + unrealized P&L on USD-denominated positions into price-move vs FX-move components, with natural-language ILS-strengthening/weakening interpretation. Optional year filter.
**Source:** apps/api/src/ai/tools/tier2-tools.ts

#### FR-AI-035 — Tool: `get_risk_report` (Tier 2)
Comprehensive risk analysis bundling Herfindahl, max drawdown, Sharpe, Sortino with narrative interpretation and actionable suggestions.
**Source:** apps/api/src/ai/tools/tier2-tools.ts

#### FR-AI-036 — Tool: `simulate_alternative_investment` (Tier 2)
Counterfactual: replay the user's BUY cash flows into a target ticker (e.g. AAPL, SPY, `^GSPC`, `^TA125`). Modes: `mirror_timing` (per-trade) or `lump_sum` (single buy on first trade date). Scopes: `all|tase|us`. Handles FX conversion at trade-date rate, final value at current rate.
**Source:** apps/api/src/ai/tools/tier2-tools.ts, apps/api/src/services/alt-investment.service.ts

#### FR-AI-037 — Tool name not found → graceful error
If the agent calls a tool name not in the registry, the executor returns `{ error: "Unknown tool: X" }` instead of throwing. The loop continues.
**Source:** apps/api/src/ai/tools/index.ts

#### FR-AI-038 — Persistent chat drawer (right side)
ChatDrawer slides in from the right on toggle. Full-width on mobile (<md), 400–420px on desktop. State managed by `chat-store.isOpen`. Toggle from TopBar, FloatingChatBar, or stock-detail "Ask AI" button.
**Source:** apps/web/src/components/ai/ChatDrawer.tsx, apps/web/src/stores/chat-store.ts

#### FR-AI-039 — Floating chat bar on every page
FloatingChatBar is docked at the bottom of every authenticated page (hidden when drawer is open). Glassmorphic pill with input + sparkle button + ⌘K hint badge. Click input → opens drawer + hands off typed text.
**Source:** apps/web/src/components/ai/FloatingChatBar.tsx

#### FR-AI-040 — Floating-bar → drawer draft hand-off [FE-ONLY]
On opening the drawer, ChatInput consumes `chat-store.draftMessage`, places caret at end, focuses, and clears the draft. Lets the user start typing in the bar and continue in the drawer without losing text.
**Source:** apps/web/src/components/ai/FloatingChatBar.tsx, apps/web/src/components/ai/ChatInput.tsx, apps/web/src/stores/chat-store.ts

#### FR-AI-041 — Quick-action chips
When a conversation has no messages, the drawer shows 7 preset prompt buttons in a 2-column grid (Portfolio snapshot, YTD performance, Behavioral blind spots, Risk & concentration, Dividend income, "What should I ask?", S&P 500 counterfactual). Click sends the prompt as the first message.
**Source:** apps/web/src/components/ai/QuickActions.tsx

#### FR-AI-042 — Markdown rendering in assistant messages
Assistant messages render via `react-markdown` + `remark-gfm` with custom table styling (overflow container, colored headers, small cells). Code blocks get a bg + small font.
**Source:** apps/web/src/components/ai/MessageBubble.tsx

#### FR-AI-043 — Tool call visualization in chat
Each tool call appears inline in the assistant message as a collapsible "Running [Tool]..." (pulsing) → checkmark-done box. Click to expand and see the raw result JSON.
**Source:** apps/web/src/components/ai/MessageBubble.tsx

#### FR-AI-044 — Typing indicator while streaming [FE-ONLY]
Empty assistant placeholder with `isStreaming=true` flag renders three bouncing dots until the first text chunk arrives. Flipped off on `done` / `error` / abort.
**Source:** apps/web/src/components/ai/MessageBubble.tsx, apps/web/src/stores/chat-store.ts

#### FR-AI-045 — Stop-streaming button [FE-ONLY]
ChatInput swaps Send for a Stop button while `isStreaming`. Pressing Stop aborts the in-flight `fetchSSE` via `AbortController`.
**Source:** apps/web/src/components/ai/ChatInput.tsx, apps/web/src/stores/chat-store.ts

#### FR-AI-046 — Chat history panel
Recent conversations (top 10) shown in a togglable list inside the drawer. Each has a delete button (visible on hover). Click loads the conversation.
**Source:** apps/web/src/components/ai/ChatDrawer.tsx

#### FR-AI-047 — New-conversation button
"+ New" in the drawer header clears `activeConversationId` + messages. Next message starts a fresh conversation.
**Source:** apps/web/src/stores/chat-store.ts (`startNewConversation`)

#### FR-AI-048 — Optimistic message add [FE-ONLY]
On send, the user message + an empty assistant placeholder are added to state **before** the SSE connection opens. The placeholder is then mutated in-place as `text_delta` events arrive.
**Source:** apps/web/src/stores/chat-store.ts

#### FR-AI-049 — Auto-scroll to latest message [FE-ONLY]
Messages container uses a `ref` + `scrollIntoView` on every message-array change to keep the latest message visible during streaming.
**Source:** apps/web/src/components/ai/ChatDrawer.tsx

---

### FR-UI — Frontend-Only UX

> Every requirement in this section has the `[FE-ONLY]` tag — it exists purely in the browser with no corresponding API behavior.

#### FR-UI-001 — Positions table client-side sorting [FE-ONLY]
Sort by any column (Ticker, Name, Market, Qty, Avg Cost, Current Price, Market Value, Unrealized P&L, Weight). Sort key + direction in React `useState`; survives 60s background refetches. Default: weight desc. No corresponding API parameter.
**Source:** apps/web/src/app/positions/page.tsx

#### FR-UI-002 — History page client-side filter state [FE-ONLY]
Ticker, market, direction, and "show all transactions" toggle held in `useState`. Filter changes reset `page` to 1. Query key includes all four so TanStack Query refetches.
**Source:** apps/web/src/app/history/page.tsx

#### FR-UI-003 — History pagination state [FE-ONLY]
`page` state held in `useState`. Previous/Next buttons disabled at boundaries. "Showing X–Y of Z" count rendered. No URL state — refreshing returns to page 1.
**Source:** apps/web/src/app/history/page.tsx

#### FR-UI-004 — Settings edit-mode toggle [FE-ONLY]
The Settings page switches between read-mode (definition list) and edit-mode (form). `editing` + `justSaved` booleans drive the transition. Success message ("Saved.") shown briefly after save.
**Source:** apps/web/src/app/settings/page.tsx

#### FR-UI-005 — User-menu dropdown [FE-ONLY]
TopBar avatar opens a dropdown (display name, email, Sign out button). Closes on outside-click via a `useEffect` mousedown listener.
**Source:** apps/web/src/components/layout/TopBar.tsx

#### FR-UI-006 — Mobile sidebar drawer [FE-ONLY]
On <md screens, the sidebar collapses to an off-canvas drawer toggled by the hamburger button in TopBar. State in `ui-store.sidebarOpen`. Auto-closes on route change.
**Source:** apps/web/src/components/layout/Sidebar.tsx, apps/web/src/stores/ui-store.ts

#### FR-UI-007 — Chat drawer animation [FE-ONLY]
Slide + fade animation on open/close. `mounted` boolean (set after initial render) triggers the CSS transition.
**Source:** apps/web/src/components/ai/ChatDrawer.tsx

#### FR-UI-008 — Floating chat bar entry animation [FE-ONLY]
On mount, an 80ms-delayed `setTimeout` flips a `mounted` boolean to trigger a translate + opacity entry animation.
**Source:** apps/web/src/components/ai/FloatingChatBar.tsx

#### FR-UI-009 — Floating chat bar rotating placeholder [FE-ONLY]
Placeholder text rotates through ~3.5s. `useEffect` interval pauses when the user has typed anything (input length > 0).
**Source:** apps/web/src/components/ai/FloatingChatBar.tsx

#### FR-UI-010 — Cmd/Ctrl+K focuses chat input [FE-ONLY]
`useEffect` keydown listener in FloatingChatBar. On hit, focuses the input. ⌘K hint badge shown on desktop.
**Source:** apps/web/src/components/ai/FloatingChatBar.tsx

#### FR-UI-011 — Esc closes chat drawer [FE-ONLY]
`useEffect` keydown listener in ChatDrawer. On Esc, closes the drawer.
**Source:** apps/web/src/components/ai/ChatDrawer.tsx

#### FR-UI-012 — Enter sends, Shift+Enter newline (chat input) [FE-ONLY]
ChatInput textarea `onKeyDown` handler: Enter triggers `sendMessage`; Shift+Enter inserts a newline. Hint text shown below the input.
**Source:** apps/web/src/components/ai/ChatInput.tsx

#### FR-UI-013 — Chat input auto-expand [FE-ONLY]
Textarea height grows with content up to 140px (then scrolls). Measured via `scrollHeight`.
**Source:** apps/web/src/components/ai/ChatInput.tsx

#### FR-UI-014 — Chat history panel toggle [FE-ONLY]
"History" button in drawer header opens a side panel listing past conversations. `showHistory` state held in ChatDrawer. Auto-closes when `activeConversationId` or `messages.length` changes.
**Source:** apps/web/src/components/ai/ChatDrawer.tsx

#### FR-UI-015 — Hebrew RTL detection [FE-ONLY]
`isHebrew(text)` regex `/[֐-׿]/` test. Applied to security names in Positions table, History ticker links, Stock detail header, Stock detail prior names, and Trades-tab legacy name labels. Wraps the text in `<span dir="rtl">`.
**Source:** apps/web/src/lib/formatters.ts

#### FR-UI-016 — Currency, percent, date, number formatters [FE-ONLY]
`formatCurrency(value, currency)` uses `Intl.NumberFormat` with 0–2 decimals. `formatPercent(value)` signed 2 decimals. `formatDate(dateStr)` short month/day/year. `formatNumber(value)` no-currency `Intl.NumberFormat`. Used across every numeric cell.
**Source:** apps/web/src/lib/formatters.ts

#### FR-UI-017 — TanStack Query default cache config [FE-ONLY]
All queries: `staleTime: 30s`, `retry: 1`. Triggers refetch on window focus / remount after staleness window.
**Source:** apps/web/src/components/Providers.tsx

#### FR-UI-018 — Skeleton pulse loaders [FE-ONLY]
`MoneyLine` and dashboard cards show animated gray skeleton pulses while data loads. Stock detail / History / Analytics show "Loading..." text.
**Source:** apps/web/src/components/dashboard/MoneyLine.tsx

#### FR-UI-019 — Empty-state messaging [FE-ONLY]
Per-page empty states: "No open positions" / "No trades found. Import from Import page." / "No past conversations." / "No snapshots yet." / "No monthly data" / "Insufficient data" for risk metrics requiring ≥10 snapshots.
**Source:** apps/web/src/app/*/page.tsx

#### FR-UI-020 — Form-level password validation [FE-ONLY]
Signup and Reset Password forms enforce min-8-char password client-side. Reset Password additionally validates password match before submitting.
**Source:** apps/web/src/app/signup/page.tsx, apps/web/src/app/reset-password/page.tsx

#### FR-UI-021 — Missing-token UI states [FE-ONLY]
Verify-email and Reset-password pages check the `?token=` query param on mount. If missing or invalid, show an error state with a link back to login.
**Source:** apps/web/src/app/verify-email/page.tsx, apps/web/src/app/reset-password/page.tsx

#### FR-UI-022 — Drag-and-drop import zone [FE-ONLY]
Import page's drop zone changes border color on drag-over (`isDragging` state). Accepts `.xlsx`, multiple files. Click opens native file picker.
**Source:** apps/web/src/app/import/page.tsx

#### FR-UI-023 — Per-file import status pipeline [FE-ONLY]
Each queued file moves through queued → uploading → success/failed with corresponding status icons. Remove button disabled during upload. "Clear completed" appears only after at least one success.
**Source:** apps/web/src/app/import/page.tsx

#### FR-UI-024 — Onboarding modal trigger logic [FE-ONLY]
OnboardingModal renders if `user.investorProfileUpdatedAt === null` and the current route is neither an auth page nor `/settings`. Fixed black/40 backdrop, z-50. Skipping still POSTs an empty profile so the timestamp gets set (no re-nag).
**Source:** apps/web/src/components/profile/OnboardingModal.tsx

#### FR-UI-025 — Notes textarea character counter [FE-ONLY]
InvestorProfileForm shows live "X / 500" counter under the notes textarea.
**Source:** apps/web/src/components/profile/InvestorProfileForm.tsx

#### FR-UI-026 — Logout flow on user-menu click [FE-ONLY]
"Sign out" button POSTs `/api/auth/logout`, clears `UserProvider.user`, and redirects to `/login`. No confirmation dialog.
**Source:** apps/web/src/components/UserProvider.tsx

#### FR-UI-027 — Responsive grid layouts [FE-ONLY]
Dashboard: 1-col mobile → 2-col tablet → 4-col desktop. Analytics: 2-col → 4-col. Stock detail: flex-wrap. Main content padding: `p-3 sm:p-6`.
**Source:** apps/web/src/app/*/page.tsx

#### FR-UI-028 — Sync indicator pill in TopBar [FE-ONLY]
TopBar shows a colored dot + last-import timestamp ("3 minutes ago"), or "Importing..." (pulsing) during a run, or "Never" if no sync yet. Polled every 30s via TanStack Query.
**Source:** apps/web/src/components/layout/TopBar.tsx

#### FR-UI-029 — Conversation-delete with no confirmation [FE-ONLY]
Hovering a chat history item reveals a delete button. Click immediately DELETEs without confirmation. Removes from list on success.
**Source:** apps/web/src/components/ai/ChatDrawer.tsx

#### FR-UI-030 — Monthly heatmap color scaling [FE-ONLY]
Heatmap finds `max(abs(monthlyPnl))` across the data set and scales each cell's color opacity proportionally. Green for positive, red for negative.
**Source:** apps/web/src/app/analytics/page.tsx

---

### FR-ADMIN — Settings, Alerts, Admin Surfaces

#### FR-ADMIN-001 — Settings page investor-profile editor
Read-mode displays horizon, goal, and notes from `UserProvider.user`. Edit-mode swaps to `InvestorProfileForm` (radio groups + textarea). Save POSTs `PUT /api/auth/profile` and refreshes the user.
**Source:** apps/web/src/app/settings/page.tsx, apps/web/src/components/profile/InvestorProfileForm.tsx

#### FR-ADMIN-002 — Settings page account info (read-only)
Email and display name shown read-only. No edit affordance exists today for either field.
**Source:** apps/web/src/app/settings/page.tsx

#### FR-ADMIN-003 — Investor-horizon enum
Five values: `intraday`, `swing`, `position`, `long_term`, `mixed`. Mirrored in three places that must stay in sync: backend `INVESTOR_HORIZONS` in auth.ts, frontend `HORIZON_OPTIONS` in InvestorProfileForm.tsx, and `InvestorHorizon` type in UserProvider.tsx.
**Source:** apps/api/src/routes/auth.ts, apps/web/src/components/profile/InvestorProfileForm.tsx, apps/web/src/components/UserProvider.tsx

#### FR-ADMIN-004 — Investor-goal enum
Five values: `aggressive_growth`, `steady_growth`, `income`, `preservation`, `learning`. Mirrored in the same three places.
**Source:** as above

#### FR-ADMIN-005 — Investor-notes free text
≤500 chars, stored as `users.investor_notes`. Surfaced in `INVESTOR PROFILE` block of the AI system prompt.
**Source:** apps/api/src/routes/auth.ts, apps/api/src/ai/system-prompt.ts

#### FR-ADMIN-006 — Onboarding modal on first authenticated load
Shown if `investorProfileUpdatedAt === null` and route is not an auth page or `/settings`. "Save & continue" or "Skip for now" — skipping still saves an empty profile to set the timestamp.
**Source:** apps/web/src/components/profile/OnboardingModal.tsx

#### FR-ADMIN-007 — Alerts CRUD endpoints (via AI tools)
`create_alert`, `list_alerts`, `delete_alert` AI tools mutate the `alerts` table. No HTTP CRUD endpoints exist; alerts can only be managed via the chat agent.
**Source:** apps/api/src/ai/tools/core-tools.ts

#### FR-ADMIN-008 — Alerts page is a stub
`/alerts` renders a single placeholder: "Price alerts and notification management will appear here." No list, no form, no live data.
**Source:** apps/web/src/app/alerts/page.tsx

#### FR-ADMIN-009 — Import history table
On the Import page, a table shows: timestamp, file name, status pill, records added, date range, error message. Sorted reverse-chronological. No pagination.
**Source:** apps/web/src/app/import/page.tsx

#### FR-ADMIN-010 — Sync status surfaced on Dashboard
Dashboard shows last-import timestamp + record count. Auto-refetches every 30s.
**Source:** apps/web/src/app/dashboard/page.tsx

---

## 4. Non-Functional Requirements

### NFR-SEC — Security

#### NFR-SEC-001 — bcrypt password hashing at cost 12
All passwords stored as `bcrypt.hash(password, 12)`. Defined as `BCRYPT_COST` const in auth.ts.
**Source:** apps/api/src/routes/auth.ts (line 21)

#### NFR-SEC-002 — Session tokens are 32 random bytes
`crypto.randomBytes(32).toString('hex')` per session. Raw token only ever in the cookie; database stores `sha256(token)`.
**Source:** apps/api/src/routes/auth.ts (`genToken`), apps/api/src/middleware/require-auth.ts (`hashSessionToken`)

#### NFR-SEC-003 — Cookie security flags
`takumi_session` cookie is httpOnly, Secure (prod only), SameSite=Lax, path=/, 30-day maxAge. No JS-side access; baseline CSRF protection from SameSite=Lax.
**Source:** apps/api/src/routes/auth.ts (`setSessionCookie`)

#### NFR-SEC-004 — Constant-time-ish login
Login always runs bcrypt.compare even when the user doesn't exist, to reduce a timing oracle for user enumeration. (Not constant-time in the cryptographic sense, but harder to exploit.)
**Source:** apps/api/src/routes/auth.ts (line 150)

#### NFR-SEC-005 — User-enumeration prevention on email endpoints
`forgot-password` and `resend-verification` always return 200, regardless of whether the email exists. Token generation + email send happens only if the user exists, but the response is identical.
**Source:** apps/api/src/routes/auth.ts (lines 222, 320)

#### NFR-SEC-006 — Zod input validation on all auth endpoints
Email (RFC + ≤254), password (8–200), displayName (≤80), notes (≤500), investor-profile enums all validated. Reject with 400 + first error message on failure.
**Source:** apps/api/src/routes/auth.ts

#### NFR-SEC-007 — Helmet middleware
Express uses `helmet()` for default security headers (CSP, HSTS, X-Frame-Options, etc.).
**Source:** apps/api/src/index.ts

#### NFR-SEC-008 — All non-auth routes gated by requireAuth
`app.use("/api", requireAuth)` is mounted AFTER the public routes. Every resource route receives a guaranteed `req.user`.
**Source:** apps/api/src/index.ts, apps/api/src/middleware/require-auth.ts

#### NFR-SEC-009 — Per-user data scoping enforced at service boundary
Every service function touching per-user tables takes `userId` as its first arg and threads it into Prisma `where`. The single-key FIFO cache was deliberately keyed by userId to prevent cross-user leaks during the 1-minute TTL.
**Source:** apps/api/src/services/*.ts (convention from CLAUDE.md)

#### NFR-SEC-010 — Session invalidation on password reset
Reset-password deletes ALL existing sessions for the user in the same transaction as the password update. Forces re-login on every device.
**Source:** apps/api/src/routes/auth.ts (line 361)

#### NFR-SEC-011 — No rate limiting
No application-level rate limit on login, signup, password reset, or chat. Relies on Railway-edge defaults.
**Source:** (gap — none implemented)

#### NFR-SEC-012 — No CSRF token system
SameSite=Lax + httpOnly cookies provide baseline mitigation. No anti-CSRF tokens issued or verified.
**Source:** (current posture)

---

### NFR-PERF — Performance

#### NFR-PERF-001 — FIFO matching in-memory cache (1-min TTL, per-user)
`runFifoMatching()` results cached in a `Map<userId, {result, expiresAt}>` with 1-minute TTL. Stale entries opportunistically evicted at 2× TTL. Avoids redundant FIFO re-runs across the multiple AI tools that hit it within a single chat turn (and across dashboard + stock detail page within 60s windows).
**Source:** apps/api/src/services/pnl.service.ts

#### NFR-PERF-002 — Market-price cache (15-min staleness)
`market_prices` Postgres rows are reused if `fetched_at < 15 min ago`. On stale/missing, upstream fetched; on upstream failure, stale row is served. Backed by `[ticker, fetchedAt DESC]` index.
**Source:** apps/api/src/services/market.service.ts

#### NFR-PERF-003 — Historical chart in-memory cache (24h TTL)
`getHistoricalPrices(ticker, market, from, to)` cached in-memory for 24h keyed by `ticker|from|to`.
**Source:** apps/api/src/services/market.service.ts

#### NFR-PERF-004 — Exchange-rate fallback chain (avoid round-trips)
FX lookup checks today's cached rate → last 7 days → fetches fresh from BOI → persists → falls back to any historical row. Avoids re-fetching BOI on every request.
**Source:** apps/api/src/services/exchange-rate.service.ts

#### NFR-PERF-005 — Batched XLSX import writes
Pre-fetch existing `tradeId`s, then one bulk `createMany({ skipDuplicates: true })` + chunked parallel updates (concurrency 10). Serial per-row upserts exceeded the Next.js 30s proxy timeout in earlier versions.
**Source:** apps/api/src/services/xlsx-import.service.ts

#### NFR-PERF-006 — Anthropic prompt caching on system prompt
Static block of the system prompt is wrapped with `cache_control: { type: 'ephemeral' }` so Anthropic's 5-min prompt cache reuses it across the agentic loop's tool iterations and within the same conversation.
**Source:** apps/api/src/ai/chat-handler.ts

#### NFR-PERF-007 — Anthropic prompt caching on tool definitions
Last tool schema is wrapped with `cache_control: { type: 'ephemeral' }` so the entire ~22-tool definition block is cached.
**Source:** apps/api/src/ai/chat-handler.ts (lines 44–58)

#### NFR-PERF-008 — Parallel tool execution in agentic loop
When Claude emits multiple `tool_use` blocks in one turn, the handler executes them concurrently via `Promise.all`. Results are returned in the original order (Anthropic requirement).
**Source:** apps/api/src/ai/chat-handler.ts (lines 281–295)

#### NFR-PERF-009 — Message history truncation (last 40)
Only the last 40 raw messages (roughly 20 user/assistant turns) are sent to Claude per request, trading older context for lower per-call token cost.
**Source:** apps/api/src/ai/chat-handler.ts (`buildMessageHistory`)

#### NFR-PERF-010 — Query-result trimming for AI tools
`query_trades` (and similar) trim large result sets before returning to Claude, to stay under the 4096 output-token + reasonable input-token budget. Verified by `scripts/verify-payload-trim.ts`.
**Source:** apps/api/src/ai/tools/core-tools.ts, apps/api/src/scripts/verify-payload-trim.ts

---

### NFR-REL — Reliability

#### NFR-REL-001 — Yahoo → Stooq fallback (US prices)
Per-ticker `No quote data` or whole-API throw triggers fallback to Stooq for US equities and `^GSPC`. Different data shape, no 52w high/low.
**Source:** apps/api/src/services/market.service.ts, apps/api/src/services/stooq.service.ts

#### NFR-REL-002 — Yahoo → TheMarker fallback (TASE prices)
Yahoo returning no data for a mapped TASE ticker triggers TheMarker scrape. Unmapped TASE goes straight to TheMarker.
**Source:** apps/api/src/services/market.service.ts, apps/api/src/services/themarker.service.ts

#### NFR-REL-003 — Stale cache served on upstream failure
If all upstream price sources fail, the latest `market_prices` row (even past 15min) is returned. Better than nothing.
**Source:** apps/api/src/services/market.service.ts

#### NFR-REL-004 — Idempotent XLSX import (deterministic tradeId)
Re-uploading the same file is safe — the `(userId, tradeId, source)` unique constraint plus `skipDuplicates: true` ensures no duplicates.
**Source:** apps/api/src/services/xlsx-import.service.ts, packages/db/prisma/schema.prisma

#### NFR-REL-005 — Idempotent bootstrap script
`bootstrap-users.ts` checks for the primary user before creating. Safe to run on every preDeploy hook.
**Source:** scripts/bootstrap-users.ts

#### NFR-REL-006 — Idempotent daily snapshot
Portfolio snapshots use `@@unique([userId, date])` so re-capture overwrites rather than duplicates.
**Source:** packages/db/prisma/schema.prisma (PortfolioSnapshot)

#### NFR-REL-007 — Fire-and-forget non-critical writes
Session rolling-refresh, snapshot auto-capture, and securities display-name upsert are all fire-and-forget. Failures are logged but never block the request.
**Source:** apps/api/src/middleware/require-auth.ts, apps/api/src/services/position.service.ts, apps/api/src/services/market.service.ts

#### NFR-REL-008 — Centralized error handler
`error-handler.ts` middleware catches all unhandled Express errors, logs to console with `[error]` prefix, and returns a generic 500 in prod (detailed in dev).
**Source:** apps/api/src/middleware/error-handler.ts

#### NFR-REL-009 — Email service degrades to console-log
If `RESEND_API_KEY` is unset, `email.service.ts` logs the email contents instead of sending. Dev runs without Resend configured.
**Source:** apps/api/src/services/email.service.ts

#### NFR-REL-010 — Email verification deferral does not block usage
Because email verification is currently disabled, signup auto-verifies and logs the user in. Verify-email and forgot-password endpoints still work — they just don't get triggered by the live signup flow.
**Source:** apps/api/src/routes/auth.ts (lines 107–116)

---

### NFR-OBS — Observability

#### NFR-OBS-001 — Console-only logging
No structured logger (pino, winston, etc.). All logs are `console.log` / `console.error` with bracketed-prefix conventions (`[error]`, `[market]`, etc.).
**Source:** throughout apps/api/src/

#### NFR-OBS-002 — Sync log as audit trail
Every XLSX import writes a `sync_log` row with status, record count, date range, file name, error. Surfaced in Import page history table.
**Source:** packages/db/prisma/schema.prisma (SyncLog), apps/api/src/services/sync.service.ts

#### NFR-OBS-003 — SSE event taxonomy for chat
`text_delta`, `tool_call`, `tool_result`, `done`, `error` events give the client real-time visibility into the agent's progress.
**Source:** apps/api/src/ai/chat-handler.ts

#### NFR-OBS-004 — Verification scripts for AI behavior
`scripts/verify-cache.ts`, `verify-combined.ts`, `verify-payload-trim.ts`, `verify-alt-investment.ts`, `probe-rates.ts` are ad-hoc scripts for measuring prompt-cache efficiency, tool payload sizes, and external-API health.
**Source:** apps/api/src/scripts/

#### NFR-OBS-005 — No tests, no APM, no metrics
No test suite (`vitest` configured but unused). No APM, distributed tracing, or Prometheus/StatsD exports. Health monitoring relies on Railway's uptime checks on `GET /api/health`.
**Source:** (gap)

---

### NFR-TENANT — Multi-Tenancy & Data Isolation

#### NFR-TENANT-001 — Per-user data scoping is a hard convention
All per-user tables (`trades`, `alerts`, `portfolio_snapshots`, `ai_conversations`, `ai_messages`, `sync_log`, `sessions`, `verification_tokens`) carry a `userId` FK with `onDelete: Cascade`. Every service function takes `userId` first and threads it into the Prisma where-clause.
**Source:** CLAUDE.md "Per-user data scoping" convention, packages/db/prisma/schema.prisma

#### NFR-TENANT-002 — Cross-user cache isolation (FIFO)
The 1-minute in-memory FIFO cache is keyed by `userId`. A single-key cache would leak one user's matching results to another.
**Source:** apps/api/src/services/pnl.service.ts

#### NFR-TENANT-003 — Shared reference tables (intentional)
`securities`, `market_prices`, `exchange_rates` are NOT user-scoped — they're shared reference data. This is intentional: AAPL's price is AAPL's price for everyone.
**Source:** packages/db/prisma/schema.prisma

#### NFR-TENANT-004 — AI tool executor signature includes userId
`executeTool(userId, name, input)`. Every tool's executor receives the user id as its first arg, preventing accidental cross-user queries.
**Source:** apps/api/src/ai/tools/index.ts

#### NFR-TENANT-005 — Cascade delete on user removal
Deleting a user (e.g. via Prisma Studio) cascades to all sessions, verification tokens, trades, alerts, conversations, snapshots, and sync logs — no orphaned per-user data.
**Source:** packages/db/prisma/schema.prisma (all FKs)

---

### NFR-SCALE — Scalability Ceilings

#### NFR-SCALE-001 — AI agent loop hard limit (10 tool calls)
`MAX_TOOL_CALLS = 10` per chat turn. Exceeding it ends the loop. Prevents runaway tool-use storms.
**Source:** apps/api/src/ai/chat-handler.ts (line 23)

#### NFR-SCALE-002 — AI per-call token budget (4096)
`max_tokens: 4096` per Claude API call. Limits per-turn response length.
**Source:** apps/api/src/ai/chat-handler.ts (line 24)

#### NFR-SCALE-003 — AI conversation context window (last 40 messages)
Only the last 40 raw messages sent to Claude. Older messages are persisted in DB but not in the prompt. No semantic compaction yet.
**Source:** apps/api/src/ai/chat-handler.ts (`buildMessageHistory`)

#### NFR-SCALE-004 — In-process caches only (no Redis)
FIFO cache, historical-chart cache are in-process `Map`s. A multi-instance deployment would not share them. Today's single-instance Railway deploy makes this fine.
**Source:** apps/api/src/services/pnl.service.ts, apps/api/src/services/market.service.ts

#### NFR-SCALE-005 — No background job queue
No worker/queue (BullMQ, Sidekiq, etc.). Async work (snapshot capture, FX rate fetch) is triggered fire-and-forget within request handlers. Failures are not retried.
**Source:** (architecture)

#### NFR-SCALE-006 — Bulk market-price fetches not paginated
`market.service.getLatestPrices` fetches all requested tickers in one call to Yahoo. A portfolio of 1000+ open positions would issue 1000+ Yahoo subrequests; no batching strategy beyond what `yahoo-finance2` does internally.
**Source:** apps/api/src/services/market.service.ts

#### NFR-SCALE-007 — XLSX update concurrency = 10
Chunked parallel `prisma.trade.update()` calls capped at 10 concurrent. Higher concurrency saturated the dev Postgres connection pool.
**Source:** apps/api/src/services/xlsx-import.service.ts

#### NFR-SCALE-008 — `market_prices.volume` is BigInt
Daily volume for indices (S&P 500, TA-125) exceeds 2³¹. Column was upgraded from INT4 to BIGINT. Read sites in `market.service.ts` convert with `Number(cached.volume)` since real values stay within `Number.MAX_SAFE_INTEGER`.
**Source:** packages/db/prisma/schema.prisma (MarketPrice.volume)

---

### NFR-DEPLOY — Deployment

#### NFR-DEPLOY-001 — Railway three-service topology
`web` (public Next.js), `api` (private Express), `Postgres` (managed plugin). Only `web` has a public domain.
**Source:** CLAUDE.md "Deployment" section

#### NFR-DEPLOY-002 — API is private (no public domain)
`api` service listens on `::` (IPv6+IPv4) which Railway's private networking requires. Reachable only from `web` via `${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`.
**Source:** apps/api/src/index.ts, Railway configuration

#### NFR-DEPLOY-003 — Next.js rewrite hides the API origin
`next.config.mjs` rewrites `/api/:path*` → `${API_URL}/api/:path*` server-side. The browser never sees the api origin; no CORS config required.
**Source:** apps/web/next.config.mjs

#### NFR-DEPLOY-004 — Chat SSE bypasses the rewrite
`apps/web/src/app/api/chat/route.ts` is a Node Route Handler that proxies SSE manually so chunks flush per-event. The standard rewrite proxy buffered chunks behind Railway's edge.
**Source:** apps/web/src/app/api/chat/route.ts

#### NFR-DEPLOY-005 — Auto-deploy on push to master
Railway watches the GitHub `master` branch. Pushes trigger build + preDeploy + deploy. No separate CI; no `.github/workflows`.
**Source:** Railway configuration

#### NFR-DEPLOY-006 — preDeploy runs db push + bootstrap
api `preDeploy`: `pnpm --filter @takumi/db exec prisma db push && pnpm --filter @takumi/api run bootstrap-users`. Schema sync + idempotent user creation. No formal migration history — Prisma `db push` is destructive in principle.
**Source:** Railway service config

#### NFR-DEPLOY-007 — API runs via tsx (no compiled build)
`pnpm --filter @takumi/api start` runs `tsx src/index.ts`. Skips a compiled `dist/` step so workspace TypeScript deps (`@takumi/db`, `@takumi/types`) resolve at runtime. Type-checking is therefore skipped at startup — pre-existing TS2742 errors in Express routes don't block runtime.
**Source:** apps/api/package.json

#### NFR-DEPLOY-008 — pnpm workspaces + Turbo
Monorepo managed by `pnpm@10` workspaces. Turbo orchestrates `build`, `dev`, `lint`, `test`, `db:generate`, `db:migrate` across `apps/*` and `packages/*`. `onlyBuiltDependencies` allowlist for Prisma + esbuild native build scripts.
**Source:** package.json, pnpm-workspace.yaml, turbo.json

#### NFR-DEPLOY-009 — Required env vars
api: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `PORT`, `APP_URL`, optional `RESEND_API_KEY` + `EMAIL_FROM`, optional `BOOTSTRAP_USER_EMAIL` + `BOOTSTRAP_USER_PASSWORD`, never `AUTH_DEV_BYPASS_USER_ID`. web: `API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`.
**Source:** .env.example, CLAUDE.md

---

### NFR-COMPAT — Compatibility

#### NFR-COMPAT-001 — Modern-browser SPA frontend
Next.js 14 App Router, all pages `"use client"`. No SSR-only views. Targets evergreen browsers (Chrome/Firefox/Safari/Edge).
**Source:** apps/web/src/app/

#### NFR-COMPAT-002 — Mobile-responsive layout
Mobile-first Tailwind. Sidebar collapses to off-canvas drawer on <md. ChatDrawer goes full-width on <md. Tables wrap in `overflow-x-auto`. Grids: `grid-cols-{1|2} … lg:grid-cols-4`. Padding scales: `p-3 sm:p-6`. Viewport meta set in `apps/web/src/app/layout.tsx`.
**Source:** apps/web/src/app/layout.tsx, apps/web/src/components/layout/*

#### NFR-COMPAT-003 — Hebrew RTL rendering
`isHebrew()` detects Hebrew Unicode (U+0590..U+05FF) and wraps the text in `<span dir="rtl">`. Applied across Positions, History, Stock detail, Trades-tab legacy labels. No full-app i18n library — RTL is applied only at the text-fragment level.
**Source:** apps/web/src/lib/formatters.ts

#### NFR-COMPAT-004 — TASE paper numbers safe as URL segments
`/positions/:ticker` uses `encodeURIComponent(ticker)`. Numeric TASE paper numbers like `1081820` and US tickers like `AAPL` both work.
**Source:** apps/web/src/app/positions/page.tsx (links)

#### NFR-COMPAT-005 — Keyboard accessibility
Cmd/Ctrl+K focuses chat input. Enter sends. Shift+Enter newline. Esc closes drawer. Tab navigation native to browser. Icon-only buttons carry `title` + `aria-label`.
**Source:** apps/web/src/components/ai/*

#### NFR-COMPAT-006 — Decimal precision via Prisma `Decimal`
All monetary fields (price, quantity, commission, P&L, market value, threshold, rate) are `Decimal` not `Float`. Avoids floating-point rounding errors in P&L sums.
**Source:** packages/db/prisma/schema.prisma

---

## 5. Frontend-Only Features Index

Quick reference for every requirement tagged `[FE-ONLY]` — UI behaviors with no backend counterpart. Use this when scoping a backend rewrite (everything here would need to be either preserved in the new frontend or hoisted to the API).

| ID | Feature |
|---|---|
| FR-AUTH-018 | 401 auto-redirect from frontend API client |
| FR-DATA-010 | Multi-file import session UI (sequential upload loop) |
| FR-PORT-018 | Auto-refetch positions every 60s |
| FR-PORT-019 | Auto-refetch sync status every 30s |
| FR-PORT-020 | Placeholder-price warning banner |
| FR-ANLY-015 | Monthly heatmap color scaling (max-abs) |
| FR-STOCK-018 | Chart split-adjustment + holiday snap-to-prior |
| FR-STOCK-020 | Tab state held in component (no URL) |
| FR-AI-040 | Floating-bar → drawer draft hand-off |
| FR-AI-044 | Typing indicator while streaming |
| FR-AI-045 | Stop-streaming button |
| FR-AI-048 | Optimistic message add |
| FR-AI-049 | Auto-scroll to latest message |
| FR-UI-001 | Positions table client-side sorting |
| FR-UI-002 | History page client-side filter state |
| FR-UI-003 | History pagination state |
| FR-UI-004 | Settings edit-mode toggle |
| FR-UI-005 | User-menu dropdown |
| FR-UI-006 | Mobile sidebar drawer |
| FR-UI-007 | Chat drawer animation |
| FR-UI-008 | Floating chat bar entry animation |
| FR-UI-009 | Floating chat bar rotating placeholder |
| FR-UI-010 | Cmd/Ctrl+K focuses chat input |
| FR-UI-011 | Esc closes chat drawer |
| FR-UI-012 | Enter sends, Shift+Enter newline |
| FR-UI-013 | Chat input auto-expand |
| FR-UI-014 | Chat history panel toggle |
| FR-UI-015 | Hebrew RTL detection |
| FR-UI-016 | Currency/percent/date/number formatters |
| FR-UI-017 | TanStack Query default cache (staleTime: 30s) |
| FR-UI-018 | Skeleton pulse loaders |
| FR-UI-019 | Empty-state messaging |
| FR-UI-020 | Form-level password validation |
| FR-UI-021 | Missing-token UI states (verify/reset) |
| FR-UI-022 | Drag-and-drop import zone |
| FR-UI-023 | Per-file import status pipeline |
| FR-UI-024 | Onboarding modal trigger logic |
| FR-UI-025 | Notes textarea character counter |
| FR-UI-026 | Logout flow on user-menu click |
| FR-UI-027 | Responsive grid layouts |
| FR-UI-028 | Sync indicator pill in TopBar |
| FR-UI-029 | Conversation-delete with no confirmation |
| FR-UI-030 | Monthly heatmap color scaling |

---

## 6. Cross-Reference Tables

### 6.1 Pages → primary FRs

| Frontend route | Backed by |
|---|---|
| `/login` | FR-AUTH-003, FR-AUTH-004 |
| `/signup` | FR-AUTH-001, FR-AUTH-002, FR-UI-020 |
| `/verify-email` | FR-AUTH-010, FR-UI-021 |
| `/forgot-password` | FR-AUTH-012 |
| `/reset-password` | FR-AUTH-013, FR-UI-020, FR-UI-021 |
| `/dashboard` | FR-PORT-012, FR-PORT-013, FR-PORT-014, FR-ADMIN-010 |
| `/positions` | FR-PORT-015, FR-PORT-016, FR-PORT-017, FR-UI-001 |
| `/positions/:ticker` | FR-STOCK-011..022 |
| `/history` | FR-DATA-016, FR-UI-002, FR-UI-003 |
| `/analytics` | FR-ANLY-014..020 |
| `/import` | FR-DATA-001, FR-DATA-010, FR-ADMIN-009, FR-UI-022, FR-UI-023 |
| `/alerts` | FR-ADMIN-008 (stub) |
| `/settings` | FR-ADMIN-001, FR-ADMIN-002, FR-UI-004 |
| `/` (root) | redirect to `/dashboard` |

### 6.2 API routes → FRs

| Method + Path | FRs |
|---|---|
| `GET /api/health` | (infra) |
| `POST /api/auth/signup` | FR-AUTH-001, FR-AUTH-002 |
| `POST /api/auth/login` | FR-AUTH-003 |
| `POST /api/auth/logout` | FR-AUTH-008 |
| `GET /api/auth/me` | FR-AUTH-009 |
| `POST /api/auth/verify-email` | FR-AUTH-010 |
| `POST /api/auth/resend-verification` | FR-AUTH-011 |
| `POST /api/auth/forgot-password` | FR-AUTH-012 |
| `POST /api/auth/reset-password` | FR-AUTH-013 |
| `PUT  /api/auth/profile` | FR-AUTH-014 |
| `GET /api/trades` | FR-DATA-016 |
| `GET /api/sync/status` | FR-DATA-012 |
| `GET /api/sync/log` | FR-DATA-013 |
| `POST /api/sync/import` | FR-DATA-001..011 |
| `GET /api/positions` | FR-PORT-007, FR-PORT-008 |
| `GET /api/snapshots` | FR-PORT-011 |
| `POST /api/snapshots/capture` | FR-PORT-009 |
| `GET /api/analytics/summary` | FR-ANLY-005 |
| `GET /api/analytics/pnl` | FR-ANLY-002, FR-ANLY-003, FR-ANLY-004 |
| `GET /api/analytics/risk` | FR-ANLY-016..019 |
| `GET /api/market/prices` | FR-MKT-007 |
| `POST /api/market/refresh` | FR-MKT-008, FR-PORT-017 |
| `GET /api/market/benchmarks` | FR-MKT-009 |
| `GET /api/market/unmapped` | FR-MKT-010 |
| `POST /api/market/map` | FR-MKT-011 |
| `GET /api/exchange-rates` | FR-MKT-013 |
| `POST /api/exchange-rates/backfill` | FR-MKT-014 |
| `GET /api/stock/:ticker/summary` | FR-STOCK-001..010 |
| `GET /api/stock/:ticker/open-lots` | FR-STOCK-002 |
| `GET /api/stock/:ticker/round-trips` | FR-STOCK-003 |
| `GET /api/stock/:ticker/chart` | FR-STOCK-004 |
| `POST /api/chat` | FR-AI-001..014 |
| `GET /api/chat/conversations` | FR-AI-010 |
| `GET /api/chat/conversations/:id` | FR-AI-010 |
| `DELETE /api/chat/conversations/:id` | FR-AI-010 |

### 6.3 AI tools → FRs

| Tool | Tier | FR |
|---|---|---|
| `get_portfolio_summary` | Core | FR-AI-015 |
| `query_trades` | Core | FR-AI-016 |
| `get_pnl_breakdown` | Core | FR-AI-017 |
| `get_behavioral_report` | Core | FR-AI-018 |
| `get_market_price` | Core | FR-AI-019 |
| `get_sync_status` | Core | FR-AI-020 |
| `trigger_sync` | Core (advisory) | FR-AI-021 |
| `create_alert` | Core | FR-AI-022 |
| `list_alerts` | Core | FR-AI-023 |
| `delete_alert` | Core | FR-AI-024 |
| `run_what_if` | Core | FR-AI-025 |
| `get_dividend_summary` | Tier 1 | FR-AI-026 |
| `get_cost_analysis` | Tier 1 | FR-AI-027 |
| `get_performance_timeline` | Tier 1 | FR-AI-028 |
| `get_streaks` | Tier 1 | FR-AI-029 |
| `get_sector_exposure` | Tier 1 | FR-AI-030 |
| `get_security_info` | Tier 1 | FR-AI-031 |
| `get_holding_period_analysis` | Tier 1 | FR-AI-032 |
| `get_benchmark_comparison` | Tier 2 | FR-AI-033 |
| `get_currency_impact` | Tier 2 | FR-AI-034 |
| `get_risk_report` | Tier 2 | FR-AI-035 |
| `simulate_alternative_investment` | Tier 2 | FR-AI-036 |

### 6.4 DB models → category coverage

| Model | Per-user? | Key FRs / NFRs |
|---|---|---|
| `users` | (root) | FR-AUTH-001, FR-AUTH-014, NFR-TENANT-005 |
| `sessions` | yes | FR-AUTH-004..008, NFR-SEC-002, NFR-SEC-010 |
| `verification_tokens` | yes | FR-AUTH-010..013 |
| `trades` | yes | FR-DATA-007, FR-DATA-015..016, NFR-TENANT-001 |
| `securities` | shared | FR-MKT-006, FR-STOCK-010 |
| `sync_log` | yes | FR-DATA-011..013, NFR-OBS-002 |
| `alerts` | yes | FR-AI-022..024, FR-ADMIN-007..008 |
| `market_prices` | shared | FR-MKT-005, NFR-PERF-002, NFR-SCALE-008 |
| `exchange_rates` | shared | FR-MKT-012..014 |
| `portfolio_snapshots` | yes | FR-PORT-008..011, NFR-REL-006 |
| `ai_conversations` | yes | FR-AI-008..010, NFR-TENANT-001 |
| `ai_messages` | yes (via conv) | FR-AI-008, FR-AI-011 |

### 6.5 External integrations → NFR coverage

| Service | Used by | NFR |
|---|---|---|
| Yahoo Finance | live prices, benchmarks, historical chart | NFR-REL-001, NFR-REL-002, NFR-PERF-002 |
| Stooq | US fallback (live + historical) | NFR-REL-001, NFR-REL-003 |
| TheMarker | TASE fallback (live only) | NFR-REL-002, NFR-REL-003 |
| Bank of Israel | FX rates | NFR-PERF-004 |
| Resend | transactional email | NFR-REL-009 |
| Anthropic Claude | AI agent | NFR-PERF-006..009, NFR-SCALE-001..003 |

---

## 7. Known Gaps & Stubs

Honest list of things that exist as scaffolding or partial implementations but do **not** behave as a typical reader might assume.

| ID | What | Status |
|---|---|---|
| FR-ADMIN-008 | `/alerts` page | **Stub.** Renders a single placeholder line. No list, no form, no live data. |
| FR-AI-022 | `create_alert` tool | Inserts a row into `alerts` but **no alert engine evaluates it**. Triggered status is never set. |
| FR-AI-021 | `trigger_sync` tool | Returns guidance string only. **Does not perform any sync** — IBI API integration was removed. |
| FR-AUTH-002 | Signup auto-verifies | Email verification is **disabled** because no Resend sending domain is verified. Verify endpoints still work but aren't triggered. |
| FR-AUTH-012 | "Forgot?" link on login | **Hidden in UI** while email is offline. Endpoint still functions. |
| NFR-OBS-005 | Test suite | **Vitest configured but no test files exist.** |
| NFR-SEC-011 | Rate limiting | **None implemented.** |
| NFR-SCALE-005 | Background job queue | **None.** All async work is fire-and-forget within request handlers. |
| (config) | Phase 5 deferred items | tax intelligence, news/events (Finnhub), technical indicators, `price_history` table, `security_events` table — all in PRD but **not implemented**. |
| (admin) | Editing display name or email | Settings page shows them **read-only.** No PATCH/PUT endpoint exists. |
| (data) | Trade notes field | `trades.notes` column exists; **no UI to write or display it.** |
| FR-PORT-009 | Capture Snapshot button | Surfaced on dashboard only when equity curve is empty. No manual recapture once snapshots exist. |
