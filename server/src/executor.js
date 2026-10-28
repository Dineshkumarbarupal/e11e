import { executeSecureHttpRequest, assertCredentialHeader } from "./secure-http.js";

function pathValue(value, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((current, key) => current == null ? undefined : current[key], value);
}
function interpolate(value, context) {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path) => {
    const item = pathValue(context, path.trim());
    return item == null ? "" : typeof item === "object" ? JSON.stringify(item) : String(item);
  });
}

export async function executeWorkflowDefinition(workflow, options = {}) {
  const nodeById = new Map(workflow.nodes.map(node => [node.id, node]));
  const edgeList = workflow.edges || [];
  const manualNodes = workflow.nodes.filter(node => node.type === "manual");
  const startNodes = options.triggerNodeId ? [nodeById.get(options.triggerNodeId)].filter(Boolean) : manualNodes.length ? manualNodes : workflow.nodes.filter(node => !edgeList.some(edge => edge.target === node.id));
  if (!startNodes.length) throw new Error("No root trigger node found.");
  const outputs = new Map();
  const nodeRuns = [];
  const queue = startNodes.map(node => ({ id: node.id, input: options.input || {}, ancestors: [] }));
  const maxSteps = Math.min(Math.max(Number(options.maxSteps) || 100, 1), 500);
  while (queue.length) {
    if (nodeRuns.length >= maxSteps) throw Object.assign(new Error("Execution step budget exceeded."), { nodeRuns });
    const task = queue.shift();
    if (task.ancestors.includes(task.id)) throw Object.assign(new Error("Execution cycle detected."), { nodeRuns });
    const node = nodeById.get(task.id);
    if (!node) continue;
    const start = Date.now();
    let output = task.input;
    let branch = null;
    let status = "success";
    let message = "Completed";
    try {
      const config = node.config || {};
      switch (node.type) {
        case "manual":
        case "webhook":
        case "schedule":
          output = task.input;
          break;
        case "set": {
          const incoming = task.input && typeof task.input === "object" && !Array.isArray(task.input) ? task.input : { value: task.input };
          output = config.keepInput === false ? {} : { ...incoming };
          for (const [key, value] of Object.entries(config.fields || {})) {
            if (key) output[key] = typeof value === "string" ? interpolate(value, { ...incoming, ...output }) : value;
          }
          break;
        }
        case "if": {
          const actual = pathValue(task.input, config.field || "");
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
          output = { ...(task.input && typeof task.input === "object" && !Array.isArray(task.input) ? task.input : { value: task.input }), condition: { field: config.field, operator: op, matched: match } };
          break;
        }
        case "merge": {
          const incoming = edgeList.filter(edge => edge.target === node.id).map(edge => outputs.get(edge.source)).filter(value => value !== undefined && value && typeof value === "object");
          output = Object.assign({}, ...incoming);
          break;
        }
        case "wait": {
          const delay = Math.min(Math.max(Number(config.ms) || 0, 0), 1000);
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          output = task.input;
          break;
        }
        case "log":
          output = task.input;
          message = "Output captured";
          break;
        case "http": {
          const url = interpolate(config.url || "", task.input);
          const method = String(config.method || "GET").toUpperCase();
          const headers = {};
          for (const [name, rawValue] of Object.entries(config.headers && typeof config.headers === "object" && !Array.isArray(config.headers) ? config.headers : {})) {
            headers[name] = typeof rawValue === "string" ? interpolate(rawValue, task.input) : rawValue;
          }
          let credentialHeader = null;
          if (config.credentialId) {
            if (typeof options.resolveCredential !== "function") throw new Error("Credential references require workspace-scoped credential resolution.");
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(config.credentialId))) {
              throw new Error("Credential ID must be a valid UUID.");
            }
            const credential = await options.resolveCredential(String(config.credentialId));
            const fieldPath = String(config.credentialField || "token");
            const secret = pathValue(credential, fieldPath);
            if (typeof secret !== "string" && typeof secret !== "number") throw new Error("The configured credential field was not found or was not a string/number.");
            const headerName = String(config.credentialHeader || "Authorization");
            const prefix = config.credentialPrefix == null ? "Bearer" : String(config.credentialPrefix);
            const headerValue = prefix ? prefix + " " + String(secret) : String(secret);
            assertCredentialHeader(headerName, headerValue);
            credentialHeader = { name: headerName, value: headerValue };
          }
          const body = ["GET", "HEAD"].includes(method) ? undefined : (config.body ? interpolate(config.body, task.input) : undefined);
          const secureRequest = options.executeHttpRequest || executeSecureHttpRequest;
          value = await secureRequest(
            { url, method, headers, body, timeoutMs: config.timeoutMs, credentialHeader },
            { allowedHosts: options.allowedHosts || [] }
          );
          if (!value.ok) throw new Error("Server HTTP request returned status " + value.status + ".");
          message = "HTTPS request completed";
          break;
        }
        default:
          throw new Error(`Unsupported node type: ${node.type}`);
      }
      outputs.set(node.id, output);
      nodeRuns.push({ nodeId: node.id, name: node.name, type: node.type, status, message, durationMs: Date.now() - start, input: task.input, output });
      let nextEdges = edgeList.filter(edge => edge.source === node.id);
      if (node.type === "if") nextEdges = nextEdges.filter(edge => edge.sourceHandle === branch);
      for (const edge of nextEdges) queue.push({ id: edge.target, input: output, ancestors: [...task.ancestors, node.id] });
    } catch (error) {
      status = "error";
      message = error instanceof Error ? error.message : String(error);
      nodeRuns.push({ nodeId: node.id, name: node.name, type: node.type, status, message, durationMs: Date.now() - start, input: task.input, output: null });
      throw Object.assign(new Error(`${node.name}: ${message}`), { nodeRuns });
    }
  }
  return { status: "success", output: nodeRuns.at(-1)?.output ?? options.input ?? {}, nodeRuns };
}
