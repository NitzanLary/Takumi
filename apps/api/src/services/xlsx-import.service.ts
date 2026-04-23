import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { prisma } from "../lib/db.js";
import type { Direction, Market, Currency } from "@takumi/types";

// ─── Hebrew column name mapping ───────────────────────────────────────────

const COLUMN_MAP: Record<string, string> = {
  "תאריך": "date",
  "סוג פעולה": "type",
  "שם נייר": "securityName",
  "מס' נייר / סימבול": "symbol",
  "כמות": "quantity",
  "שער ביצוע": "price",
  "מטבע": "currency",
  "עמלת פעולה": "commission",
  "עמלות נלוות": "associatedFees",
  "תמורה במט\"ח": "proceedsFx",
  "תמורה בשקלים": "proceedsIls",
  "יתרה שקלית": "balanceIls",
  "אומדן מס רווחי הון": "capitalGainsTax",
};

// ─── Transaction type → Direction mapping ─────────────────────────────────

export const DIRECTION_MAP: Record<string, Direction> = {
  "קניה חול מטח": "BUY",
  "קניה רצף": "BUY",
  "מכירה חול מטח": "SELL",
  "מכירה רצף": "SELL",
  "מכירה הצעת רכש": "SELL",       // Tender-offer sale (proceeds + capital gains tax like a regular sell)
  "פדיון סופי": "SELL",            // MAKAM/bond final redemption — treated as sale for P&L
  "הפקדה דיבידנד מטח": "DIVIDEND",
  "דיבידנד בעין": "BONUS",         // Dividend in kind / stock distribution (shares received, no cash)
  "הפחתת הון": "SPLIT",            // Capital reduction (share-count adjustment, often negative qty)
  "משיכת מס חול מטח": "TAX",
  "משיכת מס מטח": "TAX",
  "קניה מס (( ניעז)": "TAX",       // Tax withholding paired with in-kind dividend (IBI's literal label, double "((" intentional)
  "קניה שח": "CONVERSION",
  "מכירה שח": "CREDIT",
  "הפקדה המרה": "CONVERSION",      // Ticker conversion / corporate action deposit side
  "משיכה המרה": "CONVERSION",      // Ticker conversion / corporate action withdrawal side
  "העברה מזומן בשח": "TRANSFER",
  "הפקדה": "DEPOSIT",
  "משיכה": "WITHDRAWAL",
  "הטבה": "SPLIT",
  "דמי טפול מזומן בשח": "FEE",
  "משיכת עמלה מטח": "FEE",         // FX-denominated commission charge
  "שונות מזומן בשח": "TRANSFER",
  "ריבית מזומן בשח": "INTEREST",   // Interest accrued on cash balance
};

// ─── Security name parsing ────────────────────────────────────────────────

export interface ParsedSecurity {
  ticker: string;
  securityName: string;
  market: Market | "FX" | "ADMIN";
}

/**
 * Extract the real ticker from the שם נייר field.
 * Patterns:
 *   "דיב/ TQQQ US"       → TQQQ (dividend)
 *   "מסח/ TQQQ US"       → TQQQ (dividend tax)
 *   "מס/ ASML US"        → ASML (non-dividend tax)
 *   "PROSHARES(TQQQ)"    → TQQQ (trade)
 *   "DIREXION(SPXL)"     → SPXL (trade)
 *   "DEFIANCE (QTUM)"    → QTUM (trade)
 *   "RGTI US"            → RGTI (trade, simple format)
 *   "B USD/ILS 3.631"    → USD/ILS (FX conversion)
 *   "תכ.בנקיםישרא"       → use symbol column (TASE)
 *   Admin names           → use symbol column
 *
 * Ticker renames: IBI updates the `symbol` column to the current trading
 * ticker on rename (e.g. FIVG→SIXG, FB→META, KLTO→GRML) but leaves the
 * historical `securityName` untouched. For US trades we therefore prefer
 * the `symbol` column whenever it looks like a valid US ticker — otherwise
 * the old and new rows key to different tickers and FIFO matching breaks,
 * leaving a ghost open position of the legacy ticker. When the symbol is
 * numeric (IBI's internal id for a delisted US security) we keep the
 * name-derived ticker.
 */
const US_TICKER_RE = /^[A-Z][A-Z0-9.-]{0,5}$/;

