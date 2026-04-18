# Takumi AI Agent — How It Works

## Context

Takumi includes a persistent AI assistant powered by Claude (Anthropic). It is not a simple chatbot — it is an **agentic system** with read access to the full portfolio database through 21 tools. The agent can answer complex questions about trades, P&L, risk, dividends, market prices, and what-if scenarios by autonomously deciding which tools to call, in what order, and how to synthesize the results into a coherent answer.

The assistant appears as a slide-over drawer on the right side of every page. It maintains persistent conversation history across page navigations and browser refreshes.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Next.js :3000)                                    │
│                                                             │
│  ┌───────────────┐    Zustand    ┌─────────────────────┐    │
│  │  ChatDrawer   │◄──────────────│     chat-store.ts   │    │
│  │  MessageBubble│               │  (global state)     │    │
│  │  ChatInput    │               └────────┬────────────┘    │
│  └───────────────┘                        │ fetchSSE()      │
└───────────────────────────────────────────┼─────────────────┘
                                            │ POST /api/chat
                                            │ SSE stream ↑
┌───────────────────────────────────────────┼─────────────────┐
│  Express API (:3001)                      │                 │
│                                           ▼                 │
│  ┌─────────────┐   ┌───────────────────────────────────┐    │
│  │  chat.ts    │──►│       chat-handler.ts             │    │
│  │  (route)    │   │  Agentic Loop (max 10 tool calls) │    │
│  └─────────────┘   └───────┬──────────────┬────────────┘    │
│                            │              │                 │
│               Anthropic API│              │ Tool Execution  │
│                            ▼              ▼                 │
│                    ┌───────────┐  ┌──────────────────┐      │
│                    │  Claude   │  │  Tool Registry   │      │
│                    │ Sonnet 4  │  │  (21 tools)      │      │
│                    └───────────┘  └────────┬─────────┘      │
│                                            │                │
│                            ┌───────────────┼──────────┐     │
│                            ▼               ▼          ▼     │
│                       Services        Market API    SQLite  │
│                       (pnl, pos,      (Yahoo Fin.)  (Prisma)│
│                        risk, etc.)                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Frontend Layer

**[chat-store.ts](apps/web/src/stores/chat-store.ts)** — Zustand store, the single source of truth for all chat state:

| State | Description |
|---|---|
| `isOpen` | Whether the drawer is visible |
| `messages` | Current conversation's messages (user + assistant) |
| `isStreaming` | True while the agent is generating a response |
| `activeConversationId` | Which DB conversation is loaded |
| `conversations` | List of past conversations for the sidebar |

`sendMessage()` is the core action — it immediately appends a user bubble and an empty assistant bubble to the UI, then opens an SSE connection via `fetchSSE()`. As tokens and tool events arrive from the server, Zustand mutates the assistant bubble in place (token-by-token streaming, live tool status badges).

**[sse-client.ts](apps/web/src/lib/sse-client.ts)** — Since the browser's native `EventSource` only supports GET, this helper uses `fetch()` with a `ReadableStream` reader and manually parses the `data: {...}\n\n` SSE protocol line-by-line.

**[ChatDrawer.tsx](apps/web/src/components/ai/ChatDrawer.tsx)** — Fixed right-side panel (400px wide, full height). Shows the conversation list when idle; switches to message history during an active chat. Tool call indicators are rendered as collapsible badges inside `MessageBubble`.

---

### 2. API Route

**[chat.ts](apps/api/src/routes/chat.ts)** — Thin Express route. Validates the request body (`message`, optional `conversationId`), then delegates entirely to `handleChatStream()`.

---

### 3. Chat Handler — The Agentic Loop

**[chat-handler.ts](apps/api/src/ai/chat-handler.ts)** is the heart of the agent. Every call to `POST /api/chat` runs through this flow:

```
┌─────────────────────────────────────────────────────────┐
│                    handleChatStream()                   │
│                                                         │
│  1. Set SSE headers, flush                              │
│  2. Load or create DB conversation                      │
│  3. Build system prompt (live portfolio context)        │
│  4. Reconstruct message history from DB (last 40 msgs)  │
│  5. Append new user message                             │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              AGENTIC LOOP (max 10 iters)        │    │
│  │                                                 │    │
│  │  a. Call Claude API (streaming)                 │    │
│  │  b. Stream text_delta events → SSE → browser    │    │
│  │  c. Detect tool_use blocks in the response      │    │
│  │  d. If no tool calls → BREAK (done)             │    │
│  │  e. For each tool call:                         │    │
│  │     - Emit tool_call SSE event                  │    │
│  │     - Execute tool via registry                 │    │
│  │     - Emit tool_result SSE event                │    │
│  │  f. Append assistant + tool_result to messages  │    │
│  │  g. Loop back to (a)                            │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  6. Persist all new messages to DB (transaction)        │
│  7. Auto-title conversation from first user message     │
│  8. Emit done SSE event                                 │
└─────────────────────────────────────────────────────────┘
```

