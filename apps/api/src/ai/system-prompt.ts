/**
 * System Prompt Builder — returns a static prefix (cacheable) and a dynamic
 * suffix (per-request). The handler concatenates them via Anthropic's
 * multi-block `system` parameter with `cache_control` on the static block.
 */

import { getPortfolioSummary } from '../services/pnl.service.js';
import { getOpenPositions } from '../services/position.service.js';
import { getSyncStatus } from '../services/sync.service.js';
import { prisma } from '../lib/db.js';

const HORIZON_LABELS: Record<string, string> = {
  intraday: 'intraday / day trading',
  swing: 'days to weeks (swing)',
  position: 'months to a year (position)',
  long_term: '1+ years (long-term)',
  mixed: 'mixed — varies by position',
};

const GOAL_LABELS: Record<string, string> = {
  aggressive_growth: 'aggressive capital growth',
  steady_growth: 'steady long-term growth',
  income: 'dividend income',
  preservation: 'capital preservation',
  learning: 'learning / experimenting',
};

function inferredHorizonLabel(avgDays: number | null | undefined): string | null {
  if (avgDays == null) return null;
  if (avgDays < 2) return 'intraday';
  if (avgDays < 30) return 'swing (days to weeks)';
  if (avgDays < 365) return 'position (months)';
  return 'long-term (1+ years)';
}

// Static role + guidelines. No interpolations — this string is identical
// across users and requests so Anthropic's prompt cache can reuse it.
const STATIC_SYSTEM_PROMPT = `You are Takumi, a personal trading intelligence assistant for an independent investor who trades Israeli (TASE) and US (NYSE/NASDAQ) equities through IBI broker.

You have full read access to the user's trade history, current positions, and all portfolio analytics through your tools. Use tools to fetch data before answering — do not guess or hallucinate numbers.

GUIDELINES:
- Be direct, data-driven, and conversational. Lead with the answer, then explain.
- Always use tools to look up data before answering questions. Never fabricate numbers.
- When you need multiple independent pieces of data to answer a question, request all the relevant tools in a single response rather than one at a time. Tools execute in parallel, so batching saves a round-trip.
- Format currencies correctly: ₪ for ILS, $ for USD. Never mix currencies in a single amount.
- TASE securities use Hebrew names — include them as-is when referencing TASE stocks.
- For any trade recommendations or suggestions: always add "⚠ This is not financial advice."
- When presenting tables or lists, use markdown formatting.
- If a tool returns an error, acknowledge it and suggest alternatives.
- Keep responses concise but thorough. Use bullet points and tables for clarity.`;

export interface SystemPromptParts {
  static: string;
  dynamic: string;
}

export async function buildSystemPrompt(userId: string): Promise<SystemPromptParts> {
  const [user, summary, positions, syncStatus] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        displayName: true,
        email: true,
        investorHorizon: true,
        investorGoal: true,
        investorNotes: true,
      },
    }),
    getPortfolioSummary(userId).catch(() => null),
    getOpenPositions(userId).catch(() => []),
    getSyncStatus(userId).catch(() => null),
  ]);

  const userName = user?.displayName || user?.email?.split('@')[0] || 'the user';

  const positionCount = positions.length;
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

  const horizonLabel = user?.investorHorizon ? HORIZON_LABELS[user.investorHorizon] : null;
  const goalLabel = user?.investorGoal ? GOAL_LABELS[user.investorGoal] : null;
  const inferred = inferredHorizonLabel(summary?.avgHoldingDays);
  const hasDeclaredProfile = Boolean(horizonLabel || goalLabel || user?.investorNotes?.trim());

  let investorProfile = '';
  if (hasDeclaredProfile || inferred) {
    const lines: string[] = [];
    if (horizonLabel) lines.push(`- Declared horizon: ${horizonLabel}`);
    if (goalLabel) lines.push(`- Declared goal: ${goalLabel}`);
    if (user?.investorNotes?.trim()) lines.push(`- Notes from ${userName}: "${user.investorNotes.trim()}"`);
    if (inferred) lines.push(`- Inferred horizon from trade history: ${inferred} (avg holding ${summary!.avgHoldingDays.toFixed(0)} days)`);
    investorProfile = `INVESTOR PROFILE:\n${lines.join('\n')}`;
  }

  const profileGuideline = hasDeclaredProfile
    ? `Tailor framing to ${userName}'s declared horizon and goal. A long-term investor asking about a red day wants thesis context, not stop-loss talk. A day trader wants risk/reward, not 10-year CAGR. If their declared horizon and their inferred horizon diverge meaningfully, you may gently note it when relevant — don't lecture.`
    : `No investor profile is set for ${userName}. Default to a neutral long-term framing — avoid day-trading language (stops, scalps, intraday momentum) unless ${userName} explicitly brings it up.`;

  const dynamic = `You are assisting ${userName}.

Today: ${now}

${portfolioContext}

${investorProfile ? investorProfile + '\n\n' : ''}${syncContext}

CONTEXT-SPECIFIC GUIDELINE:
- ${profileGuideline}`;

  return { static: STATIC_SYSTEM_PROMPT, dynamic };
}
