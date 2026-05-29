# Plan PR #2: Dashboard Equity Curve Redesign

This is a Takumi feature redesign — see [CLAUDE.md](../CLAUDE.md) for the project's architecture, conventions (per-user data scoping, ILS-home-currency rules, FIFO P&L, market data services), and the existing snapshots / dashboard code paths.

**Prerequisite (assume done):** A separate PR #1 has added a shared `price_history(ticker, date, close, source)` table with `(ticker, date)` unique, and refactored `market.service.getHistoricalPrices` to be DB-first (read range → fill gaps from Yahoo/Stooq → upsert → return). Your plan can rely on `price_history` being populated lazily by that service.

**Goal:** Replace the current dashboard equity curve (which is backed by `portfolio_snapshots` and only spans the few weeks Takumi has been running) with a real historical curve computed on-demand from existing source data, plus a timeframe toggle.

## Decisions already made — do not relitigate, just plan around them

1. **Compute on-demand.** For each day in the requested window, derive holdings-as-of-EOD from `trades` (BUY/SELL, per-user, scoped by `userId`), multiply by historical close from `price_history`, convert USD positions to ILS using the BOI rate for that date from `exchange_rates`, sum to get a single ILS market-value point. Cost basis is computed via a parallel walk of trades (cumulative net invested capital in ILS — BUY cost added, SELL cost-basis released). Carry-forward last known close for weekends/holidays/unmapped TASE tickers. *Closed positions on past days must be included* — the historical curve reflects what was held then, not what's held now.

2. **Drop `portfolio_snapshots` entirely.** Remove the table from the Prisma schema, delete `snapshot.service.ts`, remove `POST /api/snapshots/capture` and `GET /api/snapshots`, remove the auto-capture trigger in `position.service.getOpenPositions`, drop the snapshot section from CLAUDE.md. Audit for any other readers/writers before deleting.

3. **Chart shape:** two lines — Market Value (solid) and Cost Basis (dashed), both in ILS. Under the chart, a small KPI strip showing Realized P&L and Total Return % for the selected window (window-bounded, not all-time). Realized P&L comes from existing FIFO matching in `pnl.service`, filtered to match dates in the window.

4. **Timeframe toggle:** `1W | 1M | YTD | 1Y | All`. No 1D in this PR (deferred). Density per timeframe:
   - **1W** → daily (~7 points)
   - **1M** → daily (~30 points)
   - **YTD** → daily (up to ~150 points)
   - **1Y** → weekly — pick the last available trading day per ISO week (~52 points)
   - **All** → monthly — pick the last available trading day per calendar month

   Downsampling is "pick a real day," not averaging — tooltips must show a real date.

5. **Single ILS line** (home currency). Per-market lines are out of scope.

6. **Lazy population.** First dashboard load triggers `price_history` gap fills via the PR #1 service. No user-facing backfill button. The chart endpoint should be tolerant of slow first-loads and fast on subsequent loads.

## Things your plan must address

- New/changed API route shape for the chart (single endpoint with `?window=` param vs. something else)
- Where the computation lives (new `equity-curve.service.ts`? extend `analytics.service`?)
- How to efficiently fetch trades + per-ticker price history + FX in bulk (avoid N+1)
- Frontend: replace the existing Recharts equity curve component on the dashboard with a new component carrying the timeframe toggle + two-line chart + KPI strip
- Migration: a Prisma migration that drops `portfolio_snapshots`
- The CLAUDE.md updates required (snapshots section removal, dashboard section update, new conventions if any)

## Report format

A step-by-step implementation plan with file paths, ordered so each step is independently verifiable. Identify any critical files I should look at before starting. Call out any architectural trade-offs you hit (e.g. one endpoint vs. five, computation perf concerns) so I can decide before coding. Do NOT write code — plan only.
