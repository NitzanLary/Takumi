/**
 * Pure FIFO lot-matching engine.
 *
 * Kept separate from the Prisma-backed service so scale regressions can be
 * tested with synthetic trade sets without a database.
 */

export interface MatchedLot {
  ticker: string;
  securityName: string;
  market: string;
  currency: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  buyDate: Date;
  sellDate: Date;
  commission: number; // combined buy + sell commission (prorated)
  realizedPnl: number;
  holdingDays: number;
}

export interface OpenLot {
  ticker: string;
  securityName: string;
  market: string;
  currency: string;
  quantity: number;
  price: number;
  date: Date;
  commission: number;
}

export interface FifoTrade {
  ticker: string;
  securityName: string;
  market: string;
  direction: string;
  quantity: unknown;
  price: unknown;
  currency: string;
  commission: unknown;
  proceedsFx?: unknown;
  proceedsIls?: unknown;
  tradeDate: Date;
}

interface BuyLot {
  ticker: string;
  securityName: string;
  market: string;
  currency: string;
  remainingQty: number;
  price: number;
  date: Date;
  commissionPerShare: number;
}

function toNum(d: unknown): number {
  return Number(d);
}

export function matchFifoLots(trades: FifoTrade[]): {
  matchedLots: MatchedLot[];
  openLots: OpenLot[];
} {
  // Group by ticker
  const byTicker = new Map<string, FifoTrade[]>();
  for (const t of trades) {
    const existing = byTicker.get(t.ticker) || [];
    existing.push(t);
    byTicker.set(t.ticker, existing);
  }

  const matchedLots: MatchedLot[] = [];
  const openLots: OpenLot[] = [];

  for (const tickerTrades of byTicker.values()) {
    const buyQueue: BuyLot[] = [];
    let buyHead = 0;

    for (const trade of tickerTrades) {
      const qty = toNum(trade.quantity);
      const price = toNum(trade.price);
      const commission = toNum(trade.commission);

      if (trade.direction === 'BUY') {
        buyQueue.push({
          ticker: trade.ticker,
          securityName: trade.securityName,
          market: trade.market,
          currency: trade.currency,
          remainingQty: qty,
          price,
          date: trade.tradeDate,
          commissionPerShare: qty > 0 ? commission / qty : 0,
        });
      } else if (trade.direction === 'SPLIT') {
        // IBI records bonus/split rows as bonus shares added in quantity.
        // Distribute bonus across the currently-open lots, preserving total
        // cost basis: multiply remainingQty by ratio, divide price & commission/share.
        let openQty = 0;
        for (let i = buyHead; i < buyQueue.length; i++) {
          openQty += buyQueue[i].remainingQty;
        }
        if (openQty > 0 && qty !== 0) {
          const ratio = (openQty + qty) / openQty;
          for (let i = buyHead; i < buyQueue.length; i++) {
            const lot = buyQueue[i];
            lot.remainingQty *= ratio;
            lot.price /= ratio;
            lot.commissionPerShare /= ratio;
          }
        }
      } else {
        // SELL — match against oldest buy lots (FIFO)
        // MAKAM / bond final-redemption rows can have execution price = 0
        // because there is no per-share sell price on redemption; the cash is
        // reported in proceeds. Fall back to proceeds / qty
        // so FIFO doesn't treat the exit as $0 and manufacture a loss equal to
        // the cost basis.
        let effectiveSellPrice = price;
        if (effectiveSellPrice === 0 && qty > 0) {
          const proceeds =
            trade.currency === 'USD'
              ? Math.abs(toNum(trade.proceedsFx ?? 0))
              : Math.abs(toNum(trade.proceedsIls ?? 0));
          if (proceeds > 0) effectiveSellPrice = proceeds / qty;
        }

        let remainingToSell = qty;
        const sellCommPerShare = qty > 0 ? commission / qty : 0;

        while (remainingToSell > 0 && buyHead < buyQueue.length) {
          const lot = buyQueue[buyHead];
          const matchQty = Math.min(remainingToSell, lot.remainingQty);

          const buyCommission = matchQty * lot.commissionPerShare;
          const sellCommission = matchQty * sellCommPerShare;
          const totalCommission = buyCommission + sellCommission;

          const grossPnl = matchQty * (effectiveSellPrice - lot.price);
          const realizedPnl = grossPnl - totalCommission;

          const holdingDays = Math.round(
            (trade.tradeDate.getTime() - lot.date.getTime()) / (1000 * 60 * 60 * 24)
          );

          matchedLots.push({
            ticker: trade.ticker,
            securityName: trade.securityName,
            market: trade.market,
            currency: trade.currency,
            quantity: matchQty,
            buyPrice: lot.price,
            sellPrice: effectiveSellPrice,
            buyDate: lot.date,
            sellDate: trade.tradeDate,
            commission: totalCommission,
            realizedPnl,
            holdingDays,
          });

          lot.remainingQty -= matchQty;
          remainingToSell -= matchQty;

          if (lot.remainingQty <= 0) {
            buyHead++;
          }
        }
      }
    }

    // Remaining buy lots are open positions. Start from buyHead instead of
    // shifting consumed lots out of the queue; shifting reindexes the array on
    // every closed lot and gets expensive as users approach thousands of trades.
    for (let i = buyHead; i < buyQueue.length; i++) {
      const lot = buyQueue[i];
      if (lot.remainingQty > 0) {
        openLots.push({
          ticker: lot.ticker,
          securityName: lot.securityName,
          market: lot.market,
          currency: lot.currency,
          quantity: lot.remainingQty,
          price: lot.price,
          date: lot.date,
          commission: lot.remainingQty * lot.commissionPerShare,
        });
      }
    }
  }

  return { matchedLots, openLots };
}