export function parseSecurity(
  securityName: string,
  symbol: string | number,
  hebrewType: string,
): ParsedSecurity {
  const name = securityName.trim();
  const sym = String(symbol).trim();
  const symIsUsTicker = US_TICKER_RE.test(sym);

  // Dividend: "דיב/ TQQQ US"
  const divMatch = name.match(/^דיב\/\s*(\w+)\s+US$/);
  if (divMatch) {
    return { ticker: divMatch[1], securityName: name, market: "NYSE" };
  }

  // Dividend tax: "מסח/ TQQQ US"
  const divTaxMatch = name.match(/^מסח\/\s*(\w+)\s+US$/);
  if (divTaxMatch) {
    return { ticker: divTaxMatch[1], securityName: name, market: "NYSE" };
  }

  // Non-dividend tax: "מס/ ASML US"
  const taxMatch = name.match(/^מס\/\s*(\w+)\s+US$/);
  if (taxMatch) {
    return { ticker: taxMatch[1], securityName: name, market: "NYSE" };
  }

  // FX conversion: "B USD/ILS 3.631"
  if (name.startsWith("B USD/ILS")) {
    return { ticker: "USD/ILS", securityName: name, market: "FX" };
  }

  // Company(TICKER) format: "PROSHARES(TQQQ)", "DIREXION(SPXL)", "DEFIANCE (QTUM)"
  const parenMatch = name.match(/\((\w+)\)/);
  if (parenMatch) {
    return {
      ticker: symIsUsTicker ? sym : parenMatch[1],
      securityName: name,
      market: "NYSE",
    };
  }

  // Simple "TICKER US" format: "RGTI US", "IONQ US"
  const simpleUsMatch = name.match(/^(\w+)\s+US$/);
  if (simpleUsMatch) {
    return {
      ticker: symIsUsTicker ? sym : simpleUsMatch[1],
      securityName: name,
      market: "NYSE",
    };
  }

  // Admin/cash operations — IBI uses 900 and the 999xxxx range for tax/admin pseudo-tickers.
  if (sym === "900" || /^9{3}\d{4}$/.test(sym)) {
    return { ticker: sym, securityName: name, market: "ADMIN" };
  }

  // TASE securities — symbol is a numeric paper number
  if (/^\d+$/.test(sym)) {
    return { ticker: sym, securityName: name, market: "TASE" };
  }

  // US ticker directly as symbol (for core trades like "TQQQ", "SPXL")
  if (/^[A-Z]{1,5}$/.test(sym)) {
    return { ticker: sym, securityName: name, market: "NYSE" };
  }

  // Fallback
  return { ticker: sym || "UNKNOWN", securityName: name, market: "ADMIN" };
}

// ─── Date parsing ─────────────────────────────────────────────────────────

