/**
 * discover-endpoints.ts — Re-derive funder.co.il historical-price endpoints.
 *
 * Why this exists: funder.co.il has no public API. The production fetcher
 * (apps/api/src/services/funder.service.ts) works by scraping a JS variable
 * literal (tStockData / tStockData2) out of the page HTML. If they ever rename
 * the variable or move to a real XHR endpoint, funder.service.ts will start
 * throwing FunderParseError. This script re-discovers the data delivery
 * mechanism by:
 *
 *   1. Loading both reference pages in a real Chromium via Playwright.
 *   2. Logging every XHR/fetch the page issues (URL, method, status, content-type).
 *   3. Probing well-known global variable names that historically held the series.
 *   4. Printing a diff vs. what funder.service.ts currently assumes.
 *
 * Run with:
 *   pnpm dlx playwright install chromium   # one-time
 *   pnpm dlx tsx funder/discover-endpoints.ts
 */

import { chromium, type Request, type Response } from 'playwright';

const TARGETS = [
  { kind: 'security', url: 'https://www.funder.co.il/seco/1143726/s' },
  { kind: 'fund', url: 'https://www.funder.co.il/fundo/5123161' },
] as const;

// Global names funder.service.ts currently relies on.
const EXPECTED_GLOBALS = [
  'tStockData',    // security primary, fund shell
  'tStockData2',   // fund primary
  'tStockDataB',   // security secondary (B-series, currently unused)
] as const;

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const t of TARGETS) {
      console.log(`\n=================================`);
      console.log(`Probing ${t.kind}: ${t.url}`);
      console.log(`=================================`);

      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      const xhrs: Array<{
        method: string;
        url: string;
        status: number | null;
        contentType: string | null;
        bodyPreview: string | null;
      }> = [];

      page.on('request', (req: Request) => {
        const type = req.resourceType();
        if (type !== 'xhr' && type !== 'fetch') return;
        // Recorded on response below — store a placeholder keyed by URL+method.
      });

      page.on('response', async (res: Response) => {
        const req = res.request();
        const type = req.resourceType();
        if (type !== 'xhr' && type !== 'fetch') return;
        let bodyPreview: string | null = null;
        try {
          const txt = await res.text();
          bodyPreview = txt.slice(0, 200);
        } catch {
          bodyPreview = '<binary or unavailable>';
        }
        xhrs.push({
          method: req.method(),
          url: req.url(),
          status: res.status(),
          contentType: res.headers()['content-type'] ?? null,
          bodyPreview,
        });
      });

      await page.goto(t.url, { waitUntil: 'networkidle', timeout: 30_000 });
      // Some pages lazy-load on first interaction — wait a beat for late XHRs.
      await page.waitForTimeout(2_000);

      console.log(`\nXHR / fetch requests (${xhrs.length}):`);
      if (xhrs.length === 0) {
        console.log('  (none — data is likely embedded in the page HTML)');
      } else {
        for (const x of xhrs) {
          console.log(
            `  [${x.status ?? '?'}] ${x.method} ${x.url}\n    ` +
              `content-type: ${x.contentType ?? '<none>'}\n    ` +
              `body[0..200]: ${(x.bodyPreview ?? '').replace(/\s+/g, ' ')}`,
          );
        }
      }

      console.log(`\nGlobal variable probe:`);
      const globals = await page.evaluate((names) => {
        const out: Record<string, { type: string; len: number | null; sample: unknown }> = {};
        for (const n of names) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            const v = w[n];
            if (v === undefined) continue;
            const type = Array.isArray(v) ? 'array' : typeof v;
            let len: number | null = null;
            let sample: unknown = null;
            if (Array.isArray(v)) {
              len = v.length;
              sample = v.slice(0, 2);
            } else if (v && typeof v === 'object') {
              const keys = Object.keys(v);
              len = keys.length;
              sample = keys.slice(0, 5);
            } else {
              sample = String(v).slice(0, 80);
            }
            out[n] = { type, len, sample };
          } catch {
            /* skip */
          }
        }
        return out;
      }, EXPECTED_GLOBALS as unknown as string[]);

      for (const name of EXPECTED_GLOBALS) {
        const hit = globals[name];
        if (!hit) {
          console.log(`  ${name}: <not present>`);
        } else {
          console.log(
            `  ${name}: type=${hit.type} len=${hit.len} sample=${JSON.stringify(hit.sample)?.slice(0, 200)}`,
          );
        }
      }

      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
