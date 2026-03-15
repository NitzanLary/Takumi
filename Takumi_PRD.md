# Takumi — Personal Trading Intelligence Platform
**Product Requirements Document — v1.1**

---

| Field | Value |
|---|---|
| Version | 1.1 — IBI API Integration Update |
| Date | March 2026 |
| Broker | IBI / Spark (sparkibi.ordernet.co.il) |
| Asset Classes | Israeli Equities (TASE) · US Equities (NYSE / NASDAQ) |
| Trading Style | Medium-to-Long Term (weeks to months) |
| Platform | Web Application — browser-based |
| Data Source | IBI Spark REST API (primary) + CSV/Excel fallback |
| AI Engine | Anthropic Claude (claude-sonnet) |
| Account Key | ACC_000-118390 (environment variable) |

> ⚠️ **SECURITY NOTICE**
> The IBI Spark API was reverse-engineered for personal automation only.
> The account key `ACC_000-118390` and all JWT tokens are sensitive credentials.
> They must **NEVER** be committed to version control or exposed in the frontend.
> Store all credentials exclusively in server-side environment variables.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [User Profile & Context](#3-user-profile--context)
4. [System Architecture](#4-system-architecture)
5. [IBI Spark API Integration](#5-ibi-spark-api-integration)
6. [Data Layer](#6-data-layer)
7. [Analytics & Dashboard](#7-analytics--dashboard)
8. [AI Agent — Core Feature](#8-ai-agent--core-feature)
9. [Alerts & Notifications](#9-alerts--notifications)
10. [Functional Requirements](#10-functional-requirements)
11. [Non-Functional Requirements](#11-non-functional-requirements)
12. [Pages & Navigation](#12-pages--navigation)
13. [Recommended Tech Stack](#13-recommended-tech-stack)
14. [Phased Delivery Roadmap](#14-phased-delivery-roadmap)
15. [Open Questions & Decisions Needed](#15-open-questions--decisions-needed)
16. [Appendix A — IBI Sync Service Code Reference](#16-appendix-a--ibi-sync-service-code-reference)
17. [Appendix B — AI Agent Example Conversations](#17-appendix-b--ai-agent-example-conversations)

---

## 1. Executive Summary

**Takumi** is a personal trading intelligence web application for an independent investor trading Israeli and US equities through IBI. The system connects directly to IBI's Spark REST API to sync trade history automatically — eliminating manual exports — then delivers rich analytics, behavioral insights, and a conversational AI Agent that queries all portfolio data and provides personalized advice in real time.

The platform is organized around three pillars:

- **Data Layer** — automated sync from the IBI Spark API; CSV/Excel as a manual fallback.
- **Analytics Layer** — dashboards, P&L breakdowns, behavioral pattern detection, and alerts.
- **AI Agent Layer** — a persistent chat interface powered by Claude with full read access to every data point.

> ✅ **KEY UPGRADE IN v1.1**
> The IBI Spark REST API has been fully reverse-engineered. The system now syncs transactions automatically via scheduled background jobs, replacing manual CSV/Excel exports. Manual import is retained as a fallback.

---

## 2. Goals & Non-Goals

### 2.1 Goals

- Automatically sync all IBI transactions via the Spark API — no manual exports.
- Single source of truth for all historical and live trade data.
- Clear P&L visibility at position, ticker, and portfolio level.
- Behavioral insights: when and why the user wins or loses.
- A conversational AI Agent that understands all trade history and gives actionable advice.
- Real-time alerts and monitoring for open positions.
- Trade opportunity recommendations aligned with the user's historical style.

### 2.2 Non-Goals (v1)

- Direct order execution via the IBI API — read-only integration only.
- Multi-user or team collaboration.
- Derivatives, crypto, ETFs, or fixed income instruments.
- Fully automated trading bots.

---

## 3. User Profile & Context

| Field | Value |
|---|---|
| Trading experience | 2–3 years of active independent trading via IBI |
| Trading style | Medium-to-long term equity investing (weeks to months) |
| Asset focus | Israeli equities (TASE) + US equities (NYSE / NASDAQ) |
| Volume | Large number of transactions accumulated over 2–3 years |
| Core pain point | Lost in transaction volume; lacks behavioral self-awareness |
| Desired outcome | Automated data sync + AI advisor always on hand |
| Technical level | Developer — comfortable reading and contributing to code |
| IBI Account | ACC_000-118390 / Spark platform |

---

## 4. System Architecture

Four-tier architecture. The IBI Sync Service is a Python tier that runs server-side on a schedule and feeds the database automatically.

```
┌─────────────────────────────────────────────────────┐
│          Browser  /  Next.js Frontend               │
│    Dashboard · Analytics · AI Chat Panel            │
└────────────────────┬────────────────────────────────┘
                     │  REST + SSE
┌────────────────────▼────────────────────────────────┐
│         Node.js / Express Backend API               │
│  P&L Engine · Alerts · AI Proxy · Sync Trigger     │
└──────┬──────────────────────────────┬──────────────┘
       │                              │
┌──────▼──────────┐     ┌────────────▼───────────────┐
│   PostgreSQL     │     │  IBI Spark API Sync Svc    │
│  trades,         │◄────│  Python + APScheduler      │
│  positions,      │     │  Every 15 min incremental  │
│  alerts,         │     │  sparkibi.ordernet.co.il   │
│  sync_log        │     └────────────────────────────┘
└──────┬───────────┘
       │
┌──────▼──────────────────────────────────────────────┐
│            Anthropic Claude API                     │
│      claude-sonnet · Tool-use · SSE Streaming       │
└─────────────────────────────────────────────────────┘
```

### 4.1 Frontend

- Next.js 14 (React) SPA with file-based routing.
- Recharts / Tremor for data visualizations; Tailwind CSS for styling.
- Persistent AI Agent chat drawer on the right side of every page.
- Sync status badge in the navbar: last sync time and health indicator.

### 4.2 Backend API

- Node.js + Express REST API.
- Exposes endpoints for dashboard data, AI Agent tools, alerts, and sync trigger.
- Secure proxy to Anthropic Claude API — API key never reaches the browser.
- Streams AI responses token-by-token via Server-Sent Events (SSE).

### 4.3 IBI Sync Service

- Python service using `requests` + `APScheduler`.
- Runs every 15 minutes; handles Auth0 / JWT auth and all IBI API calls.
- Writes normalized records to PostgreSQL, deduplicating on `trade_id`.
- Logs every sync run to the `sync_log` table.

### 4.4 Database

- PostgreSQL (production) / SQLite (local development), managed via Prisma ORM.
- Core tables: `trades`, `positions`, `securities`, `alerts`, `sync_log`, `market_prices`, `ai_conversations`.

### 4.5 External Services

- **IBI Spark API** — primary transaction and holdings data source.
- **Anthropic Claude API** — AI Agent, tool-calling, SSE streaming.
- **Yahoo Finance / Twelve Data** (free tier) — market price fallback.
- **Exchange rate API** — daily ILS/USD conversion rate.

---

## 5. IBI Spark API Integration

> The IBI Spark REST API has been fully reverse-engineered from `sparkibi.ordernet.co.il`. All calls are plain JSON REST requests authenticated via a JWT Bearer token that expires every 4 minutes and must be refreshed every 15 seconds.

### 5.1 API Overview

| Field | Value |
|---|---|
| Base URL | `https://sparkibi.ordernet.co.il` |
| Auth mechanism | JWT Bearer token in `Authorization` header |
| Token lifetime | ~4 minutes — refresh every 15 seconds during active sync |
| Auth provider | Auth0 (domain: `auth.ibi.co.il`) |
| Account key | `ACC_000-118390` (store in env var, never hardcode) |
| Data format | JSON (`Accept: application/json`) |
| Language header | `Accept-Language: he` (required by some endpoints) |

### 5.2 Authentication Flow

#### Step 1 — Auth0 PKCE Login (one-time bootstrap via Playwright)

| Field | Value |
|---|---|
| Auth0 Domain | `https://auth.ibi.co.il` |
| Client ID | `geG3gUdjIItLlWsGcXCjQu4fwrk46uB8` |
| Scope | `openid profile email` |
| Flow | Authorization Code with PKCE |
| Redirect URI | `https://sparkibi.ordernet.co.il/#/loginauth0` |

Use Playwright headlessly to complete the Auth0 login, extract the IBI JWT from `sessionStorage` key `ngStorage-token`, and persist it server-side.

#### Step 2 — Exchange Auth0 token for IBI JWT

```
GET /api/Auth/AuthenticateAuth0?token=<AUTH0_ID_TOKEN>

Response: { LoginStatus: 'Success', Token: '<IBI_JWT>' }
```

#### Step 3 — Refresh JWT every 15 seconds during sync

```
GET /api/Auth/GetAuthData
Authorization: Bearer <IBI_JWT>
Accept-Language: he

Response: { LoginStatus: 'Success', Token: '<NEW_IBI_JWT>' }
```

### 5.3 Transaction Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/Account/GetAccountTransactions` | Historical transactions — used for the initial full backfill |
| `GET /api/Account/GetNewAccountTransactions` | Recent transactions — used for every 15-minute incremental sync |

Both endpoints accept `accountKey`, `startDate`, and `endDate` (ISO format: `2024-01-01T00:00:00.000Z`). Call both on the first sync; merge and deduplicate for complete coverage.

### 5.4 Additional API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/Account/GetAccountSecurities` | Current holdings — live prices for open positions |
| `GET /api/Account/GetAccountDailyYields?year=YYYY` | Daily P&L yields — powers the equity curve chart |
| `GET /api/Account/GetAccountMonthlyYields` | Monthly P&L summary — powers the heatmap calendar |
| `GET /api/Account/GetHoldings` | Detailed holdings breakdown |
| `GET /api/UserPersonalization/GetUserData` | User and account metadata |
| `GET /api/DataProvider/GetStaticData` | Static reference data (security names, codes) |

### 5.5 Sync Service Operational Logic

#### Full Historical Sync (run once on first setup)

1. Call `GetAccountTransactions`: `startDate` = 3 years ago, `endDate` = today.
2. Call `GetNewAccountTransactions` for same range as safety net.
3. Merge, deduplicate on `trade_id`, write all records to `trades` table.
4. Record in `sync_log`: `{ type: 'full', records: N, timestamp, status }`.

#### Incremental Sync (every 15 minutes via cron)

1. Call `GetNewAccountTransactions`: `startDate` = last successful sync timestamp.
2. Upsert new records only (`ON CONFLICT trade_id DO NOTHING`).
3. Call `GetAccountSecurities` to refresh prices on open positions.
4. Log sync run and trigger alert evaluation.

#### Token Management

- On sync start: use cached JWT if < 3 minutes old; otherwise re-authenticate.
- During sync: call `GetAuthData` on a 15-second background thread.
- On 401 response: re-authenticate immediately and retry the failed request once.

### 5.6 CSV / Excel Fallback

Retained for: first-time backfill before API bootstrap, recovery from API outages, and manual import of a specific date range. Both paths normalize data into the same internal trade schema.

### 5.7 Security Requirements

> ⚠️ **MANDATORY — no exceptions.**
>
> 1. IBI JWT, Auth0 token, and account key stored exclusively in server-side `.env`.
> 2. These values must **NEVER** appear in frontend JS, browser storage, logs, or git.
> 3. The `.env` file must be in `.gitignore` before the first commit.
> 4. Playwright bootstrap must not write credentials to disk in plaintext.
> 5. Sync service must not expose credentials in error messages.

---

## 6. Data Layer

### 6.1 Trade Record Schema

| Field | Type | Description |
|---|---|---|
| `trade_id` | TEXT PK | Unique identifier from IBI API (or generated for CSV imports) |
| `ticker` | TEXT | Security symbol (e.g. AAPL, TEVA) |
| `security_name` | TEXT | Full security name from IBI static data |
| `market` | TEXT | TASE \| NYSE \| NASDAQ |
| `direction` | TEXT | BUY \| SELL |
| `quantity` | NUMERIC | Number of shares traded |
| `price` | NUMERIC | Execution price per share |
| `currency` | TEXT | ILS \| USD |
| `commission` | NUMERIC | Brokerage commission paid |
| `trade_date` | TIMESTAMP | Date and time of execution |
| `source` | TEXT | API \| CSV — origin of the record |
| `raw_payload` | JSONB | Original IBI API response stored for debugging |
| `notes` | TEXT | Optional user annotation |

### 6.2 Sync Log Schema

| Field | Type | Description |
|---|---|---|
| `id` | INT PK | Auto-increment |
| `sync_type` | TEXT | full \| incremental \| manual_csv |
| `started_at` | TIMESTAMP | Sync start time |
| `completed_at` | TIMESTAMP | Sync completion time |
| `records_synced` | INT | Number of new records written |
| `status` | TEXT | success \| partial \| failed |
| `error_message` | TEXT | Error details if status is not success |

### 6.3 Position & P&L Calculation

- Positions derived from trades using FIFO matching (configurable to LIFO or Average Cost).
- Realized P&L: per matched lot, net of commissions.
- Unrealized P&L: live price from `GetAccountSecurities` minus cost basis.
- `GetAccountDailyYields` feeds the equity curve chart from IBI's own calculations.
- Currency normalization: all values available in ILS and USD using the daily stored rate.

---

## 7. Analytics & Dashboard

### 7.1 Portfolio Overview

- Total portfolio value — open positions at live IBI price.
- Total realized P&L: all-time, YTD, and custom date range.
- Total unrealized P&L, overall win rate, average holding period.
- Last sync timestamp and health indicator.

### 7.2 Per-Ticker Breakdown

- Realized P&L, unrealized P&L, and total per ticker.
- Number of trades, average buy vs. sell price, per-ticker win rate.

### 7.3 Behavioral Pattern Analysis

- Winning vs. losing trade patterns: day of week, holding duration, market, sector.
- Trade frequency heatmap per month and quarter.
- TASE vs. US performance comparison.
- Overtrading detector: flags periods of unusually high frequency.

### 7.4 Visualizations

- **Equity curve** — from `GetAccountDailyYields` data.
- **Monthly P&L heatmap** — from `GetAccountMonthlyYields` data.
- P&L waterfall chart, win/loss ratio bar, holding period histogram, market exposure pie.

---

## 8. AI Agent — Core Feature

> The AI Agent is the primary interface for insight and decision-making.
>
> It has full read access to all trade history, live positions, P&L data, behavioral analytics, and sync status. The user converses in plain English to ask questions, get coaching, request trade ideas, set alerts, trigger syncs, and run what-if scenarios — like a personal trading analyst on call at all times.

### 8.1 Interface

- Persistent chat drawer on the right side of every page — collapsible.
- Conversation history stored per session; optionally persisted across sessions.
- Markdown rendering: tables, bullet lists, bold text, inline code.
- Quick-action chips: `Summarize my portfolio`, `What's my worst habit?`, `Suggest a trade`, `Sync now`, `Show open positions`.

### 8.2 Agent Capabilities

#### 8.2.1 Portfolio Q&A

- *"What is my total P&L for 2024?"*
- *"Which stock has cost me the most money?"*
- *"Show all losing positions held more than 3 months."*
- *"What is my current portfolio value?"* — uses live IBI holdings data
- *"When was the last data sync?"*

#### 8.2.2 Behavioral Coaching

- *"What are my biggest trading mistakes?"*
- *"Do I tend to sell winners too early?"*
- *"Am I more successful on TASE or US markets?"*
- *"What is my typical pattern before a big loss?"*

#### 8.2.3 Trade Recommendations

- Suggest securities or setups based on the user's historical win patterns.
- Warn against setups that historically correlate with losses.
- All recommendations include: **advisory only — not financial advice**.

#### 8.2.4 Alert Management via Chat

- *"Alert me if any position drops more than 8% from my entry."*
- *"Show my active alerts."*
- *"Delete the alert on Bank Hapoalim."*
- Agent creates, lists, and deletes alerts through natural conversation.

#### 8.2.5 Sync Control via Chat

- *"Sync my data now."* — triggers on-demand incremental sync
- *"When was the last sync?"* — queries `sync_log`
- *"The sync failed — what happened?"* — agent reads and explains `error_message` from `sync_log`

#### 8.2.6 What-If Analysis

- *"If I had sold TEVA 2 weeks earlier, what would my P&L have been?"*
- *"How would 2023 look if I cut every loss at -5%?"*

### 8.3 Technical Implementation

- **Model:** `claude-sonnet-4-20250514` via the Anthropic Messages API.
- **System prompt:** live portfolio summary, open positions, behavioral stats, and sync status injected server-side on every request.
- **Tool use:** 11 backend tools (see Section 8.4) for all data access and write operations.
- **Streaming:** SSE token-by-token; rate limiting and `max_tokens` cap configured server-side.
- **Context management:** older conversation turns summarized to stay within model context limits.

### 8.4 Agent Tool Definitions

| Tool Name | Description |
|---|---|
| `get_portfolio_summary` | Returns open positions, total value, unrealized P&L from live IBI data |
| `query_trades` | Filters trade history by ticker, date range, direction, or market |
| `get_pnl_breakdown` | Returns realized P&L grouped by ticker, month, quarter, or market |
| `get_behavioral_report` | Returns win rate, avg holding period, and behavioral pattern summary |
| `run_what_if` | Simulates a modified trade history and returns hypothetical P&L |
| `get_market_price` | Returns current price from IBI `GetAccountSecurities` or fallback API |
| `create_alert` | Creates a price-drop, price-target, or holding-duration alert |
| `list_alerts` | Returns all active alerts |
| `delete_alert` | Deletes an alert by ID |
| `trigger_sync` | Initiates an on-demand incremental sync from the IBI API |
| `get_sync_status` | Returns last sync timestamp, records synced, and any error details |

---

## 9. Alerts & Notifications

### 9.1 Alert Types

- **Price drop:** notify when a position falls X% below entry price.
- **Price target:** notify when a position reaches a specified price.
- **Holding duration:** notify when a position has been held longer than N days.
- **Portfolio P&L threshold:** notify when total unrealized loss exceeds a dollar amount.
- **Sync failure:** notify when 3 consecutive incremental syncs fail.

### 9.2 Delivery

- In-app notification banner on every page.
- Alert inbox (`/alerts`) with full triggered and dismissed history.
- Alerts created and managed via AI Agent chat (preferred) or Alerts UI.
- Browser push notifications and email digest — v1.1 backlog.

---

## 10. Functional Requirements

| ID | Module | Requirement | Priority |
|---|---|---|---|
| FR-01 | IBI API | Authenticate with IBI Spark via Auth0 PKCE + JWT exchange | Must Have |
| FR-02 | IBI API | Auto-refresh JWT every 15 seconds during active sync | Must Have |
| FR-03 | IBI API | Full historical sync — GetAccountTransactions + GetNewAccountTransactions | Must Have |
| FR-04 | IBI API | Incremental sync every 15 minutes via cron | Must Have |
| FR-05 | IBI API | Sync GetAccountSecurities to refresh open position prices | Must Have |
| FR-06 | IBI API | Sync GetAccountDailyYields and GetAccountMonthlyYields for charts | Must Have |
| FR-07 | IBI API | Log every sync run to sync_log (timestamp, records, status) | Must Have |
| FR-08 | IBI API | Deduplicate trades on upsert using trade_id as primary key | Must Have |
| FR-09 | IBI API | Playwright bootstrap script for first-time Auth0 login | Must Have |
| FR-10 | IBI API | Manual sync trigger via UI button and AI Agent chat | Must Have |
| FR-11 | Import | CSV/Excel upload as fallback import method | Should Have |
| FR-12 | Import | Preview parsed rows before committing import | Should Have |
| FR-13 | Dashboard | Total realized and unrealized P&L displayed prominently | Must Have |
| FR-14 | Dashboard | Equity curve chart powered by GetAccountDailyYields data | Must Have |
| FR-15 | Dashboard | Sync status badge: last sync time and health indicator | Must Have |
| FR-16 | Dashboard | Per-ticker P&L breakdown with sortable table | Must Have |
| FR-17 | Analytics | Win rate and average holding period prominently displayed | Must Have |
| FR-18 | Analytics | Behavioral pattern report: winning vs. losing conditions | Must Have |
| FR-19 | Analytics | Monthly P&L heatmap from GetAccountMonthlyYields data | Must Have |
| FR-20 | Analytics | TASE vs. US equities performance comparison | Should Have |
| FR-21 | AI Agent | Persistent chat panel visible on every page | Must Have |
| FR-22 | AI Agent | Agent answers natural language portfolio questions using live data | Must Have |
| FR-23 | AI Agent | Agent calls 11 tool definitions for all data access | Must Have |
| FR-24 | AI Agent | Responses streamed token-by-token via SSE | Must Have |
| FR-25 | AI Agent | Agent can trigger and report on IBI data syncs | Must Have |
| FR-26 | AI Agent | Agent provides behavioral coaching and trade recommendations | Must Have |
| FR-27 | AI Agent | Agent creates, lists, and deletes alerts via natural conversation | Must Have |
| FR-28 | AI Agent | Agent performs what-if scenario analysis | Should Have |
| FR-29 | Alerts | Price-drop alert with configurable % threshold | Must Have |
| FR-30 | Alerts | Sync failure alert when cron fails 3 consecutive times | Must Have |
| FR-31 | Alerts | Alert inbox with full triggered and dismissed history | Must Have |
| FR-32 | Security | All credentials stored server-side in environment variables only | Must Have |
| FR-33 | Data | Toggle all monetary values between ILS and USD | Should Have |

---

## 11. Non-Functional Requirements

### 11.1 Performance

- Dashboard initial load: < 2 seconds for up to 5,000 trade records.
- AI Agent first token: < 1.5 seconds after user submits a message.
- Incremental sync completion: < 30 seconds for a typical 15-minute delta.

### 11.2 Security

- JWT, Auth0 tokens, and account key stored exclusively in server-side env vars.
- Anthropic API key stored server-side only — never reaches the browser.
- HTTPS enforced in any cloud deployment.
- Raw IBI payloads stored in `raw_payload` but never exposed via the API.
- `.env` added to `.gitignore` before first commit.

### 11.3 Reliability

- Sync failures caught, logged, and surfaced via `sync_log` — must not crash the backend.
- On 401 during sync: auto-retry with fresh token.
- 3 consecutive sync failures → in-app alert to the user.

---

## 12. Pages & Navigation

| Route | Content |
|---|---|
| `/dashboard` | Portfolio overview — equity curve, P&L, KPIs, sync status badge |
| `/positions` | Open positions — live IBI prices, unrealized P&L, active alerts |
| `/history` | Full trade history — filterable by ticker, date, market, direction |
| `/analytics` | Behavioral patterns — heatmaps, win/loss breakdowns, TASE vs. US |
| `/sync` | Sync dashboard — last sync log, manual trigger, error history, CSV fallback |
| `/alerts` | Create, view, and manage all alerts; full triggered-alert history |
| `/settings` | Currency preference, cost basis method, sync schedule, API key config |

The AI Agent chat panel is a **persistent right-side drawer** available on every page without navigation. `/sync` replaces the old `/import` page as the primary data management surface.

---

## 13. Recommended Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | Next.js 14 + React | SSR, file-based routing, easy Vercel deployment |
| Styling | Tailwind CSS | Utility-first, rapid iteration |
| Charts | Recharts | React-native, lightweight, customizable |
| Backend API | Node.js + Express | Developer-familiar; clean REST + SSE support |
| IBI Sync Svc | Python + requests + APScheduler | Matches existing IBIClient code; easy scheduling |
| Auth Bootstrap | Playwright (Python) | Headless Auth0 login; one-time or periodic re-auth |
| Database | SQLite (dev) / PostgreSQL (prod) | Simple local start; scales to cloud when ready |
| ORM | Prisma | Type-safe DB access, easy schema migrations |
| AI Engine | Anthropic Claude API (claude-sonnet) | Tool-use, streaming, large context window |
| Market Data | IBI GetAccountSecurities (primary) | Live prices direct from broker — most accurate |
| Fallback Prices | Yahoo Finance / Twelve Data free tier | Backup if IBI price data is insufficient |
| Deployment | Vercel (frontend) + Railway (backend + sync) | Zero-DevOps for a solo developer |

---

## 14. Phased Delivery Roadmap

### Phase 1 — IBI API Foundation (Weeks 1–3)

- Playwright bootstrap script for Auth0 login and JWT extraction.
- Python IBIClient with JWT auto-refresh (15-second heartbeat).
- Full historical sync: `GetAccountTransactions` + `GetNewAccountTransactions`.
- Database schema (Prisma): `trades`, `positions`, `sync_log` tables.
- Trade history UI with filters and search.

### Phase 2 — Live Data & Analytics (Weeks 4–5)

- Incremental sync cron job (every 15 minutes).
- `GetAccountSecurities` integration for live position prices.
- `GetAccountDailyYields` → equity curve chart.
- `GetAccountMonthlyYields` → monthly P&L heatmap.
- Portfolio dashboard: P&L, open positions, sync status badge.
- Per-ticker P&L breakdown and win rate analytics.

### Phase 3 — AI Agent (Weeks 6–8)

- Persistent chat panel with Claude integration and SSE streaming.
- System prompt with live portfolio context and sync status.
- All 11 agent tools implemented (Section 8.4).
- Quick-action chips including `Sync now`.
- Conversation history storage.

### Phase 4 — Alerts & Behavioral Analysis (Weeks 9–10)

- Alert engine: price-drop, target, duration, sync-failure alerts.
- Alert inbox with full history.
- Behavioral pattern analysis module.
- What-if scenario analysis via AI Agent.
- Settings page: currency toggle, cost basis method, sync schedule.

### Phase 5 — Polish & Hardening (Weeks 11–12)

- Performance optimization for 5,000+ trade records.
- Security review: credential isolation and env var audit.
- CSV/Excel fallback import polished as a secondary data path.
- Export dashboard views to PDF or Excel.
- Browser push notifications for alerts (optional).

---

## 15. Open Questions & Decisions Needed

| # | Question | Options / Notes |
|---|---|---|
| 1 | IBI API field mapping | Run `GetAccountTransactions` once and inspect actual JSON field names — the parser depends on these. Critical for Phase 1. |
| 2 | Playwright session lifetime | How long does the Auth0 session stay valid? Determines how often bootstrap needs to re-run. |
| 3 | Sync frequency | 15-minute incremental is the default. Is on-demand-only sufficient to reduce API load? |
| 4 | Cost basis method | FIFO (recommended default) vs. LIFO vs. Average Cost — configurable in Settings. |
| 5 | Hosting model | Fully local (localhost) vs. deployed cloud (Vercel + Railway). Affects how the Python sync service runs. |
| 6 | AI Agent memory | In-session only vs. persistent cross-session conversation history stored in DB. |
| 7 | IBI ToS compliance | Confirm that automated personal-use API access is permitted under IBI's terms of service before going to production. |

---

## 16. Appendix A — IBI Sync Service Code Reference

### IBIClient — Core Python Implementation

```python
import requests, os
from datetime import datetime

BASE_URL    = 'https://sparkibi.ordernet.co.il'
ACCOUNT_KEY = os.environ['IBI_ACCOUNT_KEY']   # never hardcode

class IBIClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'he',
            'Origin': 'https://sparkibi.ordernet.co.il',
        })
        self.jwt_token = None

    def authenticate_with_token(self, auth0_id_token: str):
        resp = self.session.get(
            f'{BASE_URL}/api/Auth/AuthenticateAuth0',
            params={'token': auth0_id_token}
        )
        data = resp.json()
        self.jwt_token = data['Token']
        self.session.headers['Authorization'] = f'Bearer {self.jwt_token}'

    def refresh_session(self):
        resp = self.session.get(f'{BASE_URL}/api/Auth/GetAuthData')
        data = resp.json()
        if 'Token' in data:
            self.jwt_token = data['Token']
            self.session.headers['Authorization'] = f'Bearer {self.jwt_token}'

    def get_transactions(self, start_date: str, end_date: str):
        return self.session.get(
            f'{BASE_URL}/api/Account/GetAccountTransactions',
            params={
                'accountKey': ACCOUNT_KEY,
                'startDate': start_date,
                'endDate': end_date
            }
        ).json()

    def get_holdings(self):
        return self.session.get(
            f'{BASE_URL}/api/Account/GetAccountSecurities',
            params={'accountKey': ACCOUNT_KEY}
        ).json()
```

---

## 17. Appendix B — AI Agent Example Conversations

### Example 1: Live portfolio value

```
User:  What's my current portfolio value?

Agent: Your portfolio is currently worth ~₪487,320 (~$131,400 at today's rate),
       based on live IBI prices from 2 minutes ago.
       Largest positions: Bank Hapoalim (₪142,000), NVIDIA ($28,400), Teva (₪61,500).
       Unrealized gain today: +₪3,240 (+0.67%).
```

### Example 2: Sync control via chat

```
User:  When was the last sync?

Agent: Last successful sync was 8 minutes ago (14:22 today).
       12 new transactions were pulled. Everything looks healthy.
       Want me to trigger a fresh sync now?
```

### Example 3: Behavioral coaching

```
User:  What's my biggest trading mistake?

Agent: Your most costly pattern is holding losing positions too long.
       Losing trades: held 47 days on average before exit.
       Winning trades: only 28 days on average.
       Cutting losses at -8% would have saved ~$4,800 in 2023 alone.
```

### Example 4: Trade recommendation

```
User:  Suggest a trade based on my style.

Agent: You perform best buying large-cap Israeli banks during dips and holding
       6–10 weeks (78% win rate in that setup). Bank Leumi (LUMI) is down ~6%
       this month — that matches your historical entry pattern.

       ⚠  Not financial advice. Please conduct your own due diligence.
```

---

*— End of Document —*