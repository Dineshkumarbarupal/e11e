import test from "node:test";
import assert from "node:assert/strict";
import { executeWorkflowDefinition } from "../src/executor.js";

const baseFlow = () => ({
  id: "flow",
  name: "Test flow",
  active: false,
  nodes: [
    { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
    { id: "fields", type: "set", name: "Fields", x: 200, y: 0, config: { fields: { message: "hello {{ user.name }}", run: "server" } } },
    { id: "output", type: "log", name: "Output", x: 400, y: 0, config: {} }
  ],
  edges: [
    { id: "a", source: "start", target: "fields" },
    { id: "b", source: "fields", target: "output" }
  ]
});

test("server executor runs manual -> set -> log and interpolates values", async () => {
  const run = await executeWorkflowDefinition(baseFlow(), { input: { user: { name: "Ada" } } });
  assert.equal(run.status, "success");
  assert.equal(run.output.message, "hello Ada");
  assert.equal(run.output.run, "server");
  assert.equal(run.nodeRuns.length, 3);
});

test("server executor routes IF through the true branch only", async () => {
  const flow = {
    id: "if-flow", name: "IF flow", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "if", type: "if", name: "Check", x: 200, y: 0, config: { field: "approved", operator: "equals", value: true } },
      { id: "yes", type: "log", name: "Yes", x: 400, y: 0, config: {} },
      { id: "no", type: "log", name: "No", x: 400, y: 150, config: {} }
    ],
    edges: [
      { id: "a", source: "start", target: "if" },
      { id: "b", source: "if", target: "yes", sourceHandle: "true" },
      { id: "c", source: "if", target: "no", sourceHandle: "false" }
    ]
  };
  const run = await executeWorkflowDefinition(flow, { input: { approved: true } });
  assert.ok(run.nodeRuns.some(item => item.nodeId === "yes"));
  assert.ok(!run.nodeRuns.some(item => item.nodeId === "no"));
});

test("server executor refuses HTTP until secure egress is implemented", async () => {
  const flow = {
    id: "http-flow", name: "HTTP flow", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "request", type: "http", name: "Request", x: 200, y: 0, config: { url: "https://example.com" } }
    ],
    edges: [{ id: "a", source: "start", target: "request" }]
  };
  await assert.rejects(() => executeWorkflowDefinition(flow), /outbound network policy/);
});

test("server executor starts specifically at a webhook trigger node", async () => {
  const flow = {
    id: "webhook-flow", name: "Webhook flow", active: true,
    nodes: [
      { id: "manual", type: "manual", name: "Manual", x: 0, y: 0, config: {} },
      { id: "hook", type: "webhook", name: "Webhook", x: 0, y: 150, config: {} },
      { id: "output", type: "log", name: "Webhook output", x: 250, y: 150, config: {} }
    ],
    edges: [{ id: "hook-output", source: "hook", target: "output" }]
  };
  const run = await executeWorkflowDefinition(flow, { input: { event: "created" }, triggerNodeId: "hook" });
  assert.equal(run.status, "success");
  assert.equal(run.output.event, "created");
  assert.ok(!run.nodeRuns.some(item => item.nodeId === "manual"));
});