**Key constants:**

| Constant | Value | Purpose |
|---|---|---|
| `MAX_TOOL_CALLS` | 10 | Prevents infinite loops |
| `MAX_TOKENS` | 4096 | Max tokens per Claude response |
| `MODEL` | `claude-sonnet-4-20250514` | Claude model used |

---

### 4. System Prompt

**[system-prompt.ts](apps/api/src/ai/system-prompt.ts)** builds the prompt dynamically on every request. It fetches live data in parallel and injects a portfolio snapshot directly into the system prompt so Claude has immediate awareness without needing a tool call for basic facts.

**Injected context includes:**

- Number of open positions and total market value
- Total unrealized P&L
- Realized P&L broken down by currency (ILS / USD, never mixed)
- Win rate, total closed trades, average holding period
- Top 5 positions (ticker, market, quantity, current price, unrealized P&L %, weight)
- Last import date, status, and records added

```
┌──────────────────────────────────────────────────────┐
│  buildSystemPrompt()                                 │
│                                                      │
│  Parallel fetches:                                   │
│    getPortfolioSummary()  →  realized P&L, win rate  │
│    getOpenPositions()     →  live positions + prices │
│    getSyncStatus()        →  last import metadata    │
│                                                      │
│  Result: single string injected as Claude's          │
│  "system" parameter on every API call.               │
└──────────────────────────────────────────────────────┘
```

---

### 5. Tool Registry

**[tools/index.ts](apps/api/src/ai/tools/index.ts)** combines all 21 tools into a flat registry. Each tool has:
- A **schema** (Anthropic `Tool` format: name, description, JSON Schema `input_schema`)
- An **executor** function `(input) => Promise<unknown>`

The registry is registered with the chat handler at startup via `registerTools()`.

---

## The 21 Agent Tools

### Core Tools (11) — Fundamental portfolio operations

| Tool | Description |
|---|---|
| `get_portfolio_summary` | Open positions, market values, unrealized P&L, realized P&L summary |
| `query_trades` | Search trade history with filters (ticker, date range, direction, market) |
| `get_pnl_breakdown` | Realized P&L grouped by ticker, month, or market |
| `get_behavioral_report` | Win rate, avg holding period (winners vs losers), profit factor, largest win/loss |
| `get_market_price` | Live Yahoo Finance price for any ticker (15-min cache) |
| `get_sync_status` | Last import status and recent import history |
| `create_alert` | Create a price/P&L/duration/sync alert |
| `list_alerts` | List alerts (filtered by status or ticker) |
| `delete_alert` | Delete an alert by ID |
| `trigger_sync` | Guides user to the XLSX import page |
| `run_what_if` | What-if scenario: stop-loss simulation or modified sell date |

### Tier 1 Tools (7) — Derived analytics, no external APIs

| Tool | Description |
|---|---|
| `get_dividend_summary` | Gross dividends, withholding tax, net income (by year/ticker) |
| `get_cost_analysis` | Commissions analysis — total fees, avg rate, fee-to-gain ratio |
| `get_performance_timeline` | Monthly/quarterly P&L timeline from FIFO matched lots |
| `get_streaks` | Winning/losing streaks, consecutive trade analysis |
| `get_sector_exposure` | Portfolio weight by sector/industry from static sector map |
| `get_security_info` | Security metadata — market, currency, name, first/last trade dates |
| `get_holding_period_analysis` | Distribution of holding periods (days to close a position) |

### Tier 2 Tools (3) — Powered by external market data (Phase 3)

| Tool | Description |
|---|---|
| `get_benchmark_comparison` | Portfolio vs TA-125 and S&P 500 (relative performance, alpha) |
| `get_currency_impact` | Impact of ILS/USD rate changes on USD positions |
| `get_risk_report` | Herfindahl concentration, max drawdown, Sharpe ratio, Sortino ratio |

---

## SSE Event Protocol

The server streams newline-delimited JSON events of the form `data: {...}\n\n`. Event types:

```typescript
type AiSseEvent =
  | { type: 'text_delta';   text: string;            conversationId: string }
  | { type: 'tool_call';    toolName: string;         conversationId: string }
  | { type: 'tool_result';  toolName: string;         toolResult: unknown; conversationId: string }
  | { type: 'done';         conversationId: string }
  | { type: 'error';        error: string }
```

The frontend Zustand store reacts to each event:

```
text_delta   → append to assistant message content (streaming text)
tool_call    → push a { name, status: 'running' } badge to the assistant message
tool_result  → find the matching running badge, set status: 'done', attach result
done         → set isStreaming=false, reload conversation list
error        → set isStreaming=false, set error string
```

---

## Message History & Persistence

### Database Tables

```
ai_conversations
  id          (CUID)
  title       (auto-set from first 60 chars of first user message)
  createdAt
  updatedAt

ai_messages
  id          (CUID)
  conversationId → ai_conversations
  role        ('user' | 'assistant' | 'tool')
  content     (text)
  toolCalls   (JSON — only on assistant messages with tool use)
  createdAt
```

