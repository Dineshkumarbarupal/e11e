export const NODE_TYPES = {
  manual: { label: "Manual Trigger", icon: "▶", color: "violet" },
  set: { label: "Edit Fields", icon: "✎", color: "blue" },
  http: { label: "HTTP Request", icon: "↗", color: "cyan" },
  if: { label: "IF Condition", icon: "⑂", color: "orange" },
  merge: { label: "Merge", icon: "⇄", color: "green" },
  wait: { label: "Wait", icon: "◷", color: "orange" },
  log: { label: "Log / Output", icon: "▤", color: "slate" }
};

export function validateWorkflow(workflow) {
  const errors = [];
  if (!workflow || typeof workflow !== "object") return ["Workflow must be an object."];
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) errors.push("Add at least one node.");
  if (!Array.isArray(workflow.edges)) errors.push("Edges must be an array.");
  const ids = new Set();
  for (const node of workflow.nodes || []) {
    if (!node.id || ids.has(node.id)) errors.push("Every node must have a unique id.");
    ids.add(node.id);
    if (!NODE_TYPES[node.type]) errors.push(`Node ${node.id || "(missing id)"} uses an unsupported type.`);
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) errors.push(`Node ${node.id} has invalid canvas coordinates.`);
  }
  for (const edge of workflow.edges || []) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push(`Connection ${edge.id || ""} refers to a missing node.`);
    if (edge.source === edge.target) errors.push("A node cannot connect to itself.");
  }
  return [...new Set(errors)];
}

function getPath(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((value, key) => value == null ? undefined : value[key], obj);
}

function outgoing(edges, nodeId, branch) {
  return edges.filter(edge => edge.source === nodeId && (!branch || !edge.sourceHandle || edge.sourceHandle === branch));
}

function interpolate(value, context) {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path) => {
    const found = getPath(context, path.trim());
    return found == null ? "" : typeof found === "object" ? JSON.stringify(found) : String(found);
  });
}

