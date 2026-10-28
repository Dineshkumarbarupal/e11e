import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { pool } from "./db.js";

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

export function sortMigrationFiles(names) {
  return (Array.isArray(names) ? names : [])
    .filter(name => typeof name === "string" && /^\d+_.+\.sql$/.test(name))
    .slice()
    .sort((a, b) => {
      const versionA = Number(a.match(/^(\d+)_/)[1]);
      const versionB = Number(b.match(/^(\d+)_/)[1]);
      return versionA - versionB || a.localeCompare(b);
    });
}

export async function applyMigrations(client, migrations, logger = console) {
  if (!client || typeof client.query !== "function") throw new Error("A database client is required.");
  const source = Array.isArray(migrations) ? migrations : [];
  const sorted = sortMigrationFiles(source.map(migration => migration?.filename));
  const byName = new Map(source.map(migration => [migration.filename, migration.sql]));

  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");

  for (const filename of sorted) {
    const alreadyApplied = await client.query(
      "SELECT filename FROM schema_migrations WHERE filename=$1",
      [filename]
    );
    if (alreadyApplied.rowCount) {
      logger.log("Skipping already applied migration " + filename + ".");
      continue;
    }

    const sql = byName.get(filename);
    if (typeof sql !== "string" || !sql.trim()) throw new Error("Migration has no SQL content: " + filename);

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [filename]);
      await client.query("COMMIT");
      logger.log("Applied migration " + filename + ".");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }
}

export async function runMigrations({
  poolInstance = pool,
  directory = migrationsDirectory,
  readdirFunction = readdir,
  readFileFunction = readFile,
  logger = console,
  closePool = true
} = {}) {
  const client = await poolInstance.connect();
  try {
    const filenames = sortMigrationFiles(await readdirFunction(directory));
    const migrations = await Promise.all(filenames.map(async filename => ({
      filename,
      sql: await readFileFunction(join(directory, filename), "utf8")
    })));
    await applyMigrations(client, migrations, logger);
  } finally {
    client.release();
    if (closePool) await poolInstance.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations().catch(error => {
    console.error("Database migration failed:", error.message);
    process.exitCode = 1;
  });
}
