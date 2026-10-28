import { z } from "zod";
import { isValidCronExpression } from "./cron-schedule.js";

const nodeTypes = ["manual", "webhook", "schedule", "set", "http", "if", "merge", "wait", "log"];
const nodeSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.enum(nodeTypes),
  name: z.string().min(1).max(200),
  x: z.number().finite().min(0).max(100000),
  y: z.number().finite().min(0).max(100000),
  config: z.record(z.unknown()).default({})
}).strict();
const edgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string().min(1).max(128),
  target: z.string().min(1).max(128),
  sourceHandle: z.enum(["true", "false"]).optional()
}).strict();

export const workflowSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  name: z.string().min(1).max(200),
  active: z.boolean().default(false),
  nodes: z.array(nodeSchema).min(1).max(500),
  edges: z.array(edgeSchema).max(2000)
}).strict().superRefine((flow, ctx) => {
  const ids = new Set();
  const byId = new Map();
  for (const [nodeIndex, node] of flow.nodes.entries()) {
    if (node.type === "schedule" && !isValidCronExpression(node.config?.cron || "")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "config", "cron"], message: "Schedule Trigger requires a valid five-field UTC cron expression." });
    if (node.type === "webhook" && node.config?.requireSignature !== undefined && typeof node.config.requireSignature !== "boolean") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "config", "requireSignature"], message: "Webhook requireSignature must be a boolean." });
    if (node.type === "http" && node.config?.credentialId != null && !z.string().uuid().safeParse(node.config.credentialId).success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", nodeIndex, "config", "credentialId"], message: "HTTP credentialId must be a UUID from the configured workspace credential vault." });
    if (ids.has(node.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: `Duplicate node id: ${node.id}` });
    ids.add(node.id);
    byId.set(node.id, node);
  }
  const adjacency = new Map(flow.nodes.map(node => [node.id, []]));
  const edgeIds = new Set();
  for (const [index, edge] of flow.edges.entries()) {
    if (edgeIds.has(edge.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", index], message: "Duplicate edge id." });
    edgeIds.add(edge.id);
    if (!ids.has(edge.source) || !ids.has(edge.target)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", index], message: "Connection references a missing node." });
    if (edge.source === edge.target) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", index], message: "Self-connections are not allowed." });
    if (["manual", "webhook", "schedule"].includes(byId.get(edge.target)?.type)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", index, "target"], message: "Trigger nodes cannot have incoming connections." });
    if (edge.sourceHandle && byId.get(edge.source)?.type !== "if") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", index], message: "Branch handles can only originate from IF nodes." });
    if (adjacency.has(edge.source) && ids.has(edge.target)) adjacency.get(edge.source).push(edge.target);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const child of adjacency.get(id) || []) if (visit(child)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  for (const node of flow.nodes) {
    if (visit(node.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges"], message: "Cycles are not supported in the server MVP." });
      break;
    }
  }
});

export const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128)
});
export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(1).max(128)
});
export const credentialSchema = z.object({
  name: z.string().trim().min(1).max(120),
  service: z.string().trim().min(1).max(120),
  secret: z.record(z.unknown())
});
