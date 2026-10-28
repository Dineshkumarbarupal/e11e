import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const url = new URL("../migrations/001_init.sql", import.meta.url);
try {
  const migration = await readFile(fileURLToPath(url), "utf8");
  await pool.query("BEGIN");
  try {
    await pool.query(migration);
    await pool.query("COMMIT");
    console.log("Database migration 001_init.sql applied.");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
} finally {
  await pool.end();
}
