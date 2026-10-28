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


test("IF node only routes to the false branch when the condition fails", async () => {
  const workflow = {
    id: "if-false-test", name: "IF false test",
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
  const result = await executeWorkflow(workflow, { input: { approved: false } });
  assert.ok(result.nodeRuns.some(run => run.nodeId === "no"));
  assert.ok(!result.nodeRuns.some(run => run.nodeId === "yes"));
});

test("set node interpolates nested input paths without mutating the input", async () => {
  const workflow = createDefaultWorkflow();
  workflow.nodes[1].config.fields = {
    greeting: "Hello {{ user.name }}",
    approvedText: "{{ approved }}"
  };
  const input = { approved: true, user: { name: "Ada" } };
  const result = await executeWorkflow(workflow, { input });
  assert.equal(result.output.greeting, "Hello Ada");
  assert.equal(result.output.approvedText, "true");
  assert.deepEqual(input, { approved: true, user: { name: "Ada" } });
});

test("HTTP node rejects non-HTTP schemes before making a request", async () => {
  const workflow = {
    id: "bad-url", name: "Bad URL",
    nodes: [
      { id: "start", type: "manual", name: "Trigger", x: 0, y: 0, config: {} },
      { id: "request", type: "http", name: "Request", x: 200, y: 0, config: { url: "file:///etc/passwd" } }
    ],
    edges: [{ id: "a", source: "start", target: "request" }]
  };
  await assert.rejects(() => executeWorkflow(workflow), error => error.message.includes("valid http:// or https:// URL"));
});


test("IF true and false branches may share a single target", async () => {
  const workflow = {
    id: "shared-branch-target", name: "Shared branch target",
    nodes: [
      { id: "start", type: "manual", name: "Trigger", x: 0, y: 0, config: {} },
      { id: "condition", type: "if", name: "Condition", x: 1, y: 0, config: { field: "approved", operator: "equals", value: true } },
      { id: "shared", type: "log", name: "Shared output", x: 2, y: 0, config: {} }
    ],
    edges: [
      { id: "a", source: "start", target: "condition" },
      { id: "b", source: "condition", target: "shared", sourceHandle: "true" },
      { id: "c", source: "condition", target: "shared", sourceHandle: "false" }
    ]
  };
  assert.deepEqual(validateWorkflow(workflow), []);
  const result = await executeWorkflow(workflow, { input: { approved: false } });
  assert.equal(result.nodeRuns.filter(run => run.nodeId === "shared").length, 1);
});


test("schedule trigger validates a five-field UTC cron expression", () => {
  const workflow = createDefaultWorkflow();
  workflow.nodes[0] = { ...workflow.nodes[0], type: "schedule", name: "Schedule Trigger", config: { cron: "0 9 * * 1-5" } };
  assert.deepEqual(validateWorkflow(workflow), []);
  workflow.nodes[0].config.cron = "60 * * * *";
  assert.ok(validateWorkflow(workflow).some(message => message.includes("valid five-field UTC cron")));
});

test("local execution can explicitly start at a schedule trigger", async () => {
  const workflow = {
    id: "schedule-local-run", name: "Schedule local test",
    nodes: [
      { id: "manual", type: "manual", name: "Manual", x: 0, y: 0, config: {} },
      { id: "schedule", type: "schedule", name: "Schedule", x: 0, y: 180, config: { cron: "*/15 * * * *" } },
      { id: "output", type: "log", name: "Output", x: 300, y: 180, config: {} }
    ],
    edges: [{ id: "schedule-output", source: "schedule", target: "output" }]
  };
  const result = await executeWorkflow(workflow, { triggerNodeId: "schedule", input: { run: "scheduled" } });
  assert.equal(result.status, "success");
  assert.equal(result.output.run, "scheduled");
  assert.ok(result.nodeRuns.some(run => run.nodeId === "schedule"));
  assert.ok(!result.nodeRuns.some(run => run.nodeId === "manual"));
});


test("validator rejects edges entering trigger nodes", () => {
  const workflow = createDefaultWorkflow();
  workflow.edges.push({ id: "back-to-trigger", source: "log_1", target: "trigger_1" });
  assert.ok(validateWorkflow(workflow).some(message => message.includes("Trigger nodes cannot have incoming connections")));
});
