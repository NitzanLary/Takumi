/**
 * Verification harness for simulate_alternative_investment.
 *
 * Drives the new service against the live DB across a matrix of scenarios
 * (scopes × modes × edge cases) and spot-checks the math by recomputing one
 * mirror_timing run from first principles.
 *
 * Run with:
 *   pnpm --filter @takumi/api exec tsx src/scripts/verify-alt-investment.ts
 */
import "../lib/config.js"; // MUST be first — loads .env before Prisma client construction
import { prisma } from "@takumi/db";
import { simulateAlternativeInvestment } from "../services/alt-investment.service.js";
import { getHistoricalPrices, getLatestPrices } from "../services/market.service.js";
import { getCurrentRate, getRate } from "../services/exchange-rate.service.js";

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function header(title: string) {
  console.log("\n" + "═".repeat(72));
  console.log(title);
  console.log("═".repeat(72));
}

const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
if (users.length === 0) {
  console.error("No users in DB");
  process.exit(1);
}
const user = users[0];
console.log(`Using user: ${user.email} (id=${user.id})`);

const buyCount = await prisma.trade.count({ where: { userId: user.id, direction: "BUY" } });
const taseBuys = await prisma.trade.count({ where: { userId: user.id, direction: "BUY", market: "TASE" } });
const usBuys = await prisma.trade.count({ where: { userId: user.id, direction: "BUY", market: { in: ["NYSE", "NASDAQ"] } } });
console.log(`BUYs in DB: total=${buyCount}, TASE=${taseBuys}, US=${usBuys}`);

// ─── Scenario 1: All scope, mirror_timing, AAPL ───────────────────────
header("Scenario 1 — AAPL, scope=all, mode=mirror_timing");
const r1 = await simulateAlternativeInvestment(user.id, {
  targetTicker: "AAPL",
  scope: "all",
  mode: "mirror_timing",
});
console.log(JSON.stringify(r1, null, 2));

// ─── Scenario 2: US scope, lump_sum, ^GSPC ────────────────────────────
header("Scenario 2 — ^GSPC, scope=us, mode=lump_sum");
const r2 = await simulateAlternativeInvestment(user.id, {
  targetTicker: "^GSPC",
  scope: "us",
  mode: "lump_sum",
});
console.log(JSON.stringify(r2, null, 2));

// ─── Scenario 3: TASE scope, mirror_timing, ^TA125 ────────────────────
header("Scenario 3 — ^TA125, scope=tase, mode=mirror_timing");
const r3 = await simulateAlternativeInvestment(user.id, {
  targetTicker: "^TA125",
  scope: "tase",
  mode: "mirror_timing",
});
console.log(JSON.stringify(r3, null, 2));

// ─── Scenario 4: Unmapped TASE target ─────────────────────────────────
header("Scenario 4 — unmapped TASE target (1143726)");
const r4 = await simulateAlternativeInvestment(user.id, {
  targetTicker: "1143726",
  scope: "all",
  mode: "mirror_timing",
});
console.log(JSON.stringify(r4, null, 2));

// ─── Scenario 5: scope=us but synthetic empty by using a bogus future-only filter? ──
// Skip — we can only test no_buy_trades_in_scope if the user has no trades in some scope.
// If usBuys = 0, run scope=us; if taseBuys = 0, run scope=tase. Otherwise note skip.
header("Scenario 5 — empty-scope test (conditional)");
if (usBuys === 0) {
  const r5 = await simulateAlternativeInvestment(user.id, {
    targetTicker: "AAPL",
    scope: "us",
    mode: "mirror_timing",
  });
  console.log("us-scope (no US trades):");
  console.log(JSON.stringify(r5, null, 2));
} else if (taseBuys === 0) {
  const r5 = await simulateAlternativeInvestment(user.id, {
    targetTicker: "^TA125",
    scope: "tase",
    mode: "mirror_timing",
  });
  console.log("tase-scope (no TASE trades):");
  console.log(JSON.stringify(r5, null, 2));
} else {
  console.log("(skipped — user has trades in both scopes)");
}

