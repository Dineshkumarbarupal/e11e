import test from "node:test";
import assert from "node:assert/strict";
import { claimExecution } from "../src/execution-claims.js";

test("claims a queued execution exactly once", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      assert.equal(params[0], "execution-1");
      if (sql.startsWith("UPDATE executions")) return { rows: [{ id: "execution-1", status: "running" }] };
      throw new Error("A successful claim should not read state again.");
    }
  };
  assert.deepEqual(await claimExecution(db, "execution-1"), { claimed: true, status: "running" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /status IN \('queued','error'\)/);
});

test("skips duplicate jobs while an execution is already running", async () => {
  let calls = 0;
  const db = {
    async query(sql) {
      calls += 1;
      return sql.startsWith("UPDATE executions") ? { rows: [] } : { rows: [{ status: "running" }] };
    }
  };
  assert.deepEqual(await claimExecution(db, "execution-2"), { claimed: false, status: "running" });
  assert.equal(calls, 2);
});

test("skips duplicate jobs for successful and cancelled executions", async () => {
  for (const status of ["success", "cancelled"]) {
    const db = { async query(sql) { return sql.startsWith("UPDATE executions") ? { rows: [] } : { rows: [{ status }] }; } };
    assert.deepEqual(await claimExecution(db, "execution-3"), { claimed: false, status });
  }
});

test("allows BullMQ retries to reclaim a failed execution", async () => {
  const db = {
    async query(sql) {
      if (sql.startsWith("UPDATE executions")) return { rows: [{ id: "execution-4", status: "running" }] };
      throw new Error("The update should reclaim an error state.");
    }
  };
  assert.deepEqual(await claimExecution(db, "execution-4"), { claimed: true, status: "running" });
});

test("fails loudly if the execution row is missing", async () => {
  const db = { async query(sql) { return { rows: [] }; } };
  await assert.rejects(() => claimExecution(db, "missing-execution"), /record not found/);
});

test("does not silently skip a queued row if the atomic claim fails", async () => {
  const db = {
    async query(sql) {
      return sql.startsWith("UPDATE executions") ? { rows: [] } : { rows: [{ status: "queued" }] };
    }
  };
  await assert.rejects(() => claimExecution(db, "execution-5"), /could not be atomically claimed/);
});