### Context Window Management

The handler loads the last 40 raw DB messages (≈ 20 user/assistant turns) and reconstructs them into the Anthropic message format:

```
DB role: 'user'       → { role: 'user', content: string }
DB role: 'assistant'  → { role: 'assistant', content: ContentBlock[] }
                          (text block + tool_use blocks if toolCalls exists)
DB role: 'tool'       → { role: 'user', content: [tool_result block] }
                          (Anthropic requires tool results as user-role messages)
```

Messages older than 40 are silently dropped — Claude only sees the recent context window, not the full conversation history.

### Persistence Timing

All new messages (user, assistant, tool results) are persisted **in a single DB transaction** after the agentic loop completes — not during streaming. This avoids partial saves if the connection drops mid-stream.

---

## Full Request Lifecycle

```
User types "What's my most profitable stock this year?"
          │
          ▼
chat-store.sendMessage()
  ├─ Adds user bubble + empty assistant bubble to UI
  ├─ Sets isStreaming = true
  └─ Calls fetchSSE('/api/chat', { message, conversationId })
          │
          ▼ POST /api/chat (SSE connection opens)
          │
handleChatStream()
  ├─ Load conversation from DB (or create new)
  ├─ buildSystemPrompt()           ← parallel DB fetches
  ├─ buildMessageHistory()         ← reconstruct last 40 msgs
  ├─ Push user message to history
  │
  └─ LOOP iteration 1:
       ├─ Call Claude API (streaming): "analyze this..."
       ├─ Claude decides: call get_pnl_breakdown(groupBy: 'ticker')
       ├─ Emit: { type: 'tool_call', toolName: 'get_pnl_breakdown' }
       │         → Frontend adds spinning badge on assistant bubble
       ├─ Execute: getPnlByTicker()  → [ { ticker: 'AAPL', pnl: 5200 }, ... ]
       ├─ Emit: { type: 'tool_result', toolName: 'get_pnl_breakdown', toolResult: [...] }
       │         → Frontend marks badge as done
       │
       └─ LOOP iteration 2:
            ├─ Call Claude API again with tool result in history
            ├─ Claude generates final answer (text only, no more tools)
            ├─ Emit: { type: 'text_delta', text: 'Your most profitable...' } × N
            │         → Frontend appends each token to assistant bubble
            └─ stop_reason = 'end_turn' → exit loop
  │
  ├─ Persist all messages to DB (transaction)
  ├─ Set conversation title if first message
  └─ Emit: { type: 'done', conversationId: '...' }
            → Frontend sets isStreaming=false, reloads conversation list
```

---

## FIFO Caching

Several tools (sector exposure, streaks, cost analysis, holding period analysis) internally call `runFifoMatching()` — the core P&L engine that matches buy lots against sells. Because a single chat turn can invoke multiple tools that each need FIFO results, the results are **cached in-memory with a 1-minute TTL**. This means the computationally expensive lot-matching runs at most once per chat turn, not once per tool.

---

## Conversation State Machine

```
             ┌──────────────┐
    open()   │    IDLE       │   close()
  ──────────►│  (no convo)  │◄──────────
             └──────┬───────┘
                    │ startNewConversation() or loadConversation()
                    ▼
             ┌──────────────┐
             │   READY      │
             │ (convo set)  │
             └──────┬───────┘
                    │ sendMessage()
                    ▼
             ┌──────────────┐
             │  STREAMING   │◄────────────────────┐
             │ isStreaming=T│  (tool calls loop)  │
             └──────┬───────┘                     │
                    │ done/error event            │
                    ▼                             │
             ┌──────────────┐                     │
             │   COMPLETE   │─────────────────────┘
             │ isStreaming=F│  (user sends next message)
             └──────────────┘
```

---

## Security & Guardrails

- **Read-only by default** — all 21 tools only read from the DB. The only write operations are `create_alert`, `delete_alert`, and conversation/message persistence.
- **Tool call cap** — the loop exits after 10 tool calls regardless of Claude's intent, preventing runaway API usage.
- **No hallucinated numbers** — the system prompt explicitly instructs Claude: "Always use tools to look up data before answering. Never fabricate numbers."
- **Financial advice disclaimer** — Claude is instructed to append `⚠ This is not financial advice.` to any trade recommendation.
- **ANTHROPIC_API_KEY** stored in `.env`, never exposed to the frontend.

---

## Planned Tier 3 Tools (Phase 5)

| Tool | Requires |
|---|---|
| `get_technical_indicators` | Daily OHLCV history (`price_history` table), TA calculations (50/200-day MA, RSI) |
| `get_news` | Finnhub free tier, `security_events` table |
| `get_upcoming_events` | Finnhub earnings calendar |
| `get_tax_report` | FIFO lot classification (short-term < 1yr vs long-term), tax-loss harvesting candidates |