// ─── Math spot-check: re-derive AAPL mirror_timing from scratch ───────
header("Spot-check — recompute AAPL mirror_timing per-trade and compare to Scenario 1");
if ("error" in r1) {
  console.log("Scenario 1 returned an error — cannot spot-check.");
} else {
  const buys = await prisma.trade.findMany({
    where: { userId: user.id, direction: "BUY" },
    orderBy: { tradeDate: "asc" },
  });
  const firstBuyDate = buys[0].tradeDate;
  const today = new Date();
  // Mirror the service's 14-day padding so the spot-check is a true equivalence.
  const fetchFrom = new Date(firstBuyDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const history = await getHistoricalPrices("AAPL", "US", fetchFrom, today);
  if (!history.available) {
    console.log("AAPL history unavailable for spot-check.");
  } else {
    const priceByDate = new Map(history.points.map((p) => [p.date, p.close] as const));
    const sortedDates = Array.from(priceByDate.keys()).sort();
    const snap = (d: string): string | null => {
      if (priceByDate.has(d)) return d;
      const prior = sortedDates.filter((x) => x <= d);
      return prior.length ? prior[prior.length - 1] : null;
    };
    const fxCache = new Map<string, number>();
    const fxFor = async (d: Date) => {
      const k = d.toISOString().slice(0, 10);
      const c = fxCache.get(k);
      if (c !== undefined) return c;
      const r = await getRate(d).catch(() => null);
      const v = r ?? (await getCurrentRate());
      fxCache.set(k, v);
      return v;
    };

    let capitalIls = 0;
    let shares = 0;
    let priced = 0;
    let missing = 0;
    const perTradeRows: Array<{ date: string; capitalIls: number; aaplPrice: number; sharesAdded: number }> = [];

    for (const t of buys) {
      const dayStr = t.tradeDate.toISOString().slice(0, 10);
      const snapped = snap(dayStr);
      if (!snapped) {
        missing += 1;
        continue;
      }
      const aaplPx = priceByDate.get(snapped)!;
      const proceeds = t.proceedsIls != null ? Math.abs(Number(t.proceedsIls)) : 0;
      const cap = proceeds > 0
        ? proceeds
        : t.market === "TASE"
          ? Number(t.quantity) * Number(t.price)
          : Number(t.quantity) * Number(t.price) * (await fxFor(t.tradeDate));
      if (cap <= 0) continue;
      const fx = await fxFor(t.tradeDate);
      const capUsd = cap / fx;
      const shr = capUsd / aaplPx;
      capitalIls += cap;
      shares += shr;
      priced += 1;
      if (perTradeRows.length < 3) {
        perTradeRows.push({ date: dayStr, capitalIls: cap, aaplPrice: aaplPx, sharesAdded: shr });
      }
    }
    const quotes = await getLatestPrices([{ ticker: "AAPL", market: "US", currency: "USD" }]);
    const currentAapl = quotes.get("AAPL")!.price;
    const currentFx = await getCurrentRate();
    const valueIls = shares * currentAapl * currentFx;

    console.log("First 3 simulated BUYs:");
    for (const row of perTradeRows) {
      console.log(`  ${row.date}  capitalIls=${fmt(row.capitalIls)}  AAPL=$${fmt(row.aaplPrice)}  +${row.sharesAdded.toFixed(6)} sh`);
    }
    console.log("");
    console.log(`Independent recomputation:`);
    console.log(`  tradesSimulated   = ${priced}    missing=${missing}`);
    console.log(`  totalCapitalIls   = ${fmt(capitalIls)}`);
    console.log(`  totalShares       = ${shares.toFixed(6)}`);
    console.log(`  currentAapl       = $${fmt(currentAapl)}`);
    console.log(`  currentFx         = ${fmt(currentFx)}`);
    console.log(`  valueIls          = ${fmt(valueIls)}`);
    console.log("");
    console.log(`Service returned:`);
    console.log(`  tradesSimulated   = ${r1.tradesSimulated}    missing=${r1.missingPriceDates.length}`);
    console.log(`  totalCapitalIls   = ${fmt(r1.totalCapitalDeployedIls)}`);
    console.log(`  totalShares       = ${r1.hypotheticalShares.toFixed(6)}`);
    console.log(`  valueIls          = ${fmt(r1.hypotheticalValueIls)}`);
    console.log("");
    const capDelta = Math.abs(capitalIls - r1.totalCapitalDeployedIls);
    const sharesDelta = Math.abs(shares - r1.hypotheticalShares);
    const valueDelta = Math.abs(valueIls - r1.hypotheticalValueIls);
    console.log(`Diffs (should be ~0):  capital=${fmt(capDelta)}  shares=${sharesDelta.toFixed(6)}  value=${fmt(valueDelta)}`);
    const ok =
      capDelta < 0.5 &&
      sharesDelta < 1e-4 &&
      valueDelta < 1.0 &&
      priced === r1.tradesSimulated;
    console.log(ok ? "✅ Spot-check PASSED" : "❌ Spot-check FAILED");
  }
}

await prisma.$disconnect();
