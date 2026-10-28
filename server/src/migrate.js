import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { pool } from "./db.js";

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const files = (await readdir(migrationsDirectory)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
const client = await pool.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const filename of files) {
    const alreadyApplied = await client.query("SELECT filename FROM schema_migrations WHERE filename=$1", [filename]);
    if (alreadyApplied.rowCount) {
      console.log(`Skipping already applied migration ${filename}.`);
      continue;
    }
    const sql = await readFile(join(migrationsDirectory, filename), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [filename]);
      await client.query("COMMIT");
      console.log(`Applied migration ${filename}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
