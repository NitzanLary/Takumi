import { prisma } from "../lib/db.js";
import type { TradeFilters } from "@takumi/types";
import { CORE_DIRECTIONS } from "@takumi/types";

export async function getTrades(filters: TradeFilters) {
  const {
    ticker,
    market,
    direction,
    dateFrom,
    dateTo,
    source,
    page = 1,
    limit = 50,
    includeNonTrades = false,
  } = filters;

  const where: Record<string, unknown> = {};
  if (ticker) where.ticker = { contains: ticker };
  if (market) where.market = market;
  if (direction) {
    where.direction = direction;
  } else if (!includeNonTrades) {
    where.direction = { in: CORE_DIRECTIONS };
  }
  if (source) where.source = source;
  if (dateFrom || dateTo) {
    where.tradeDate = {
      ...(dateFrom && { gte: new Date(dateFrom) }),
      ...(dateTo && { lte: new Date(dateTo) }),
    };
  }

  const [data, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      orderBy: { tradeDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.trade.count({ where }),
  ]);

  return {
    data: data.map(serializeTrade),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getTradeByTicker(ticker: string) {
  const trades = await prisma.trade.findMany({
    where: { ticker },
    orderBy: { tradeDate: "asc" },
  });
  return trades.map(serializeTrade);
}

function serializeTrade(trade: Record<string, unknown>) {
  return {
    ...trade,
    quantity: Number(trade.quantity),
    price: Number(trade.price),
    commission: Number(trade.commission),
    proceedsFx: trade.proceedsFx != null ? Number(trade.proceedsFx) : null,
    proceedsIls: trade.proceedsIls != null ? Number(trade.proceedsIls) : null,
    capitalGainsTax: trade.capitalGainsTax != null ? Number(trade.capitalGainsTax) : null,
  };
}
