# funder.co.il — historical-price extraction notes

Reverse-engineered 2026-05-29. The site has **no public JSON / XHR API** for
historical prices. Both the security page (`/seco/{id}/s`) and the fund page
(`/fundo/{id}`) server-side render the full daily history inline as a
JavaScript variable literal which the page's chart library (AnyChart) reads
directly. The page **IS** the endpoint — fetch HTML, regex out the literal,
`JSON.parse`.

How this was confirmed: Playwright (headless Chromium) loaded each page with
network logging on. The only XHR/fetch requests during full load were
analytics beacons (`google-analytics.com`), Cloudflare RUM, and ad-server
iframes (`pirsum3.funder.co.il`) — none of them carry price data. The
`var tStockData …` literal is present in the initial HTML response.

There is a commented-out legacy XHR in `sec.js`
(`https://www.funder.co.il/wsStock.asmx/GetStockIdDn?id=…&startDate=…`) but it
is dead code and the asmx endpoint is no longer used.

---

## Endpoint A — Security (`seco`)

| Field | Value |
|---|---|
| URL pattern | `https://www.funder.co.il/seco/{paperId}/s` |
| Reference | `https://www.funder.co.il/seco/1143726/s` |
| Method | `GET` (returns HTML) |
| Required headers | **Only** a non-empty `User-Agent`. Empty `User-Agent` → `403` from the Cloudflare WAF. Default Node fetch UA, default curl UA, and even literal `"x"` all work. No `Referer`, `Cookie`, `Accept`, or token required. |
| Date-range params | **None.** Tried `?startDate=`, `?fromDate=&toDate=`, `?period=1m` — all ignored. Always returns the full available history. |
| Period toggles on the page | Pure client-side filtering of the already-embedded array by AnyChart's range selector. |
| Data location | `var tStockData = [[...]]` (search `/var\s+tStockData\s*=\s*(\[\[.*?\]\])\s*;/`) |
| Row shape | `[date, changePct, close, volume, high, low, open, close]` — 8 strings |
| Date format | `DD/MM/YYYY` |
| Price units | **Agorot** (TASE convention). Divide by 100 for ILS. Same as IBI's XLSX export. |
| Sample row | `["28/05/2026","-2.25","7115","6413913","7309","7112","7279","7115"]` → date 2026-05-28, open 72.79, high 73.09, low 71.12, close 71.15, volume 6,413,913 |
| Column mapping origin | Reverse-engineered from `https://cdn2.funder.co.il/assets/anychart-tools/js/sec.js` — `dataTable.mapAs({ x:0, open:6, high:4, low:5, close:7, value:{column:2} })`. Columns 2 and 7 both carry close; column 2 is what AnyChart's line mode reads. |
| Coverage depth | Inception to today. 1143726 (תכלית בנקים): **1,831 trading days**, back to 2018-11-04. 273011 (Bank Leumi region): **2,422 days**, back to 2016-05-30. |

## Endpoint B — Fund (`fundo`)

| Field | Value |
|---|---|
| URL pattern | `https://www.funder.co.il/fundo/{fundId}` (no trailing `/s`) |
| Reference | `https://www.funder.co.il/fundo/5123161` |
| Method | `GET` (returns HTML) |
| Required headers | Same as security: only a non-empty `User-Agent`. |
| Date-range params | **None.** Same probes ignored. Always full series. |
| Data location | `var tStockData2 = {"x":[{"c":"YYYY-MM-DD","p":NAV},...]}` (search `/var\s+tStockData2\s*=\s*(\{"x":\[.*?\]\})\s*;/`). The page also defines `var tStockData = []` as an empty shell — don't grab that one. |
| Row shape | `{c: ISO date, p: NAV}` — close / unit value only, **no OHLC, no volume** (funds publish one value per day) |
| Date format | ISO `YYYY-MM-DD` |
| Price units | **Shekels (ILS)**, rebased from 100. NAV / unit value, no /100 needed. |
| Sample row | `{"c":"2026-05-27","p":340.04}` → 2026-05-27, NAV 340.04 ILS |
| Coverage depth | Inception to today. 5123161 (תכלית S&P 500): **1,870 days**, back to 2016-06-20. 5113063: **2,447 raw points / 2,446 after dedup**, back to 2016-05-29. |

## Side-by-side diffs

