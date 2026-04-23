/**
 * One-shot migration: retag US trades whose ticker reflects a legacy name
 * instead of IBI's current `symbol` column.
 *
 * Background: when a US ticker is renamed (e.g. FIVG→SIXG, FB→META,
 * KLTO→GRML, HUSA→AGIG), IBI updates the historical rows' `symbol` column
 * to the new ticker but leaves the `securityName` ("FIVG US", "FACEBOOK(FB)")
 * untouched. The old parser extracted the ticker from `securityName`, so
 * legacy BUY rows ended up under the old ticker while new SELL rows used
 * the new one. FIFO matching is keyed on `ticker` → the old ticker shows
 * as an open ghost position and the new ticker has orphan sells.
 *
 * This script re-parses each xlsx_import trade's rawPayload using the
 * fixed parser and updates the ticker where it now differs. Idempotent.
 *
 * Run: pnpm --filter @takumi/api exec tsx ../../scripts/fix-renamed-tickers.ts
 */

import { prisma } from "@takumi/db";
import { parseSecurity } from "../apps/api/src/services/xlsx-import.service.js";

async function main() {
  const trades = await prisma.trade.findMany({
    where: { source: "xlsx_import" },
    select: {
      id: true,
      userId: true,
      ticker: true,
      securityName: true,
      market: true,
      direction: true,
      rawPayload: true,
      tradeDate: true,
    },
  });

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const t of trades) {
    if (!t.rawPayload) {
      skipped++;
      continue;
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(t.rawPayload);
    } catch {
      skipped++;
      continue;
    }

    const securityName = String(raw.securityName || "");
    const symbol = (raw.symbol as string | number | undefined) ?? "";
    const hebrewType = String(raw.type || "");
    const parsed = parseSecurity(securityName, symbol, hebrewType);

    if (parsed.ticker === t.ticker) {
      unchanged++;
      continue;
    }

    await prisma.trade.update({
      where: { id: t.id },
      data: { ticker: parsed.ticker },
    });
    updated++;
    console.log(
      `[fix] user=${t.userId} ${t.tradeDate.toISOString().slice(0, 10)} ${t.direction}` +
        ` "${securityName}" sym=${String(symbol)} : ${t.ticker} → ${parsed.ticker}`,
    );
  }

  console.log(`\nTotal xlsx_import trades: ${trades.length}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Skipped:   ${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
