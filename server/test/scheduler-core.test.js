import test from "node:test";
import assert from "node:assert/strict";
import { collectDueScheduleNodes, minuteSlot } from "../src/scheduler-core.js";

const activeFlow = (id, cron, nodeId = "schedule") => ({
  id, workspace_id: "workspace-1", active: true,
  definition: { nodes: [{ id: nodeId, type: "schedule", name: "Schedule", config: { cron } }] }
});

test("minuteSlot floors seconds while preserving the UTC minute", () => {
  assert.equal(minuteSlot(new Date("2026-10-28T06:15:47.123Z")), "2026-10-28T06:15:00.000Z");
});

test("scheduler core finds matching active workflow schedules", () => {
  const result = collectDueScheduleNodes([
    activeFlow("flow-due", "15 6 * * *"),
    activeFlow("flow-not-due", "0 7 * * *"),
    { ...activeFlow("flow-inactive", "15 6 * * *"), active: false }
  ], new Date("2026-10-28T06:15:28Z"));
  assert.equal(result.due.length, 1);
  assert.equal(result.due[0].workflowId, "flow-due");
  assert.equal(result.due[0].slot, "2026-10-28T06:15:00.000Z");
});

test("scheduler core reports invalid schedule expressions without matching them", () => {
  const result = collectDueScheduleNodes([activeFlow("bad-flow", "90 25 * * *")], new Date("2026-10-28T06:15:00Z"));
  assert.equal(result.due.length, 0);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.invalid[0].workflowId, "bad-flow");
});

test("scheduler core handles JSON workflow definitions", () => {
  const row = activeFlow("json-flow", "15 6 * * *");
  row.definition = JSON.stringify(row.definition);
  const result = collectDueScheduleNodes([row], new Date("2026-10-28T06:15:00Z"));
  assert.equal(result.due[0].workflowId, "json-flow");
});

test("scheduler core derives a stable key for each workflow and node", () => {
  const result = collectDueScheduleNodes([activeFlow("flow-one", "15 6 * * *", "node-a"),activeFlow("flow-one", "15 6 * * *", "node-b")],new Date("2026-10-28T06:15:00Z"));
  assert.notEqual(result.due[0].key,result.due[1].key);
});
