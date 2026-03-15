import { prisma } from "../lib/db.js";
import type { TradeFilters } from "@takumi/types";

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
  } = filters;

  const where: Record<string, unknown> = {};
  if (ticker) where.ticker = { contains: ticker };
  if (market) where.market = market;
  if (direction) where.direction = direction;
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
  };
}
