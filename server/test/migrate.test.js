import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-jwt-secret-that-is-long-enough-for-validation";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.CREDENTIAL_ENCRYPTION_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { applyMigrations, runMigrations, sortMigrationFiles } = await import("../src/migrate.js");

function fakeClient({ alreadyApplied = [], failSql = null } = {}) {
  const applied = new Set(alreadyApplied);
  const events = [];
  const client = {
    async query(sql, params = []) {
      const statement = String(sql).trim();
      events.push({ statement, params });
      if (statement.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return { rows: [], rowCount: 0 };
      if (statement.startsWith("SELECT filename FROM schema_migrations")) {
        return applied.has(params[0]) ? { rows: [{ filename: params[0] }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (statement.startsWith("INSERT INTO schema_migrations")) {
        applied.add(params[0]);
        return { rows: [], rowCount: 1 };
      }
      if (statement === failSql) throw new Error("synthetic migration failure");
      return { rows: [], rowCount: 0 };
    }
  };
  return { client, applied, events };
}

const quietLogger = { log() {} };

test("migration file filtering and ordering are numeric, deterministic, and non-mutating", () => {
  const input = ["010_tenth.sql", "readme.md", "002_second.sql", "001_first.sql", "003_nope.txt", "02_alternate.sql"];
  const result = sortMigrationFiles(input);
  assert.deepEqual(result, ["001_first.sql", "002_second.sql", "02_alternate.sql", "010_tenth.sql"]);
  assert.deepEqual(input, ["010_tenth.sql", "readme.md", "002_second.sql", "001_first.sql", "003_nope.txt", "02_alternate.sql"]);
});

test("migration runner skips applied files and applies pending migrations in version order", async () => {
  const { client, applied, events } = fakeClient({ alreadyApplied: ["001_existing.sql"] });
  const logs = [];
  await applyMigrations(client, [
    { filename: "003_last.sql", sql: "SELECT 'third';" },
    { filename: "001_existing.sql", sql: "SELECT 'already done';" },
    { filename: "002_second.sql", sql: "SELECT 'second';" }
  ], { log: message => logs.push(message) });
  const executedSql = events.map(event => event.statement).filter(statement => statement.startsWith("SELECT '"));
  assert.deepEqual(executedSql, ["SELECT 'second';", "SELECT 'third';"]);
  assert.equal(applied.has("001_existing.sql"), true);
  assert.equal(applied.has("002_second.sql"), true);
  assert.equal(applied.has("003_last.sql"), true);
  assert.ok(logs.some(message => message.includes("Skipping already applied migration 001_existing.sql")));
});

test("failed migration rolls back and is not recorded as applied", async () => {
  const { client, applied, events } = fakeClient({ failSql: "BROKEN MIGRATION" });
  await assert.rejects(
    () => applyMigrations(client, [{ filename: "001_bad.sql", sql: "BROKEN MIGRATION" }], quietLogger),
    /synthetic migration failure/
  );
  assert.ok(events.some(event => event.statement === "ROLLBACK"));
  assert.equal(applied.has("001_bad.sql"), false);
  assert.equal(events.some(event => event.statement === "COMMIT"), false);
});

test("migration runner always releases its client and closes the pool", async () => {
  const { client } = fakeClient();
  const lifecycle = [];
  client.release = () => lifecycle.push("release");
  const poolInstance = {
    async connect() { lifecycle.push("connect"); return client; },
    async end() { lifecycle.push("end"); }
  };
  const logs = [];
  await runMigrations({
    poolInstance,
    directory: "/fake/migrations",
    readdirFunction: async () => ["002_second.sql", "001_first.sql", "README.md"],
    readFileFunction: async filePath => filePath.endsWith("001_first.sql") ? "SELECT 'first';" : "SELECT 'second';",
    logger: { log: message => logs.push(message) }
  });
  assert.deepEqual(lifecycle, ["connect", "release", "end"]);
  assert.deepEqual(logs, ["Applied migration 001_first.sql.", "Applied migration 002_second.sql."]);
});

test("migration runner closes pool and releases client when a migration fails", async () => {
  const { client } = fakeClient({ failSql: "BROKEN MIGRATION" });
  const lifecycle = [];
  client.release = () => lifecycle.push("release");
  const poolInstance = {
    async connect() { return client; },
    async end() { lifecycle.push("end"); }
  };
  await assert.rejects(() => runMigrations({
    poolInstance,
    directory: "/fake/migrations",
    readdirFunction: async () => ["001_bad.sql"],
    readFileFunction: async () => "BROKEN MIGRATION",
    logger: quietLogger
  }), /synthetic migration failure/);
  assert.deepEqual(lifecycle, ["release", "end"]);
});
