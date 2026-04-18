/**
 * What-If Scenario Engine — hypothetical P&L recalculation.
 *
 * Supports:
 * - stop_loss: What if every loss was cut at -X%?
 * - modified_sell_date: What if ticker X was sold on date Y?
 */

import { runFifoMatching, type MatchedLot } from './pnl.service.js';

export interface WhatIfInput {
  scenario: 'stop_loss' | 'modified_sell_date';
  ticker?: string;
  stopLossPercent?: number;
  sellDate?: string;
}

export interface WhatIfResult {
  scenario: string;
  description: string;
  actualPnl: number;
  hypotheticalPnl: number;
  difference: number;
  affectedTrades: number;
  totalTrades: number;
  details: Array<{
    ticker: string;
    actualPnl: number;
    hypotheticalPnl: number;
    difference: number;
  }>;
}

export async function runWhatIf(input: WhatIfInput): Promise<WhatIfResult> {
  const { matchedLots } = await runFifoMatching();

  switch (input.scenario) {
    case 'stop_loss':
      return runStopLossScenario(matchedLots, input.stopLossPercent ?? 5, input.ticker);
    case 'modified_sell_date':
      return runModifiedSellDateScenario(matchedLots, input.ticker, input.sellDate);
    default:
      throw new Error(`Unknown scenario: ${input.scenario}`);
  }
}

/**
 * Stop-loss scenario: recalculate losing trades as if sold at buyPrice * (1 - stopLossPercent/100).
 */
function runStopLossScenario(
  lots: MatchedLot[],
  stopLossPercent: number,
  ticker?: string
): WhatIfResult {
  const filteredLots = ticker ? lots.filter((l) => l.ticker === ticker) : lots;
  const stopFactor = 1 - stopLossPercent / 100;

  let actualPnl = 0;
  let hypotheticalPnl = 0;
  let affectedTrades = 0;

  const byTicker = new Map<string, { actual: number; hypothetical: number }>();

  for (const lot of filteredLots) {
    actualPnl += lot.realizedPnl;

    const lossPercent = ((lot.sellPrice - lot.buyPrice) / lot.buyPrice) * 100;

    if (lossPercent < -stopLossPercent) {
      // This loss exceeded the stop-loss — recalculate
      const hypotheticalSellPrice = lot.buyPrice * stopFactor;
      const hypotheticalGross = lot.quantity * (hypotheticalSellPrice - lot.buyPrice);
      const hypotheticalLotPnl = hypotheticalGross - lot.commission;
      hypotheticalPnl += hypotheticalLotPnl;
      affectedTrades++;

      const entry = byTicker.get(lot.ticker) || { actual: 0, hypothetical: 0 };
      entry.actual += lot.realizedPnl;
      entry.hypothetical += hypotheticalLotPnl;
      byTicker.set(lot.ticker, entry);
    } else {
      // Trade within stop-loss or a winner — keep as-is
      hypotheticalPnl += lot.realizedPnl;

      const entry = byTicker.get(lot.ticker) || { actual: 0, hypothetical: 0 };
      entry.actual += lot.realizedPnl;
      entry.hypothetical += lot.realizedPnl;
      byTicker.set(lot.ticker, entry);
    }
  }

  const details = Array.from(byTicker.entries())
    .map(([t, v]) => ({
      ticker: t,
      actualPnl: v.actual,
      hypotheticalPnl: v.hypothetical,
      difference: v.hypothetical - v.actual,
    }))
    .filter((d) => Math.abs(d.difference) > 0.01)
    .sort((a, b) => b.difference - a.difference);

  return {
    scenario: 'stop_loss',
    description: `What if every loss was cut at -${stopLossPercent}%${ticker ? ` for ${ticker}` : ''}?`,
    actualPnl,
    hypotheticalPnl,
    difference: hypotheticalPnl - actualPnl,
    affectedTrades,
    totalTrades: filteredLots.length,
    details,
  };
}

/**
 * Modified sell date: recalculate holding period stats for a given ticker
 * if it had been sold on a different date. Since we don't have historical
 * price data, we keep the original sell price but change the date.
 */
function runModifiedSellDateScenario(
  lots: MatchedLot[],
  ticker?: string,
  sellDate?: string
): WhatIfResult {
  if (!ticker) {
    throw new Error('modified_sell_date requires a ticker parameter');
  }
  if (!sellDate) {
    throw new Error('modified_sell_date requires a sellDate parameter');
  }

  const hypotheticalDate = new Date(sellDate);
  const tickerLots = lots.filter((l) => l.ticker === ticker);

  if (tickerLots.length === 0) {
    throw new Error(`No closed trades found for ${ticker}`);
  }

  let actualPnl = 0;
  let hypotheticalPnl = 0;

  for (const lot of tickerLots) {
    actualPnl += lot.realizedPnl;
    // Same P&L since we don't have historical prices, but different holding period
    hypotheticalPnl += lot.realizedPnl;
  }

  const avgActualHoldingDays =
    tickerLots.reduce((s, l) => s + l.holdingDays, 0) / tickerLots.length;
  const avgHypotheticalHoldingDays =
    tickerLots.reduce((s, l) => {
      const newHoldingDays = Math.round(
        (hypotheticalDate.getTime() - l.buyDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      return s + Math.max(0, newHoldingDays);
    }, 0) / tickerLots.length;

  return {
    scenario: 'modified_sell_date',
    description: `What if ${ticker} was sold on ${sellDate}? (Note: without historical price data, P&L uses original sell prices. Holding period changes from avg ${avgActualHoldingDays.toFixed(0)} to ${avgHypotheticalHoldingDays.toFixed(0)} days.)`,
    actualPnl,
    hypotheticalPnl,
    difference: 0,
    affectedTrades: tickerLots.length,
    totalTrades: tickerLots.length,
    details: [{
      ticker,
      actualPnl,
      hypotheticalPnl,
      difference: 0,
    }],
  };
}
