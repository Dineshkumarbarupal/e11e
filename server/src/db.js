import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: Number(process.env.PG_POOL_SIZE || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined
});
pool.on("error", error => {
  // Do not log SQL values or secrets; the application logs only a generic pool error.
  console.error("Unexpected PostgreSQL pool error:", error.message);
});
