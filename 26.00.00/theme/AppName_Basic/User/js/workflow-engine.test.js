import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultWorkflow, executeWorkflow, validateWorkflow } from "./workflow-engine.js";

test("default workflow validates", () => {
  assert.deepEqual(validateWorkflow(createDefaultWorkflow()), []);
});

test("set node adds configured fields and flows to output", async () => {
  const workflow = createDefaultWorkflow();
  const result = await executeWorkflow(workflow);
  assert.equal(result.status, "success");
  assert.equal(result.output.message, "Hello from e11e");
  assert.equal(result.nodeRuns.length, 3);
});

test("validator rejects broken edges", () => {
  const workflow = createDefaultWorkflow();
  workflow.edges.push({ id: "broken", source: "missing", target: "log_1" });
  assert.ok(validateWorkflow(workflow).some(message => message.includes("missing node")));
});

test("IF node only routes to the matching true branch", async () => {
  const workflow = {
    id: "if-test", name: "IF test",
    nodes: [
      { id: "start", type: "manual", name: "Trigger", x: 0, y: 0, config: {} },
      { id: "condition", type: "if", name: "Condition", x: 1, y: 0, config: { field: "approved", operator: "equals", value: true } },
      { id: "yes", type: "log", name: "Yes", x: 2, y: 0, config: {} },
      { id: "no", type: "log", name: "No", x: 2, y: 1, config: {} }
    ],
    edges: [
      { id: "a", source: "start", target: "condition" },
      { id: "b", source: "condition", target: "yes", sourceHandle: "true" },
      { id: "c", source: "condition", target: "no", sourceHandle: "false" }
    ]
  };
  const result = await executeWorkflow(workflow, { input: { approved: true } });
  assert.ok(result.nodeRuns.some(run => run.nodeId === "yes"));
  assert.ok(!result.nodeRuns.some(run => run.nodeId === "no"));
});

test("validator rejects cycles before execution", () => {
  const workflow = createDefaultWorkflow();
  workflow.edges.push({ id: "cycle", source: "log_1", target: "trigger_1" });
  assert.ok(validateWorkflow(workflow).some(message => message.includes("Cycles are not supported")));
});

test("validator rejects IF branch handles on non-IF nodes", () => {
  const workflow = createDefaultWorkflow();
  workflow.edges[0].sourceHandle = "true";
  assert.ok(validateWorkflow(workflow).some(message => message.includes("non-IF")));
});

test("webhook execution starts at the selected trigger node", async () => {
  const workflow = {
    id: "webhook-start-test", name: "Webhook start test",
    nodes: [
      { id: "manual", type: "manual", name: "Manual Trigger", x: 0, y: 0, config: {} },
      { id: "hook", type: "webhook", name: "Webhook Trigger", x: 200, y: 0, config: {} },
      { id: "output", type: "log", name: "Webhook output", x: 400, y: 0, config: {} }
    ],
    edges: [{ id: "hook-output", source: "hook", target: "output" }]
  };
  const result = await executeWorkflow(workflow, {
    triggerNodeId: "hook",
    input: { event: "created", recordId: 42 }
  });
  assert.equal(result.status, "success");
  assert.equal(result.output.event, "created");
  assert.equal(result.output.recordId, 42);
  assert.ok(result.nodeRuns.some(run => run.nodeId === "hook"));
  assert.ok(!result.nodeRuns.some(run => run.nodeId === "manual"));
});
