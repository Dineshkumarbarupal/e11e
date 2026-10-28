import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const url = new URL("../migrations/001_init.sql", import.meta.url);
try {
  const migration = await readFile(fileURLToPath(url), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(migration);
      await client.query("COMMIT");
      console.log("Database migration 001_init.sql applied.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
