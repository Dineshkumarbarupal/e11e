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


test("Loop Over Items fans out each array item to downstream nodes in order", async () => {
  const workflow = {
    id: "loop-flow", name: "Loop flow",
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "loop", type: "loop", name: "Loop", x: 200, y: 0, config: { listField: "data.records", maxItems: 5 } },
      { id: "fields", type: "set", name: "Fields", x: 400, y: 0, config: { fields: { label: "item={{ itemIndex }}/{{ itemCount }} id={{ id }} name={{ name }}" } } },
      { id: "log", type: "log", name: "Log", x: 600, y: 0, config: {} }
    ],
    edges: [
      { id: "a", source: "start", target: "loop" },
      { id: "b", source: "loop", target: "fields" },
      { id: "c", source: "fields", target: "log" }
    ]
  };
  const result = await executeWorkflow(workflow, {
    input: { data: { records: [{ id: 7, name: "Ada" }, { id: 9, name: "Lin" }] } },
    maxSteps: 20
  });
  const logRuns = result.nodeRuns.filter(run => run.nodeId === "log");
  assert.equal(result.status, "success");
  assert.equal(logRuns.length, 2);
  assert.equal(logRuns[0].output.label, "item=0/2 id=7 name=Ada");
  assert.equal(logRuns[1].output.label, "item=1/2 id=9 name=Lin");
  assert.equal(result.nodeRuns.find(run => run.nodeId === "loop").output.loop.itemCount, 2);
});

test("Loop Over Items rejects a missing or non-array field", async () => {
  const workflow = {
    id: "loop-invalid", name: "Loop invalid",
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "loop", type: "loop", name: "Loop", x: 200, y: 0, config: { listField: "records", maxItems: 10 } }
    ],
    edges: [{ id: "a", source: "start", target: "loop" }]
  };
  await assert.rejects(() => executeWorkflow(workflow, { input: { records: "not-an-array" } }), /expected an array/);
});

test("Loop Over Items enforces its configured item bound", async () => {
  const workflow = {
    id: "loop-limit", name: "Loop limit",
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "loop", type: "loop", name: "Loop", x: 200, y: 0, config: { listField: "items", maxItems: 1 } }
    ],
    edges: [{ id: "a", source: "start", target: "loop" }]
  };
  await assert.rejects(() => executeWorkflow(workflow, { input: { items: [1, 2] } }), /configured limit is 1/);
});

test("Loop Over Items with an empty array completes without downstream runs", async () => {
  const workflow = {
    id: "loop-empty", name: "Empty loop",
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "loop", type: "loop", name: "Loop", x: 200, y: 0, config: { listField: "items", maxItems: 5 } },
      { id: "log", type: "log", name: "Log", x: 400, y: 0, config: {} }
    ],
    edges: [{ id: "a", source: "start", target: "loop" }, { id: "b", source: "loop", target: "log" }]
  };
  const result = await executeWorkflow(workflow, { input: { items: [] } });
  assert.equal(result.status, "success");
  assert.equal(result.nodeRuns.filter(run => run.nodeId === "log").length, 0);
});
