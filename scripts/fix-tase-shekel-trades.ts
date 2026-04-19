/**
 * One-shot migration: reclassify TASE shekel-denominated buys/sells and admin codes.
 *
 * Background: IBI uses the action types קניה שח / מכירה שח for three different
 * real-world events — FX conversions, TASE security buys paid in shekels (mutual
 * funds that don't use the continuous market), and tax-admin entries. The parser
 * previously mapped all of them to CONVERSION/CREDIT, leaving TASE fund buys
 * invisible from the positions/analytics layer.
 *
 * The parser was also missing 9993975 and 9993983 from the admin-code list, so
 * those rows ended up with market=TASE instead of market=ADMIN.
 *
 * This script re-parses each trade's rawPayload and updates direction/market/
 * market-dependent price scaling where the current row disagrees with the
 * fixed parser. Safe to re-run.
 *
 * Run: pnpm --filter @takumi/api exec tsx ../../scripts/fix-tase-shekel-trades.ts
 */

import { prisma } from "@takumi/db";
import {
  DIRECTION_MAP,
  parseSecurity,
  refineDirection,
} from "../apps/api/src/services/xlsx-import.service.js";

async function main() {
  const trades = await prisma.trade.findMany({
    where: { source: "xlsx_import" },
    select: {
      id: true,
      ticker: true,
      direction: true,
      market: true,
      securityName: true,
      price: true,
      rawPayload: true,
      tradeDate: true,
    },
  });

  let updated = 0;
  let unchanged = 0;
  let noRawPayload = 0;

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

    const hebrewType = String(raw.type || "").trim();
    const baseDirection = DIRECTION_MAP[hebrewType];
    if (!baseDirection) {
      unchanged++;
      continue;
    }

    const securityName = String(raw.securityName || "");
    const symbol = (raw.symbol as string | number | undefined) ?? "";
    const parsed = parseSecurity(securityName, symbol, hebrewType);
    const newDirection = refineDirection(baseDirection, securityName, parsed.market);
    const newMarket = parsed.market;

    const directionChanged = t.direction !== newDirection;
    const marketChanged = t.market !== newMarket;

    if (!directionChanged && !marketChanged) {
      unchanged++;
      continue;
    }

    // Price may need rescaling: existing rows had /100 applied when parser said
    // market=TASE. If we're moving a row TASE → ADMIN (misclassified admin codes)
    // the current stored price is 100× too small and must be multiplied back.
    // Conversely ADMIN → TASE would need /100. In practice the affected rows
    // (9993975/9993983) had price=1 in the source, so /100 left 0.01 in DB.
    const rawPriceNum = raw.price != null ? Number(raw.price) : NaN;
    let priceUpdate: number | undefined;
    if (marketChanged && Number.isFinite(rawPriceNum)) {
      const wantedPrice = newMarket === "TASE" ? rawPriceNum / 100 : rawPriceNum;
      if (Math.abs(Number(t.price) - wantedPrice) > 1e-6) {
        priceUpdate = wantedPrice;
      }
    }

    await prisma.trade.update({
      where: { id: t.id },
      data: {
        direction: newDirection,
        market: newMarket,
        ...(priceUpdate !== undefined ? { price: priceUpdate } : {}),
      },
    });
    updated++;

    console.log(
      `[fix] ${t.ticker} ${t.tradeDate.toISOString().slice(0, 10)} "${hebrewType}" :` +
        ` ${t.direction}/${t.market} → ${newDirection}/${newMarket}` +
        (priceUpdate !== undefined ? ` price ${Number(t.price)} → ${priceUpdate}` : ""),
    );
  }

  console.log(`\nTotal xlsx_import trades: ${trades.length}`);
  console.log(`  Updated:       ${updated}`);
  console.log(`  Unchanged:     ${unchanged}`);
  console.log(`  No rawPayload: ${noRawPayload}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
