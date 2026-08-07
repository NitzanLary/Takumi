# Data-quality issues found while building the MCP connector

Found 2026-08-07 by exercising all 19 connector tools against live data
(`eranlarymail@gmail.com`, 894 trades). Four issues; three fixed, one open.

## Fixed

**`get_market_price` labelled TASE prices as USD.** `market` is optional and
defaulted to `'NYSE'`, so `{ticker: "5136544"}` — the documented way to ask for
an Israeli security — returned an ILS price tagged `USD`, a silent ~3.7× error.
Now resolves market/currency from `securities` first.

**`get_sector_exposure` reported 91% "Unknown".** It read only
`data/sector-map.json` (25 US tickers). Now falls back to `securities.sector`,
and reports unmapped holdings in a separate `unclassified` bucket with a warning
instead of an "Unknown" sector that reads like a real concentration.

**funder.co.il security history was returning nothing.** Not a variable rename —
`seco/` pages moved the series out of the JS literal into
`<textarea id="tStockDataRaw">` (HTML-escaped), so `literalRegex` could never
match. Each endpoint now carries ordered extractors. Verified: 16/16 TASE
securities resolve with data through 2026-08-06.

## Open — needs a product decision

**Stooq is behind a JS proof-of-work wall.** `q/d/l/` (history) returns a
SHA-256 hashcash challenge and `POST /__verify`; `q/l/` (quote) 404s on both
`.com` and `.pl`. Per CLAUDE.md, Stooq was the fallback for US quotes *and* the
S&P 500 benchmark, because Yahoo is unreliable from Railway.

`stooq.service.ts` now detects the block and disables itself for the process
lifetime (one warning, no retries), so it costs nothing — but the fallback is
gone. Three options, none obviously right:

- **Solve the PoW server-side.** Fragile and adversarial; they will iterate.
- **Swap providers** (Alpha Vantage / Twelve Data / Tiingo free tiers). Means an
  API key, rate limits, and a new failure mode.
- **Drop to Yahoo-only.** Accepts the Railway flakiness the fallback existed to
  cover. Cheapest; may be fine if that flakiness was rare.

Nothing was chosen — picking a vendor is not a bug fix.

**Sector data is thin, and code cannot fix it.** After the fallback above, ~91%
of the portfolio is still unclassified, because the unmapped holdings are Israeli
mutual funds and ETFs with no Yahoo mapping and therefore no `securities.sector`.
Backfilling from Yahoo would only help US tickers, which the static map already
covers. Real classification needs a manual TASE fund → sector mapping. The tool
is now honest about the gap rather than wrong about it.
