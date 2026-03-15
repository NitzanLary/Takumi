import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root (two levels up from apps/api/src/lib/)
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

export const config = {
  port: parseInt(process.env.API_PORT || "3001", 10),
  ibiSyncUrl: process.env.IBI_SYNC_URL || "http://localhost:8100",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  databaseUrl: process.env.DATABASE_URL || "file:./takumi.db",
  nodeEnv: process.env.NODE_ENV || "development",
} as const;
