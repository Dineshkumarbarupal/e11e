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
