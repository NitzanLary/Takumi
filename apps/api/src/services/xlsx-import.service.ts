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

const DIRECTION_MAP: Record<string, Direction> = {
  "קניה חול מטח": "BUY",
  "קניה רצף": "BUY",
  "מכירה חול מטח": "SELL",
  "מכירה רצף": "SELL",
  "הפקדה דיבידנד מטח": "DIVIDEND",
  "משיכת מס חול מטח": "TAX",
  "משיכת מס מטח": "TAX",
  "קניה שח": "CONVERSION",
  "מכירה שח": "CREDIT",
  "העברה מזומן בשח": "TRANSFER",
  "הפקדה": "DEPOSIT",
  "משיכה": "WITHDRAWAL",
  "הטבה": "SPLIT",
  "דמי טפול מזומן בשח": "FEE",
  "שונות מזומן בשח": "TRANSFER",
};

// ─── Security name parsing ────────────────────────────────────────────────

interface ParsedSecurity {
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
 */
function parseSecurity(
  securityName: string,
  symbol: string | number,
  hebrewType: string,
): ParsedSecurity {
  const name = securityName.trim();
  const sym = String(symbol).trim();

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
    return { ticker: parenMatch[1], securityName: name, market: "NYSE" };
  }

  // Simple "TICKER US" format: "RGTI US", "IONQ US"
  const simpleUsMatch = name.match(/^(\w+)\s+US$/);
  if (simpleUsMatch) {
    return { ticker: simpleUsMatch[1], securityName: name, market: "NYSE" };
  }

  // TASE securities — symbol is a numeric paper number
  if (/^\d+$/.test(sym) && !["900", "9992975", "9992983"].includes(sym)) {
    return { ticker: sym, securityName: name, market: "TASE" };
  }

  // Admin/cash operations (symbol 900, 9992975, 9992983)
  if (["900", "9992975", "9992983"].includes(sym)) {
    return { ticker: sym, securityName: name, market: "ADMIN" };
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

// ─── Special cases for קניה שח ────────────────────────────────────────────

/** 2 of the 36 קניה שח rows are tax-related (מס ששולם), not FX conversions */
function refineDirection(direction: Direction, securityName: string): Direction {
  if (direction === "CONVERSION" && securityName.includes("מס ששולם")) {
    return "TAX";
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

export async function importXlsx(buffer: Buffer, fileName?: string): Promise<ImportResult> {
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

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const hebrewType = String(row.type || "");
      let direction = DIRECTION_MAP[hebrewType.trim()];
      if (!direction) {
        errors.push(`Row ${i + 2}: Unknown transaction type "${hebrewType}"`);
        skipped++;
        continue;
      }

      const securityName = String(row.securityName || "");
      direction = refineDirection(direction, securityName);

      const parsed = parseSecurity(securityName, row.symbol as string | number, hebrewType);
      const tradeId = generateTradeId(row);
      const tradeDate = parseDate(String(row.date || ""));
      const currency = parseCurrency(String(row.currency || ""));
      const quantity = Number(row.quantity) || 0;
      const price = Number(row.price) || 0;
      const commission = Number(row.commission) || 0;
      const proceedsFx = row.proceedsFx != null ? Number(row.proceedsFx) : null;
      const proceedsIls = row.proceedsIls != null ? Number(row.proceedsIls) : null;
      const capitalGainsTax = row.capitalGainsTax != null && Number(row.capitalGainsTax) !== 0
        ? Number(row.capitalGainsTax)
        : null;

      // Store market as standard values; FX/ADMIN stay as-is for non-trade types
      const market = parsed.market === "FX" || parsed.market === "ADMIN"
        ? parsed.market
        : parsed.market;

      await prisma.trade.upsert({
        where: {
          tradeId_source: {
            tradeId,
            source: "xlsx_import",
          },
        },
        update: {
          ticker: parsed.ticker,
          securityName: parsed.securityName,
          direction,
          market,
          quantity,
          price,
          currency,
          commission,
          proceedsFx,
          proceedsIls,
          capitalGainsTax,
          rawPayload: JSON.stringify(row),
        },
        create: {
          tradeId,
          ticker: parsed.ticker,
          securityName: parsed.securityName,
          market,
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
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${i + 2}: ${msg}`);
      skipped++;
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
