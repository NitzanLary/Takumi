import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root in dev. In prod (Railway), env vars are injected
// directly and this file may not exist — dotenv silently no-ops, which is fine.
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

export const config = {
  port: parseInt(process.env.PORT || process.env.API_PORT || "3001", 10),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  databaseUrl: process.env.DATABASE_URL || "",
  nodeEnv: process.env.NODE_ENV || "development",
  corsOrigin: process.env.CORS_ORIGIN || `http://localhost:${process.env.WEB_PORT || 3000}`,
  basicAuth: {
    user: process.env.BASIC_AUTH_USER || "",
    pass: process.env.BASIC_AUTH_PASS || "",
  },
} as const;