export async function executeWorkflow(workflow, options = {}) {
  const errors = validateWorkflow(workflow);
  if (errors.length) throw new Error(errors.join(" "));
  const now = new Date().toISOString();
  const maxSteps = Math.min(Math.max(options.maxSteps || 100, 1), 500);
  const nodeMap = new Map(workflow.nodes.map(node => [node.id, node]));
  const startNodes = workflow.nodes.filter(node => node.type === "manual" || !workflow.edges.some(edge => edge.target === node.id));
  if (!startNodes.length) throw new Error("No trigger or root node found.");
  const outputs = {};
  const nodeRuns = [];
  const queue = startNodes.map(node => ({ nodeId: node.id, input: options.input ?? {}, path: [] }));
  let steps = 0;
  while (queue.length) {
    if (++steps > maxSteps) throw new Error("Execution step limit reached. Check for loops or excessive branches.");
    const job = queue.shift();
    if (job.path.includes(job.nodeId)) throw new Error("Cycle detected. Loops are not supported by this demo executor.");
    const node = nodeMap.get(job.nodeId);
    if (!node) continue;
    const startedAt = Date.now();
    let value = job.input;
    let branch;
    let status = "success";
    let message = "Completed";
    try {
      const config = node.config || {};
      switch (node.type) {
        case "manual":
          value = job.input;
          break;
        case "set": {
          const base = config.keepInput === false ? {} : (job.input && typeof job.input === "object" && !Array.isArray(job.input) ? { ...job.input } : { input: job.input });
          const fields = config.fields && typeof config.fields === "object" ? config.fields : {};
          for (const [key, fieldValue] of Object.entries(fields)) {
            if (key.trim()) base[key] = typeof fieldValue === "string" ? interpolate(fieldValue, { ...job.input, ...base }) : fieldValue;
          }
          value = base;
          break;
        }
        case "http": {
          const url = interpolate(config.url || "", job.input);
          if (!/^https?:\/\//i.test(url)) throw new Error("HTTP Request needs a valid http:// or https:// URL.");
          if (typeof fetch !== "function") throw new Error("Fetch is not available in this runtime.");
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(config.timeoutMs) || 10000, 1000), 30000));
          try {
            const response = await fetch(url, {
              method: String(config.method || "GET").toUpperCase(),
              headers: config.headers && typeof config.headers === "object" ? config.headers : {},
              body: ["GET", "HEAD"].includes(String(config.method || "GET").toUpperCase()) ? undefined : (config.body ? interpolate(config.body, job.input) : undefined),
              signal: controller.signal
            });
            const text = await response.text();
            let body;
            try { body = text ? JSON.parse(text) : null; } catch { body = text; }
            value = { status: response.status, ok: response.ok, headers: Object.fromEntries(response.headers.entries()), body };
            if (!response.ok) message = `HTTP ${response.status}`;
          } finally { clearTimeout(timer); }
          break;
        }
        case "if": {
          const actual = getPath(job.input, config.field || "");
          const expected = config.value;
          const op = config.operator || "equals";
          const match = op === "exists" ? actual !== undefined && actual !== null
            : op === "not-empty" ? actual !== undefined && actual !== null && actual !== ""
            : op === "contains" ? String(actual ?? "").includes(String(expected ?? ""))
            : op === "greater-than" ? Number(actual) > Number(expected)
            : op === "less-than" ? Number(actual) < Number(expected)
            : op === "not-equals" ? String(actual) !== String(expected)
            : String(actual) === String(expected);
          branch = match ? "true" : "false";
          value = { ...((job.input && typeof job.input === "object" && !Array.isArray(job.input)) ? job.input : { value: job.input }), condition: { field: config.field, operator: op, actual, expected, matched: match } };
          break;
        }
        case "merge": {
          const incoming = workflow.edges.filter(edge => edge.target === node.id).map(edge => outputs[edge.source]).filter(item => item !== undefined);
          value = incoming.length ? Object.assign({}, ...incoming.filter(item => item && typeof item === "object")) : job.input;
          break;
        }
        case "wait": {
          const ms = Math.min(Math.max(Number(config.ms) || 0, 0), 1000);
          if (ms) await new Promise(resolve => setTimeout(resolve, ms));
          value = job.input;
          break;
        }
        case "log":
          value = job.input;
          message = "Output captured";
          break;
        default:
          throw new Error(`Unsupported node type: ${node.type}`);
      }
    } catch (error) {
      status = "error";
      message = error instanceof Error ? error.message : String(error);
      nodeRuns.push({ nodeId: node.id, name: node.name, type: node.type, status, message, durationMs: Date.now() - startedAt, input: job.input, output: null });
      throw Object.assign(new Error(`${node.name}: ${message}`), { nodeRuns });
    }
    outputs[node.id] = value;
    nodeRuns.push({ nodeId: node.id, name: node.name, type: node.type, status, message, durationMs: Date.now() - startedAt, input: job.input, output: value });
    let next = outgoing(workflow.edges, node.id, branch);
    if (node.type === "if") next = workflow.edges.filter(edge => edge.source === node.id && (edge.sourceHandle === branch || (!edge.sourceHandle && !branch)));
    for (const edge of next) queue.push({ nodeId: edge.target, input: value, path: [...job.path, node.id] });
  }
  return { id: `run_${Date.now().toString(36)}`, status: nodeRuns.some(run => run.status === "error") ? "error" : "success", startedAt: now, finishedAt: new Date().toISOString(), nodeRuns, output: nodeRuns.at(-1)?.output ?? options.input ?? {} };
}

export function createDefaultWorkflow() {
  return {
    id: "wf_welcome",
    name: "My first workflow",
    active: false,
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: "trigger_1", type: "manual", name: "Manual Trigger", x: 90, y: 180, config: {} },
      { id: "set_1", type: "set", name: "Edit Fields", x: 390, y: 180, config: { fields: { message: "Hello from e11e", environment: "demo" } } },
      { id: "log_1", type: "log", name: "Output", x: 690, y: 180, config: {} }
    ],
    edges: [
      { id: "edge_1", source: "trigger_1", target: "set_1" },
      { id: "edge_2", source: "set_1", target: "log_1" }
    ]
  };
}