/** Parse DD/MM/YYYY → Date */
function parseDate(dateStr: string): Date {
  const parts = dateStr.trim().split("/");
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00.000Z`);
  }
  // Try as-is if not DD/MM/YYYY
  return new Date(dateStr);
}

// ─── Currency parsing ─────────────────────────────────────────────────────

function parseCurrency(raw: string): Currency {
  const trimmed = raw.trim();
  if (trimmed.includes("$")) return "USD";
  if (trimmed.includes("₪")) return "ILS";
  return "ILS";
}

// ─── Deterministic trade ID ───────────────────────────────────────────────

function generateTradeId(row: Record<string, unknown>): string {
  const key = [
    row.date,
    row.type,
    row.symbol,
    row.securityName,
    row.quantity,
    row.price,
    row.proceedsFx,
    row.proceedsIls,
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

// ─── Special cases for קניה שח / מכירה שח ───────────────────────────────
//
// IBI uses these two action types for three different real-world events:
//   1. FX conversion (buying/selling USD with shekels) — security looks like "B USD/ILS 3.7"
//   2. TASE security buy/sell paid in shekels — typically Israeli mutual funds (קרנות נאמנות)
//      that don't trade on the continuous market and so don't use קניה רצף / מכירה רצף
//   3. Tax-related admin entries — security name contains "מס ששולם" or symbol is an admin code
//
// We default-map them to CONVERSION/CREDIT (the FX case), then refine based on the
// parsed market: TASE → real BUY/SELL, ADMIN → tax/admin (handled via market check).

export function refineDirection(
  direction: Direction,
  securityName: string,
  market: Market | "FX" | "ADMIN",
): Direction {
  if (direction === "CONVERSION" && securityName.includes("מס ששולם")) {
    return "TAX";
  }
  if (direction === "CONVERSION" && market === "TASE") {
    return "BUY";
  }
  if (direction === "CREDIT" && market === "TASE") {
    return "SELL";
  }
  return direction;
}

// ─── Main import function ─────────────────────────────────────────────────

interface ImportResult {
  status: "success" | "partial" | "failed";
  totalRows: number;
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Find the header row in the sheet. IBI exports sometimes have title/subtitle
 * rows above the actual column headers. We scan for a row that contains the
 * key header "סוג פעולה".
 */
function findHeaderRow(sheet: XLSX.WorkSheet): number {
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const row = allRows[i];
    if (Array.isArray(row)) {
      const hasTypeCol = row.some(
        (cell) => typeof cell === "string" && cell.trim().includes("סוג פעולה"),
      );
      if (hasTypeCol) return i;
    }
  }
  return 0; // fallback to first row
}

/**
 * Normalize a header string: trim, collapse multiple spaces, remove invisible
 * Unicode characters (BOM, ZWNJ, etc.) so that slight formatting differences
 * in different IBI export versions still match our COLUMN_MAP.
 */
function normalizeHeader(h: string): string {
  return h
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ") // invisible chars → space
    .replace(/\s+/g, " ")                            // collapse whitespace
    .trim();
}

export async function importXlsx(userId: string, buffer: Buffer, fileName?: string): Promise<ImportResult> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Auto-detect header row (handles files with title rows above headers)
  const headerRowIdx = findHeaderRow(sheet);

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    range: headerRowIdx,
  });

  if (rawRows.length === 0) {
    return { status: "failed", totalRows: 0, imported: 0, skipped: 0, errors: ["Empty spreadsheet"] };
  }

  // Build a normalized lookup from the COLUMN_MAP
  const normalizedColumnMap = new Map<string, string>();
  for (const [hebrewKey, internalKey] of Object.entries(COLUMN_MAP)) {
    normalizedColumnMap.set(normalizeHeader(hebrewKey), internalKey);
  }

  // Map Hebrew headers to internal names (with normalization)
  const rows = rawRows.map((raw) => {
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const normalized = normalizeHeader(key);
      const internalKey = normalizedColumnMap.get(normalized);
      if (internalKey) {
        mapped[internalKey] = value;
      }
    }
    return mapped;
  });

  // Validate that we actually mapped the critical columns
  const firstRow = rows[0];
  if (!firstRow.type && !firstRow.date) {
    const actualHeaders = Object.keys(rawRows[0]);
    const isHoldingsFile = actualHeaders.some(
      (h) => h.includes("כמות נוכחית") || h.includes("שווי נוכחי") || h.includes("רווח/הפסד"),
    );
    const hint = isHoldingsFile
      ? "This looks like a holdings/portfolio file, not a transactions file. Please export the transactions report (תנועות בחשבון) from IBI."
      : `Unrecognized column headers. Expected transaction columns (תאריך, סוג פעולה, שם נייר, ...). Found: ${actualHeaders.map(h => `"${h}"`).join(", ")}`;
    return {
      status: "failed",
      totalRows: rawRows.length,
      imported: 0,
      skipped: rawRows.length,
      errors: [hint],
    };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Transform every row into either a skip (unknown type) or a ready-to-upsert payload.
  type Prepared = {
    rowIndex: number;
    tradeId: string;
    data: {
      userId: string;
      tradeId: string;
      ticker: string;
      securityName: string;
      market: Market | "FX" | "ADMIN";
      direction: Direction;
      quantity: number;
      price: number;
      currency: Currency;
      commission: number;
      proceedsFx: number | null;
      proceedsIls: number | null;
      capitalGainsTax: number | null;
      tradeDate: Date;
      source: "xlsx_import";
      rawPayload: string;
    };
  };

  const prepared: Prepared[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const hebrewType = String(row.type || "");
    let direction = DIRECTION_MAP[hebrewType.trim()];
    if (!direction) {
      errors.push(`Row ${i + 2}: Unknown transaction type "${hebrewType}"`);
      skipped++;
      continue;
    }

    const securityName = String(row.securityName || "");
    const parsed = parseSecurity(securityName, row.symbol as string | number, hebrewType);
    direction = refineDirection(direction, securityName, parsed.market);
    const tradeId = generateTradeId(row);
    const tradeDate = parseDate(String(row.date || ""));
    const currency = parseCurrency(String(row.currency || ""));
    const quantity = Number(row.quantity) || 0;
    const rawPrice = Number(row.price) || 0;
    // TASE securities quote שער ביצוע in agorot (1/100 ILS). Convert to ILS.
    const price = parsed.market === "TASE" ? rawPrice / 100 : rawPrice;
    const commission = Number(row.commission) || 0;
    const proceedsFx = row.proceedsFx != null ? Number(row.proceedsFx) : null;
    const proceedsIls = row.proceedsIls != null ? Number(row.proceedsIls) : null;
    const capitalGainsTax = row.capitalGainsTax != null && Number(row.capitalGainsTax) !== 0
      ? Number(row.capitalGainsTax)
      : null;

    prepared.push({
      rowIndex: i,
      tradeId,
      data: {
        userId,
        tradeId,
        ticker: parsed.ticker,
        securityName: parsed.securityName,
        market: parsed.market,
        direction,
        quantity,
        price,
        currency,
        commission,
        proceedsFx,
        proceedsIls,
        capitalGainsTax,
        tradeDate,
        source: "xlsx_import",
        rawPayload: JSON.stringify(row),
      },
    });
  }

  // Bulk upsert strategy: pre-fetch which tradeIds already exist, then split
  // into a single createMany (for new rows) and parallel updates (for existing).
  // This collapses ~280 serial Prisma round-trips into effectively 2-3 — a
  // serial loop against a remote Postgres (e.g. the Railway proxy from local
  // dev) is ~100ms/row and blows past Next.js' proxy timeout.
  const allTradeIds = prepared.map((p) => p.tradeId);
  const existingRows = allTradeIds.length > 0
    ? await prisma.trade.findMany({
        where: {
          userId,
          source: "xlsx_import",
          tradeId: { in: allTradeIds },
        },
        select: { tradeId: true },
      })
    : [];
  const existingSet = new Set(existingRows.map((r) => r.tradeId));

  const toCreate = prepared.filter((p) => !existingSet.has(p.tradeId));
  const toUpdate = prepared.filter((p) => existingSet.has(p.tradeId));

  if (toCreate.length > 0) {
    try {
      await prisma.trade.createMany({
        data: toCreate.map((p) => p.data),
        skipDuplicates: true,
      });
      imported += toCreate.length;
    } catch (err) {
      // createMany is all-or-nothing on driver errors, so fall back to
      // per-row so we can still surface which rows failed.
      const results = await Promise.allSettled(
        toCreate.map((p) => prisma.trade.create({ data: p.data })),
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") {
          imported++;
        } else {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          errors.push(`Row ${toCreate[j].rowIndex + 2}: ${msg}`);
          skipped++;
        }
      }
    }
  }

  // Updates still have to go one-by-one (no bulk updateMany-with-different-values
  // in Prisma), but re-uploads are rare and the row count is usually small.
  const UPDATE_CONCURRENCY = 10;
  for (let i = 0; i < toUpdate.length; i += UPDATE_CONCURRENCY) {
    const chunk = toUpdate.slice(i, i + UPDATE_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((p) =>
        prisma.trade.update({
          where: {
            userId_tradeId_source: {
              userId,
              tradeId: p.tradeId,
              source: "xlsx_import",
            },
          },
          data: {
            ticker: p.data.ticker,
            securityName: p.data.securityName,
            direction: p.data.direction,
            market: p.data.market,
            quantity: p.data.quantity,
            price: p.data.price,
            currency: p.data.currency,
            commission: p.data.commission,
            proceedsFx: p.data.proceedsFx,
            proceedsIls: p.data.proceedsIls,
            capitalGainsTax: p.data.capitalGainsTax,
            rawPayload: p.data.rawPayload,
          },
        }),
      ),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        imported++;
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        errors.push(`Row ${chunk[j].rowIndex + 2}: ${msg}`);
        skipped++;
      }
    }
  }

  // Log the import
  const dateRange = rows
    .map((r) => parseDate(String(r.date || "")))
    .filter((d) => !isNaN(d.getTime()));
  const dateFrom = dateRange.length > 0 ? new Date(Math.min(...dateRange.map((d) => d.getTime()))) : new Date();
  const dateTo = dateRange.length > 0 ? new Date(Math.max(...dateRange.map((d) => d.getTime()))) : new Date();

  await prisma.syncLog.create({
    data: {
      userId,
      status: errors.length === 0 ? "success" : skipped === rows.length ? "failed" : "partial",
      recordsAdded: imported,
      dateFrom,
      dateTo,
      fileName: fileName ?? null,
      errorMessage: errors.length > 0 ? errors.slice(0, 10).join("; ") : null,
    },
  });

  return {
    status: errors.length === 0 ? "success" : skipped === rows.length ? "failed" : "partial",
    totalRows: rows.length,
    imported,
    skipped,
    errors: errors.slice(0, 20),
  };
}
