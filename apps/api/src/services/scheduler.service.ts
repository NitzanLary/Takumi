import cron from "node-cron";
import { triggerSync } from "./sync.service.js";

let syncTask: cron.ScheduledTask | null = null;

/**
 * Start the scheduled sync job.
 * Default: every 15 minutes during TASE market hours (Sun-Thu 10:00-17:30 Israel),
 * every 2 hours outside market hours.
 *
 * For simplicity in v1, we run every 30 minutes around the clock.
 */
export function startScheduledSync() {
  if (syncTask) {
    syncTask.stop();
  }

  // Every 30 minutes
  syncTask = cron.schedule("*/30 * * * *", async () => {
    console.log("[scheduler] Running scheduled sync...");
    try {
      const result = await triggerSync();
      console.log("[scheduler] Sync result:", result);
    } catch (error) {
      console.error("[scheduler] Sync failed:", error);
    }
  });

  console.log("[scheduler] Scheduled sync started (every 30 minutes)");
}

export function stopScheduledSync() {
  if (syncTask) {
    syncTask.stop();
    syncTask = null;
    console.log("[scheduler] Scheduled sync stopped");
  }
}