| Dimension | `seco` (security) | `fundo` (fund) |
|---|---|---|
| URL trailing segment | `/s` | (none) |
| Variable name | `tStockData` | `tStockData2` (`tStockData` is empty) |
| Literal format | JS array of arrays | JSON `{x:[{c,p}]}` |
| Fields per bar | OHLC + volume + change% + redundant close | close (NAV) only |
| Date format | `DD/MM/YYYY` | `YYYY-MM-DD` (ISO) |
| Price scale | agorot (÷100) | shekels (1:1) |

## Caveats and gotchas

- **Cloudflare WAF on empty UA.** Any non-empty `User-Agent` works, but
  omitting it returns `403`. The fetcher hard-codes a Takumi-branded UA;
  callers can override.
- **No server-side date filtering.** Both endpoints ship the entire history
  inline on every request (~300–400 KB of HTML). For frequently-pulled tickers
  cache the parsed result locally. `fetchHistory(id, kind, {start, end})`
  filters client-side after parsing.
- **No volume / NAV for funds.** Fund payloads carry only close (NAV).
  `PriceBar.volume / open / high / low` are `undefined` for funds.
- **Source-data dirt: duplicate dates.** Fund `5113063` has two NAV values
  for 2018-03-05 (139.02 and 139.6) — looks like a same-day correction.
  `funder.service.ts` dedups adjacent same-date bars after sorting, keeping the
  last occurrence. Documented and silent (no warning).
- **Rate / agorot conversion is the only scaling step** for securities.
  Volume is stored as integer shares (already a real count, no scaling).
- **AnyChart embeds.** The page also loads ~15 themes, an AnyChart bundle,
  Hebrew locale file, etc. None of those matter for data extraction — they're
  pure client-side rendering.
- **Failure modes hit during dev:**
  - Empty `User-Agent` → `403`. Captured as the only mandatory header.
  - Browser `fetch` from inside the playwright `evaluate` was CORS-blocked
    when trying to pull `sec.js`. Fetched server-side via curl instead.
  - 4th id (`5113063`) tripped the verifier's strict monotonicity check on
    first run due to the upstream duplicate. Fixed by adding the dedup step.
- **Expect future breakage.** Variable name renames (e.g.
  `tStockData → priceSeries`) would immediately break the fetcher with
  `FunderParseError`. Re-run `discover-endpoints.ts` to re-derive the literal
  name and column mapping.

## Verification (2026-05-29)

| Target | Rows | Range | Monotonic | NaN |
|---|---:|---|---|---|
| `fetchHistory(1143726, 'security')` (תכלית בנקים) | 1,831 | 2018-11-04 .. 2026-05-28 | ✓ | none |
| `fetchHistory(5123161, 'fund')` (תכלית S&P 500) | 1,870 | 2016-06-20 .. 2026-05-27 | ✓ | none |
| `fetchHistory(273011, 'security')` | 2,422 | 2016-05-30 .. 2026-05-28 | ✓ | none |
| `fetchHistory(5113063, 'fund')` | 2,446 (1 dedup) | 2016-05-29 .. 2026-05-28 | ✓ | none |
| `fetchHistory(1143726, 'security', {start: 2025-01-01, end: 2025-03-31})` | 62 | 2025-01-01 .. 2025-03-31 | ✓ | none |

Live spot checks: 1143726 last close = **71.15 ILS** (matches `var tStockData`
last row 7115 agorot); 5123161 last NAV = **340.04 ILS** (matches the
fund's published unit value as of 2026-05-27).

## Files

The standalone prototype (`tase-history.ts` + `verify.ts`) documented here was
ported into production as `apps/api/src/services/funder.service.ts` and removed
from this folder. The verification table above is the original 2026-05-29
snapshot of that prototype, kept for the record. What remains here is the
maintenance tooling:

- `apps/api/src/services/funder.service.ts` (production) — pure-TypeScript
  runtime fetcher (native `fetch`, no Playwright / no browser at runtime).
  Exports `fetchHistory` / `fetchFunderHistorical`, the `PriceBar` and
  `Instrument` types, `guessFunderKind`, and typed errors. Wired into
  `market.service.getHistoricalPrices` as the TASE history fallback.
- `discover-endpoints.ts` — Playwright re-derivation script. Loads both
  reference pages, logs every XHR/fetch, probes the expected global names,
  and reports drift. Run when the runtime fetcher starts throwing
  `FunderParseError`.
- `verify.ts` — Phase 4 driver: runs `fetchHistory` against both reference
  ids plus one extra of each type, prints first/last 5 bars, checks
  monotonicity + no NaN, and exercises the date-range filter.
- `tsconfig.json` — strict TS config for the module (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`).
