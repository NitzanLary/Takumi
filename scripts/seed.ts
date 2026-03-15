/**
 * Seed script — populates the database with sample trade data for development.
 * Run: npx tsx scripts/seed.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const sampleTrades = [
  {
    tradeId: "SEED-001",
    ticker: "AAPL",
    securityName: "Apple Inc.",
    market: "NASDAQ",
    direction: "BUY",
    quantity: 50,
    price: 175.5,
    currency: "USD",
    commission: 4.99,
    tradeDate: new Date("2024-01-15T10:30:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-002",
    ticker: "AAPL",
    securityName: "Apple Inc.",
    market: "NASDAQ",
    direction: "SELL",
    quantity: 50,
    price: 192.3,
    currency: "USD",
    commission: 4.99,
    tradeDate: new Date("2024-04-20T14:00:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-003",
    ticker: "TEVA",
    securityName: "Teva Pharmaceutical",
    market: "NYSE",
    direction: "BUY",
    quantity: 200,
    price: 12.4,
    currency: "USD",
    commission: 4.99,
    tradeDate: new Date("2024-02-10T11:00:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-004",
    ticker: "TEVA",
    securityName: "Teva Pharmaceutical",
    market: "NYSE",
    direction: "SELL",
    quantity: 200,
    price: 15.8,
    currency: "USD",
    commission: 4.99,
    tradeDate: new Date("2024-06-15T13:30:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-005",
    ticker: "LUMI",
    securityName: "Bank Leumi",
    market: "TASE",
    direction: "BUY",
    quantity: 1000,
    price: 32.5,
    currency: "ILS",
    commission: 25.0,
    tradeDate: new Date("2024-03-05T09:30:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-006",
    ticker: "LUMI",
    securityName: "Bank Leumi",
    market: "TASE",
    direction: "SELL",
    quantity: 500,
    price: 35.2,
    currency: "ILS",
    commission: 15.0,
    tradeDate: new Date("2024-05-20T10:00:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-007",
    ticker: "NVDA",
    securityName: "NVIDIA Corp.",
    market: "NASDAQ",
    direction: "BUY",
    quantity: 30,
    price: 480.0,
    currency: "USD",
    commission: 4.99,
    tradeDate: new Date("2024-01-22T15:00:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-008",
    ticker: "NVDA",
    securityName: "NVIDIA Corp.",
    market: "NASDAQ",
    direction: "SELL",
    quantity: 30,
    price: 720.0,
    currency: "USD",
    commission: 4.99,
    tradeDate: new Date("2024-07-10T16:00:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-009",
    ticker: "POLI",
    securityName: "Bank Hapoalim",
    market: "TASE",
    direction: "BUY",
    quantity: 800,
    price: 28.9,
    currency: "ILS",
    commission: 20.0,
    tradeDate: new Date("2024-04-01T09:45:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-010",
    ticker: "POLI",
    securityName: "Bank Hapoalim",
    market: "TASE",
    direction: "SELL",
    quantity: 800,
    price: 27.1,
    currency: "ILS",
    commission: 20.0,
    tradeDate: new Date("2024-08-15T10:30:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-011",
    ticker: "NICE",
    securityName: "NICE Systems",
    market: "TASE",
    direction: "BUY",
    quantity: 150,
    price: 245.0,
    currency: "ILS",
    commission: 30.0,
    tradeDate: new Date("2024-06-01T11:15:00Z"),
    source: "csv_import",
  },
  {
    tradeId: "SEED-012",
    ticker: "MSFT",
    securityName: "Microsoft Corp.",
    market: "NASDAQ",
    direction: "BUY",
    quantity: 25,
    price: 390.0,
    currency: "USD",
    commission: 4.99,
    tradeDate: new Date("2024-05-10T14:30:00Z"),
    source: "csv_import",
  },
];

async function main() {
  console.log("Seeding database...");

  // Seed user preferences
  await prisma.userPreferences.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      currency: "ILS",
      costBasisMethod: "FIFO",
      syncIntervalMin: 15,
      syncIntervalOff: 120,
    },
  });

  // Seed trades
  for (const trade of sampleTrades) {
    await prisma.trade.upsert({
      where: {
        tradeId_source: { tradeId: trade.tradeId, source: trade.source },
      },
      update: {},
      create: trade,
    });
  }

  console.log(`Seeded ${sampleTrades.length} trades and default preferences.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
