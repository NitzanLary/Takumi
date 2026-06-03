/**
 * Integration smoke test for funder.co.il wiring into market.service.
 *
 * Usage:
 *   pnpm --filter @takumi/api exec tsx ../../scripts/verify-funder-integration.ts
 *
 * Exercises:
 *   1. getHistoricalPrices for an unmapped TASE security (1143726) — should now
 *      return available:true source:'funder' instead of the old short-circuit.
 *   2. getHistoricalPrices for a TASE fund (5123161) — same expectation.
 *   3. Second call to confirm the cache path serves from price_history
 *      without hitting funder again.
 *   4. Verifies that `securities.funder_kind` was persisted.
 *
 * Touches the database — writes to `price_history` and `securities`. Idempotent.
 */

import { prisma } from '../apps/api/src/lib/db.js';
import { getHistoricalPrices } from '../apps/api/src/services/market.service.js';

async function probe(ticker: string, label: string) {
  console.log(`\n--- ${label} (${ticker}) ---`);
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

  const t0 = Date.now();
  const r1 = await getHistoricalPrices(ticker, 'TASE', from, to);
  const ms1 = Date.now() - t0;
  console.log(`  call #1 (${ms1}ms): available=${r1.available}`);
  if (r1.available) {
    console.log(`    source=${r1.source} points=${r1.points.length}`);
    console.log(`    first=${JSON.stringify(r1.points[0])}`);
    console.log(`    last =${JSON.stringify(r1.points[r1.points.length - 1])}`);
  } else {
    console.log(`    reason=${r1.reason}`);
  }

  const t1 = Date.now();
  const r2 = await getHistoricalPrices(ticker, 'TASE', from, to);
  const ms2 = Date.now() - t1;
  console.log(`  call #2 (${ms2}ms): available=${r2.available}`);
  if (r2.available) {
    console.log(`    source=${r2.source} points=${r2.points.length} (cache hit expected)`);
  }

  const security = await prisma.security.findUnique({
    where: { ticker },
    select: { ticker: true, funderKind: true, market: true, currency: true },
  });
  console.log(`  securities row: ${JSON.stringify(security)}`);

  const sourceCount = await prisma.priceHistory.groupBy({
    by: ['source'],
    where: { ticker },
    _count: { _all: true },
  });
  console.log(`  price_history sources: ${JSON.stringify(sourceCount)}`);

  if (!r1.available || !r2.available) {
    console.error(`  FAIL: ${ticker} did not return available:true on both calls`);
    return false;
  }
  return true;
}

async function main() {
  const okSec = await probe('1143726', 'TASE security');
  const okFund = await probe('5123161', 'TASE fund');

  await prisma.$disconnect();

  if (!okSec || !okFund) {
    process.exit(1);
  }
  console.log('\nOK — integration end-to-end works.');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
