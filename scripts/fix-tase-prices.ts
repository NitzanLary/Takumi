/**
 * One-shot migration: divide existing TASE trade prices by 100.
 *
 * Background: IBI's XLSX export quotes שער ביצוע in agorot (1/100 ILS) for
 * Israeli securities. Earlier imports stored the raw value as the per-share
 * price, leaving TASE cost basis 100× too high. The parser now divides at
 * import time; this script corrects rows that were imported before the fix.
 *
 * Idempotent: detects already-migrated rows by comparing `price` against the
 * original `price` value preserved in `rawPayload`.
 *
 * Run: pnpm --filter @takumi/api exec tsx ../../scripts/fix-tase-prices.ts
 */

import { prisma } from "@takumi/db";

async function main() {
  const trades = await prisma.trade.findMany({
    where: { market: "TASE" },
    select: { id: true, ticker: true, price: true, rawPayload: true, tradeDate: true },
  });

  let fixed = 0;
  let alreadyDone = 0;
  let noRawPayload = 0;
  let mismatched = 0;

  for (const t of trades) {
    if (!t.rawPayload) {
      noRawPayload++;
      continue;
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(t.rawPayload);
    } catch {
      noRawPayload++;
      continue;
    }

    const rawPrice = raw.price != null ? Number(raw.price) : NaN;
    if (!Number.isFinite(rawPrice)) {
      noRawPayload++;
      continue;
    }

    const currentPrice = Number(t.price);
    const matchesRaw = Math.abs(currentPrice - rawPrice) < 1e-6;
    const matchesFixed = Math.abs(currentPrice - rawPrice / 100) < 1e-6;

    if (matchesFixed) {
      alreadyDone++;
      continue;
    }
    if (!matchesRaw) {
      mismatched++;
      console.warn(
        `[skip] ${t.ticker} ${t.tradeDate.toISOString().slice(0, 10)}: db=${currentPrice} raw=${rawPrice} (neither match)`,
      );
      continue;
    }

    await prisma.trade.update({
      where: { id: t.id },
      data: { price: rawPrice / 100 },
    });
    fixed++;
  }

  console.log(`Total TASE trades: ${trades.length}`);
  console.log(`  Fixed:           ${fixed}`);
  console.log(`  Already fixed:   ${alreadyDone}`);
  console.log(`  No rawPayload:   ${noRawPayload}`);
  console.log(`  Unrecognized:    ${mismatched}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
