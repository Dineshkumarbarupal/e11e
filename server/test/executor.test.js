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

test("server executor blocks HTTP when the hostname is not allow-listed", async () => {
  const flow = {
    id: "http-flow", name: "HTTP flow", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "request", type: "http", name: "Request", x: 200, y: 0, config: { url: "https://example.com" } }
    ],
    edges: [{ id: "a", source: "start", target: "request" }]
  };
  await assert.rejects(() => executeWorkflowDefinition(flow), /outbound network policy/i);
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


test("server executor runs a schedule trigger when its node id is explicit", async () => {
  const flow = {
    id: "schedule-flow", name: "Schedule flow", active: true,
    nodes: [
      { id: "manual", type: "manual", name: "Manual", x: 0, y: 0, config: {} },
      { id: "schedule", type: "schedule", name: "Schedule", x: 0, y: 150, config: { cron: "0 9 * * 1-5" } },
      { id: "output", type: "log", name: "Scheduled output", x: 250, y: 150, config: {} }
    ],
    edges: [{ id: "schedule-output", source: "schedule", target: "output" }]
  };
  const run = await executeWorkflowDefinition(flow, { input: { source: "scheduler" }, triggerNodeId: "schedule" });
  assert.equal(run.status, "success");
  assert.equal(run.output.source, "scheduler");
  assert.ok(!run.nodeRuns.some(item => item.nodeId === "manual"));
});


test("server HTTP execution resolves encrypted workspace credentials outside inline headers", async () => {
  const flow = {
    id: "secure-http-flow", name: "Secure HTTP flow", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "request", type: "http", name: "Request", x: 200, y: 0, config: {
        url: "https://api.example.test/users/{{ user.id }}",
        method: "POST",
        headers: { Accept: "application/json" },
        body: "{\"name\":\"{{ user.name }}\"}",
        credentialId: "123e4567-e89b-42d3-a456-426614174000",
        credentialField: "auth.token",
        credentialHeader: "Authorization",
        credentialPrefix: "Bearer"
      } }
    ],
    edges: [{ id: "a", source: "start", target: "request" }]
  };
  let credentialLookups = 0;
  let capturedRequest;
  const run = await executeWorkflowDefinition(flow, {
    input: { user: { id: "42", name: "Ada" } },
    allowedHosts: ["api.example.test"],
    resolveCredential: async id => {
      credentialLookups += 1;
      assert.equal(id, "123e4567-e89b-42d3-a456-426614174000");
      return { auth: { token: "secret-value" } };
    },
    executeHttpRequest: async (request, options) => {
      capturedRequest = { request, options };
      return { status: 200, ok: true, headers: { "content-type": "application/json" }, body: { accepted: true } };
    }
  });
  assert.equal(run.status, "success");
  assert.equal(run.output.body.accepted, true);
  assert.equal(credentialLookups, 1);
  assert.equal(capturedRequest.request.url, "https://api.example.test/users/42");
  assert.equal(capturedRequest.request.method, "POST");
  assert.equal(capturedRequest.request.body, "{\"name\":\"Ada\"}");
  assert.equal(capturedRequest.request.headers.Accept, "application/json");
  assert.equal(capturedRequest.request.headers.Authorization, undefined);
  assert.deepEqual(capturedRequest.request.credentialHeader, { name: "Authorization", value: "Bearer secret-value" });
  assert.deepEqual(capturedRequest.options.allowedHosts, ["api.example.test"]);
  assert.equal(JSON.stringify(flow).includes("secret-value"), false);
});

test("server HTTP execution rejects malformed credential IDs before vault lookup", async () => {
  const flow = {
    id: "bad-credential-flow", name: "Bad credential flow", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "request", type: "http", name: "Request", x: 200, y: 0, config: {
        url: "https://api.example.test", credentialId: "not-a-uuid"
      } }
    ],
    edges: [{ id: "a", source: "start", target: "request" }]
  };
  let called = false;
  await assert.rejects(() => executeWorkflowDefinition(flow, {
    resolveCredential: async () => { called = true; return { token: "not-needed" }; },
    executeHttpRequest: async () => ({ status: 200, ok: true, body: {} })
  }), /Credential ID must be a valid UUID/);
  assert.equal(called, false);
});

test("server HTTP execution rejects a missing credential field without making a request", async () => {
  const flow = {
    id: "missing-credential-field", name: "Missing credential field", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "request", type: "http", name: "Request", x: 200, y: 0, config: {
        url: "https://api.example.test", credentialId: "123e4567-e89b-42d3-a456-426614174000",
        credentialField: "missing.token"
      } }
    ],
    edges: [{ id: "a", source: "start", target: "request" }]
  };
  let requested = false;
  await assert.rejects(() => executeWorkflowDefinition(flow, {
    resolveCredential: async () => ({ token: "present" }),
    executeHttpRequest: async () => { requested = true; return { status: 200, ok: true, body: {} }; }
  }), /credential field was not found/);
  assert.equal(requested, false);
});


