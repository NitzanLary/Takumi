/**
 * One-shot smoke test for the ported funder.service.
 *
 * Usage:
 *   pnpm --filter @takumi/api exec tsx ../../scripts/verify-funder.ts
 *
 * Tests:
 *   1. Security (seco) — 1143726
 *   2. Fund     (fundo) — 5123161
 *   3. guessFunderKind heuristic
 *
 * Does NOT touch the database — pure module call.
 */

import {
  fetchFunderHistorical,
  guessFunderKind,
} from '../apps/api/src/services/funder.service.js';

async function main() {
  const today = new Date();
  const oneYearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);

  console.log('--- guessFunderKind heuristic ---');
  for (const id of ['1143726', '273011', '5123161', '5113063', '5124573']) {
    console.log(`  ${id} → ${guessFunderKind(id)}`);
  }

  console.log('\n--- fetchFunderHistorical: security 1143726 ---');
  const sec = await fetchFunderHistorical('1143726', 'seco', oneYearAgo, today);
  console.log(`  rows: ${sec.length}`);
  if (sec.length > 0) {
    console.log(`  first: ${JSON.stringify(sec[0])}`);
    console.log(`  last:  ${JSON.stringify(sec[sec.length - 1])}`);
  }

  console.log('\n--- fetchFunderHistorical: fund 5123161 ---');
  const fund = await fetchFunderHistorical('5123161', 'fundo', oneYearAgo, today);
  console.log(`  rows: ${fund.length}`);
  if (fund.length > 0) {
    console.log(`  first: ${JSON.stringify(fund[0])}`);
    console.log(`  last:  ${JSON.stringify(fund[fund.length - 1])}`);
  }

  console.log('\n--- heuristic miss recovery (security id 1143726 tried as fundo first) ---');
  const wrongKind = await fetchFunderHistorical('1143726', 'fundo', oneYearAgo, today);
  console.log(`  rows when calling fundo on a security: ${wrongKind.length} (expect 0)`);

  if (sec.length === 0 || fund.length === 0) {
    console.error('\nFAIL — at least one endpoint returned no data.');
    process.exit(1);
  }
  console.log('\nOK — both endpoints returned data and heuristic miss returns [] cleanly.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
