/**
 * Bootstrap script — creates the initial user (Nitzan) and backfills existing
 * user-scoped rows with his userId.
 *
 * Runs on Railway preDeploy after `prisma db push`. Idempotent: safe to re-run
 * any number of times. No-op once all rows are backfilled.
 *
 * Required env vars (on first run, for the initial bootstrap):
 *   BOOTSTRAP_USER_EMAIL     — the primary user's email (e.g. laryasif@gmail.com)
 *   BOOTSTRAP_USER_PASSWORD  — the current BASIC_AUTH_PASS value; becomes the user's password
 *
 * After Commit B lands, the script additionally drops the legacy user_preferences table.
 *
 * Run locally:
 *   BOOTSTRAP_USER_EMAIL=... BOOTSTRAP_USER_PASSWORD=... \
 *     pnpm --filter @takumi/db exec tsx ../../scripts/bootstrap-users.ts
 */

import { prisma } from "@takumi/db";
import bcrypt from "bcryptjs";

const USER_SCOPED_TABLES = [
  { name: "trades", label: "trades" },
  { name: "alerts", label: "alerts" },
  { name: "portfolio_snapshots", label: "snapshots" },
  { name: "ai_conversations", label: "conversations" },
  { name: "sync_log", label: "sync logs" },
] as const;

async function main() {
  const email = process.env.BOOTSTRAP_USER_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_USER_PASSWORD;

  // Step 1 — create the bootstrap user if it doesn't exist.
  let bootstrapUserId: string | null = null;
  if (email && password) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      bootstrapUserId = existing.id;
      console.log(`[bootstrap-users] User ${email} already exists (id=${existing.id})`);
    } else {
      const passwordHash = await bcrypt.hash(password, 12);
      const created = await prisma.user.create({
        data: {
          email,
          passwordHash,
          emailVerifiedAt: new Date(),
          displayName: "Nitzan",
        },
      });
      bootstrapUserId = created.id;
      console.log(`[bootstrap-users] Created user ${email} (id=${created.id})`);
    }
  } else {
    console.log(
      "[bootstrap-users] BOOTSTRAP_USER_EMAIL and/or BOOTSTRAP_USER_PASSWORD not set — skipping user creation."
    );
  }

  // Step 2 — backfill user_id on existing rows.
  if (bootstrapUserId) {
    for (const { name, label } of USER_SCOPED_TABLES) {
      // Table may not have the user_id column yet (e.g. pre-Commit-A deploy rollback) — guard.
      const colExistsRows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = $1 AND column_name = 'user_id'
         ) AS exists`,
        name
      );
      const colExists = colExistsRows[0]?.exists === true;
      if (!colExists) {
        console.log(`[bootstrap-users] ${label}: user_id column not present, skipping backfill.`);
        continue;
      }

      const result = await prisma.$executeRawUnsafe(
        `UPDATE ${name} SET user_id = $1 WHERE user_id IS NULL`,
        bootstrapUserId
      );
      console.log(`[bootstrap-users] ${label}: backfilled ${result} row(s) with user_id=${bootstrapUserId}`);
    }
  }

  // Step 3 — drop the legacy user_preferences table if present (Commit B).
  // Safe to run pre-Commit-B because the table may still exist but is unused.
  try {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS user_preferences`);
  } catch (err) {
    console.warn("[bootstrap-users] Could not drop user_preferences:", err);
  }

  console.log("[bootstrap-users] Done.");
}

main()
  .catch((err) => {
    console.error("[bootstrap-users] Failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