test("server HTTP retries transient network errors up to the configured attempt count", async () => {
  const flow = {
    id: "http-retry-flow", name: "HTTP retry flow", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "request", type: "http", name: "Request", x: 200, y: 0, config: {
        url: "https://api.example.test/data", retryCount: 2, retryDelayMs: 50
      } }
    ],
    edges: [{ id: "a", source: "start", target: "request" }]
  };
  let calls = 0;
  const run = await executeWorkflowDefinition(flow, {
    allowedHosts: ["api.example.test"],
    executeHttpRequest: async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("temporary connection reset"), { code: "ECONNRESET" });
      return { status: 200, ok: true, headers: {}, body: { retried: true } };
    }
  });
  assert.equal(calls, 3);
  assert.equal(run.output.body.retried, true);
  assert.match(run.nodeRuns.find(item => item.nodeId === "request").message, /3 attempts/);
});

test("server HTTP retries 429 and 5xx responses but not ordinary 4xx responses", async () => {
  const makeFlow = () => ({
    id: "http-status-retry", name: "HTTP status retry", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "request", type: "http", name: "Request", x: 200, y: 0, config: {
        url: "https://api.example.test/data", retryCount: 2, retryDelayMs: 50
      } }
    ],
    edges: [{ id: "a", source: "start", target: "request" }]
  });
  let retryCalls = 0;
  const success = await executeWorkflowDefinition(makeFlow(), {
    allowedHosts: ["api.example.test"],
    executeHttpRequest: async () => {
      retryCalls += 1;
      return retryCalls === 1
        ? { status: 503, ok: false, headers: {}, body: "temporarily unavailable" }
        : { status: 200, ok: true, headers: {}, body: { recovered: true } };
    }
  });
  assert.equal(retryCalls, 2);
  assert.equal(success.output.body.recovered, true);

  let clientErrorCalls = 0;
  await assert.rejects(() => executeWorkflowDefinition(makeFlow(), {
    allowedHosts: ["api.example.test"],
    executeHttpRequest: async () => {
      clientErrorCalls += 1;
      return { status: 400, ok: false, headers: {}, body: "bad request" };
    }
  }), /status 400/);
  assert.equal(clientErrorCalls, 1);
});


test("server executor fans out bounded loop items into the downstream branch", async () => {
  const flow = {
    id: "server-loop-flow", name: "Server loop", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "loop", type: "loop", name: "Loop", x: 200, y: 0, config: { listField: "rows", maxItems: 5 } },
      { id: "fields", type: "set", name: "Fields", x: 400, y: 0, config: { fields: { label: "#{{ itemIndex }}={{ name }}" } } },
      { id: "log", type: "log", name: "Log", x: 600, y: 0, config: {} }
    ],
    edges: [{ id: "a", source: "start", target: "loop" }, { id: "b", source: "loop", target: "fields" }, { id: "c", source: "fields", target: "log" }]
  };
  const run = await executeWorkflowDefinition(flow, { input: { rows: [{ name: "Ada" }, { name: "Lin" }] }, maxSteps: 20 });
  const logs = run.nodeRuns.filter(item => item.nodeId === "log");
  assert.equal(run.status, "success");
  assert.equal(logs.length, 2);
  assert.equal(logs[0].output.label, "#0=Ada");
  assert.equal(logs[1].output.label, "#1=Lin");
});

test("server executor rejects an over-limit loop before downstream execution", async () => {
  const flow = {
    id: "server-loop-bound", name: "Server loop bound", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "loop", type: "loop", name: "Loop", x: 200, y: 0, config: { listField: "items", maxItems: 1 } },
      { id: "log", type: "log", name: "Log", x: 400, y: 0, config: {} }
    ],
    edges: [{ id: "a", source: "start", target: "loop" }, { id: "b", source: "loop", target: "log" }]
  };
  await assert.rejects(() => executeWorkflowDefinition(flow, { input: { items: [1, 2] } }), /configured limit is 1/);
});

test("server executor rejects a non-array loop source", async () => {
  const flow = {
    id: "server-loop-invalid", name: "Server loop invalid", active: false,
    nodes: [
      { id: "start", type: "manual", name: "Start", x: 0, y: 0, config: {} },
      { id: "loop", type: "loop", name: "Loop", x: 200, y: 0, config: { listField: "items" } }
    ],
    edges: [{ id: "a", source: "start", target: "loop" }]
  };
  await assert.rejects(() => executeWorkflowDefinition(flow, { input: { items: {} } }), /expected an array/);
});


test("server executor checks for cancellation before processing the first node", async () => {
  const flow = baseFlow();
  await assert.rejects(
    () => executeWorkflowDefinition(flow, { shouldCancel: async () => true }),
    error => error.cancelled === true && error.nodeRuns.length === 0
  );
});

test("server executor stops between nodes when cancellation is requested", async () => {
  let checks = 0;
  const flow = baseFlow();
  await assert.rejects(
    () => executeWorkflowDefinition(flow, { shouldCancel: async () => { checks += 1; return checks > 1; } }),
    error => error.cancelled === true && error.nodeRuns.length === 1 && error.nodeRuns[0].nodeId === "start"
  );
});
