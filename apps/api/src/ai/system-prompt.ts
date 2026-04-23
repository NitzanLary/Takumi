/**
 * System Prompt Builder — constructs the dynamic system prompt for Claude
 * with lightweight portfolio context injected on every request.
 */

import { getPortfolioSummary } from '../services/pnl.service.js';
import { getOpenPositions } from '../services/position.service.js';
import { getSyncStatus } from '../services/sync.service.js';
import { prisma } from '../lib/db.js';

export async function buildSystemPrompt(userId: string): Promise<string> {
  const [user, summary, positions, syncStatus] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } }),
    getPortfolioSummary(userId).catch(() => null),
    getOpenPositions(userId).catch(() => []),
    getSyncStatus(userId).catch(() => null),
  ]);

  const userName = user?.displayName || user?.email?.split('@')[0] || 'you';

  const positionCount = positions.length;
  // ILS-normalized totals (home currency). Summing native marketValue across
  // TASE (ILS) and US (USD) positions gives garbage numbers.
  const totalValueIls = positions.reduce((s, p) => s + p.marketValueIls, 0);
  const totalUnrealizedPnlIls = positions.reduce((s, p) => s + p.unrealizedPnlIls, 0);
  const top5 = positions.slice(0, 5);

  const now = new Date().toISOString();

  let portfolioContext = 'Portfolio data unavailable.';
  if (summary) {
    const pnlLines = summary.pnlByCurrency
      .map((c) => `  ${c.currency}: ${c.realizedPnl >= 0 ? '+' : ''}${c.realizedPnl.toFixed(2)}`)
      .join('\n');

    portfolioContext = `CURRENT PORTFOLIO (as of ${now}):
- Open Positions: ${positionCount}
- Total Market Value: ₪${totalValueIls.toFixed(2)} (ILS-normalized; USD positions converted at current BOI rate)
- Total Unrealized P&L: ${totalUnrealizedPnlIls >= 0 ? '+' : ''}₪${totalUnrealizedPnlIls.toFixed(2)} (ILS-normalized)
- Realized P&L by Currency:
${pnlLines}
- Win Rate: ${summary.winRate.toFixed(1)}%
- Total Closed Trades: ${summary.totalTrades}
- Avg Holding Period: ${summary.avgHoldingDays.toFixed(0)} days

Top Positions by Value:
${top5.map((p) => `  ${p.ticker} (${p.market}) — ${p.quantity} shares @ ${p.currentPrice.toFixed(2)} ${p.currency}, unrealized: ${p.unrealizedPnl >= 0 ? '+' : ''}${p.unrealizedPnl.toFixed(2)} (${p.unrealizedPnlPct >= 0 ? '+' : ''}${p.unrealizedPnlPct.toFixed(1)}%), weight: ${p.weight.toFixed(1)}%`).join('\n')}`;
  }

  let syncContext = 'Sync status unavailable.';
  if (syncStatus) {
    syncContext = `LAST DATA IMPORT:
- Date: ${syncStatus.lastSyncAt ?? 'Never'}
- Status: ${syncStatus.lastStatus ?? 'N/A'}
- Records Added: ${syncStatus.recordsAdded}`;
  }

  return `You are Takumi, a personal trading intelligence assistant for ${userName} — an independent investor who trades Israeli (TASE) and US (NYSE/NASDAQ) equities through IBI broker.

You have full read access to ${userName}'s trade history, current positions, and all portfolio analytics through your tools. Use tools to fetch data before answering — do not guess or hallucinate numbers.

Today: ${now}

${portfolioContext}

${syncContext}

GUIDELINES:
- Be direct, data-driven, and conversational. Lead with the answer, then explain.
- Always use tools to look up data before answering questions. Never fabricate numbers.
- Format currencies correctly: ₪ for ILS, $ for USD. Never mix currencies in a single amount.
- TASE securities use Hebrew names — include them as-is when referencing TASE stocks.
- For any trade recommendations or suggestions: always add "⚠ This is not financial advice."
- When presenting tables or lists, use markdown formatting.
- If a tool returns an error, acknowledge it and suggest alternatives.
- Keep responses concise but thorough. Use bullet points and tables for clarity.`;
}
