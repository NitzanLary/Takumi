import { describe, expect, it } from 'vitest';
import { matchFifoLots, type FifoTrade } from './pnl-matching.js';

const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset));

function makeTrade(overrides: Partial<FifoTrade>): FifoTrade {
  return {
    ticker: 'AAPL',
    securityName: 'Apple Inc.',
    market: 'NASDAQ',
    direction: 'BUY',
    quantity: 1,
    price: 100,
    currency: 'USD',
    commission: 0,
    tradeDate: day(0),
    ...overrides,
  };
}

describe('matchFifoLots', () => {
  it('handles 5,000 round trips without shifting consumed FIFO lots', () => {
    const trades: FifoTrade[] = [];

    for (let i = 0; i < 5_000; i++) {
      trades.push(
        makeTrade({
          direction: 'BUY',
          quantity: 1,
          price: 100 + (i % 7),
          tradeDate: day(i),
        }),
        makeTrade({
          direction: 'SELL',
          quantity: 1,
          price: 110 + (i % 7),
          tradeDate: day(i + 1),
        }),
      );
    }

    const startedAt = performance.now();
    const result = matchFifoLots(trades);
    const durationMs = performance.now() - startedAt;

    expect(result.matchedLots).toHaveLength(5_000);
    expect(result.openLots).toHaveLength(0);
    expect(result.matchedLots.every((lot) => lot.realizedPnl === 10)).toBe(true);
    expect(durationMs).toBeLessThan(250);
  });

  it('applies splits only to active open lots', () => {
    const result = matchFifoLots([
      makeTrade({ direction: 'BUY', quantity: 10, price: 100, tradeDate: day(0) }),
      makeTrade({ direction: 'SELL', quantity: 10, price: 120, tradeDate: day(1) }),
      makeTrade({ direction: 'BUY', quantity: 10, price: 50, tradeDate: day(2) }),
      makeTrade({ direction: 'SPLIT', quantity: 10, price: 0, tradeDate: day(3) }),
    ]);

    expect(result.matchedLots).toHaveLength(1);
    expect(result.openLots).toEqual([
      expect.objectContaining({
        quantity: 20,
        price: 25,
      }),
    ]);
  });
});
