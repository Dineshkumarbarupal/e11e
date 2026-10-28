import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { redis } from "./redis.js";
import { encryptSecret } from "./crypto.js";
import { workflowSchema, registerSchema, loginSchema, credentialSchema } from "./schemas.js";

const workspaceNameSchema = z.object({ name: z.string().trim().min(1).max(120) });
const runSchema = z.object({ input: z.record(z.unknown()).default({}) });
const uuidSchema = z.string().uuid();

function validationReply(reply, issues) {
  return reply.code(422).send({ error: "Validation failed", details: issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) });
}
function safeUser(row) { return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at }; }
function workflowDTO(row) {
  const definition = typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition;
  return { ...definition, id: row.id, name: row.name, active: row.active, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}
async function audit(db, { workspaceId, userId, action, resourceType, resourceId = null, metadata = {} }) {
  await db.query(
    "INSERT INTO audit_logs(id, workspace_id, user_id, action, resource_type, resource_id, metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [randomUUID(), workspaceId, userId, action, resourceType, resourceId, JSON.stringify(metadata)]
  );
}

export async function buildApp(overrides = {}) {
  const db = overrides.pool || pool;
  const queue = overrides.queue;
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
    bodyLimit: 1024 * 1024,
    trustProxy: false
  });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.CORS_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by CORS"), false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type"],
    maxAge: 600
  });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: "1 minute" });
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: "30m" } });
  app.decorate("authenticate", async function authenticate(request, reply) {
    try { await request.jwtVerify(); }
    catch { return reply.code(401).send({ error: "Authentication required." }); }
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, route: request.routeOptions?.url }, "Request failed");
    if (error.statusCode === 413) return reply.code(413).send({ error: "Request body is too large." });
    if (error.message === "Origin is not allowed by CORS") return reply.code(403).send({ error: "Origin is not allowed." });
    return reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500)
      .send({ error: error.statusCode && error.statusCode < 500 ? error.message : "Internal server error." });
  });

  app.get("/healthz", async () => ({ status: "ok", service: "e11e-flow-api" }));
  app.get("/readyz", async (_request, reply) => {
    try {
      await db.query("SELECT 1");
      if (overrides.skipRedisCheck !== true) await redis.ping();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not-ready" });
    }
  });

  app.post("/api/auth/register", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return validationReply(reply, parsed.error.issues);
    const { email, name, password } = parsed.data;
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) RETURNING id,email,name,created_at",
        [userId, email, name, passwordHash]
      );
      await client.query("INSERT INTO workspaces(id,name,owner_id) VALUES($1,$2,$3)", [workspaceId, `${name}'s workspace`, userId]);
      await client.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner')", [workspaceId, userId]);
      await client.query("INSERT INTO audit_logs(id,workspace_id,user_id,action,resource_type,resource_id) VALUES($1,$2,$3,'auth.register','user',$3)", [randomUUID(), workspaceId, userId]);
      await client.query("COMMIT");
      const user = safeUser(created.rows[0]);
      const token = app.jwt.sign({ sub: user.id, email: user.email });
      return reply.code(201).send({ token, user, workspace: { id: workspaceId, name: `${name}'s workspace`, role: "owner" } });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") return reply.code(409).send({ error: "An account with that email already exists." });
      throw error;
    } finally { client.release(); }
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return validationReply(reply, parsed.error.issues);
    const found = await db.query("SELECT id,email,name,password_hash,created_at FROM users WHERE email=$1", [parsed.data.email]);
    const userRow = found.rows[0];
    const ok = userRow ? await bcrypt.compare(parsed.data.password, userRow.password_hash) : false;
    if (!ok) return reply.code(401).send({ error: "Invalid email or password." });
    const user = safeUser(userRow);
    const workspaces = await db.query(
      "SELECT w.id,w.name,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at",
      [user.id]
    );
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return { token, user, workspaces: workspaces.rows.map(row => ({ id: row.id, name: row.name, role: row.role })) };
  });

  app.get("/api/me", { preHandler: [app.authenticate] }, async request => {
    const result = await db.query("SELECT id,email,name,created_at FROM users WHERE id=$1", [request.user.sub]);
    if (!result.rows[0]) return { error: "User not found." };
    return { user: safeUser(result.rows[0]) };
  });

  app.get("/api/workspaces", { preHandler: [app.authenticate] }, async request => {
    const result = await db.query(
      "SELECT w.id,w.name,m.role,w.created_at FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at",
      [request.user.sub]
    );
    return { workspaces: result.rows.map(row => ({ id: row.id, name: row.name, role: row.role, createdAt: row.created_at })) };
  });

  app.post("/api/workspaces", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = workspaceNameSchema.safeParse(request.body);
    if (!parsed.success) return validationReply(reply, parsed.error.issues);
    const workspaceId = randomUUID();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO workspaces(id,name,owner_id) VALUES($1,$2,$3)", [workspaceId, parsed.data.name, request.user.sub]);
      await client.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner')", [workspaceId, request.user.sub]);
      await audit(client, { workspaceId, userId: request.user.sub, action: "workspace.create", resourceType: "workspace", resourceId: workspaceId });
      await client.query("COMMIT");
      return reply.code(201).send({ id: workspaceId, name: parsed.data.name, role: "owner" });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  async function requireMember(request, reply, write = false) {
    const workspaceId = uuidSchema.safeParse(request.params.workspaceId);
    if (!workspaceId.success) { reply.code(400).send({ error: "Invalid workspace id." }); return null; }
    const result = await db.query("SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [workspaceId.data, request.user.sub]);
    if (!result.rows[0]) { reply.code(404).send({ error: "Workspace not found." }); return null; }
    if (write && result.rows[0].role === "viewer") { reply.code(403).send({ error: "Viewer role cannot modify this resource." }); return null; }
    return { id: workspaceId.data, role: result.rows[0].role };
  }

  app.get("/api/workspaces/:workspaceId/workflows", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply);
    if (!member) return;
    const result = await db.query("SELECT * FROM workflows WHERE workspace_id=$1 ORDER BY updated_at DESC", [member.id]);
    return { workflows: result.rows.map(workflowDTO) };
  });

  app.post("/api/workspaces/:workspaceId/workflows", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply, true);
    if (!member) return;
    const parsed = workflowSchema.safeParse(request.body);
    if (!parsed.success) return validationReply(reply, parsed.error.issues);
    const workflowId = randomUUID();
    const definition = { ...parsed.data, id: workflowId };
    const inserted = await db.query(
      "INSERT INTO workflows(id,workspace_id,name,active,definition,created_by,updated_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6) RETURNING *",
      [workflowId, member.id, definition.name, definition.active, JSON.stringify(definition), request.user.sub]
    );
    await audit(db, { workspaceId: member.id, userId: request.user.sub, action: "workflow.create", resourceType: "workflow", resourceId: workflowId });
    return reply.code(201).send({ workflow: workflowDTO(inserted.rows[0]) });
  });

  app.get("/api/workspaces/:workspaceId/workflows/:workflowId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply);
    if (!member) return;
    const id = uuidSchema.safeParse(request.params.workflowId);
    if (!id.success) return reply.code(400).send({ error: "Invalid workflow id." });
    const result = await db.query("SELECT * FROM workflows WHERE workspace_id=$1 AND id=$2", [member.id, id.data]);
    if (!result.rows[0]) return reply.code(404).send({ error: "Workflow not found." });
    return { workflow: workflowDTO(result.rows[0]) };
  });

  app.put("/api/workspaces/:workspaceId/workflows/:workflowId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply, true);
    if (!member) return;
    const id = uuidSchema.safeParse(request.params.workflowId);
    if (!id.success) return reply.code(400).send({ error: "Invalid workflow id." });
    const parsed = workflowSchema.safeParse(request.body);
    if (!parsed.success) return validationReply(reply, parsed.error.issues);
    const definition = { ...parsed.data, id: id.data };
    const updated = await db.query(
      "UPDATE workflows SET name=$3,active=$4,definition=$5::jsonb,version=version+1,updated_by=$6,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *",
      [member.id, id.data, definition.name, definition.active, JSON.stringify(definition), request.user.sub]
    );
    if (!updated.rows[0]) return reply.code(404).send({ error: "Workflow not found." });
    await audit(db, { workspaceId: member.id, userId: request.user.sub, action: "workflow.update", resourceType: "workflow", resourceId: id.data, metadata: { version: updated.rows[0].version } });
    return { workflow: workflowDTO(updated.rows[0]) };
  });

  app.delete("/api/workspaces/:workspaceId/workflows/:workflowId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply, true);
    if (!member) return;
    const id = uuidSchema.safeParse(request.params.workflowId);
    if (!id.success) return reply.code(400).send({ error: "Invalid workflow id." });
    const deleted = await db.query("DELETE FROM workflows WHERE workspace_id=$1 AND id=$2 RETURNING id", [member.id, id.data]);
    if (!deleted.rows[0]) return reply.code(404).send({ error: "Workflow not found." });
    await audit(db, { workspaceId: member.id, userId: request.user.sub, action: "workflow.delete", resourceType: "workflow", resourceId: id.data });
    return reply.code(204).send();
  });

  app.post("/api/workspaces/:workspaceId/workflows/:workflowId/executions", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply, true);
    if (!member) return;
    const id = uuidSchema.safeParse(request.params.workflowId);
    if (!id.success) return reply.code(400).send({ error: "Invalid workflow id." });
    const parsed = runSchema.safeParse(request.body || {});
    if (!parsed.success) return validationReply(reply, parsed.error.issues);
    const wf = await db.query("SELECT id FROM workflows WHERE workspace_id=$1 AND id=$2", [member.id, id.data]);
    if (!wf.rows[0]) return reply.code(404).send({ error: "Workflow not found." });
    if (!queue) return reply.code(503).send({ error: "Execution queue is unavailable." });
    const executionId = randomUUID();
    await db.query("INSERT INTO executions(id,workspace_id,workflow_id,status,input) VALUES($1,$2,$3,'queued',$4::jsonb)", [executionId, member.id, id.data, JSON.stringify(parsed.data.input)]);
    try {
      await queue.add("execute", { executionId }, { jobId: executionId, attempts: 2, backoff: { type: "exponential", delay: 1500 }, removeOnComplete: 200, removeOnFail: 1000 });
    } catch {
      await db.query("UPDATE executions SET status='error',error='Unable to enqueue execution',finished_at=now() WHERE id=$1", [executionId]);
      return reply.code(503).send({ error: "Unable to enqueue execution. Check Redis availability." });
    }
    await audit(db, { workspaceId: member.id, userId: request.user.sub, action: "execution.queued", resourceType: "execution", resourceId: executionId, metadata: { workflowId: id.data } });
    return reply.code(202).send({ execution: { id: executionId, status: "queued" } });
  });

  app.get("/api/workspaces/:workspaceId/executions", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply);
    if (!member) return;
    const result = await db.query("SELECT id,workflow_id,status,error,queued_at,started_at,finished_at FROM executions WHERE workspace_id=$1 ORDER BY queued_at DESC LIMIT 100", [member.id]);
    return { executions: result.rows.map(row => ({ id: row.id, workflowId: row.workflow_id, status: row.status, error: row.error, queuedAt: row.queued_at, startedAt: row.started_at, finishedAt: row.finished_at })) };
  });

  app.get("/api/workspaces/:workspaceId/executions/:executionId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply);
    if (!member) return;
    const id = uuidSchema.safeParse(request.params.executionId);
    if (!id.success) return reply.code(400).send({ error: "Invalid execution id." });
    const result = await db.query("SELECT id,workflow_id,status,input,output,node_runs,error,queued_at,started_at,finished_at FROM executions WHERE workspace_id=$1 AND id=$2", [member.id, id.data]);
    const row = result.rows[0];
    if (!row) return reply.code(404).send({ error: "Execution not found." });
    return { execution: { id: row.id, workflowId: row.workflow_id, status: row.status, input: row.input, output: row.output, nodeRuns: row.node_runs, error: row.error, queuedAt: row.queued_at, startedAt: row.started_at, finishedAt: row.finished_at } };
  });

  app.get("/api/workspaces/:workspaceId/credentials", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply);
    if (!member) return;
    const result = await db.query("SELECT id,name,service,created_at,updated_at FROM credentials WHERE workspace_id=$1 ORDER BY created_at DESC", [member.id]);
    return { credentials: result.rows.map(row => ({ id: row.id, name: row.name, service: row.service, createdAt: row.created_at, updatedAt: row.updated_at })) };
  });

  app.post("/api/workspaces/:workspaceId/credentials", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply, true);
    if (!member) return;
    const parsed = credentialSchema.safeParse(request.body);
    if (!parsed.success) return validationReply(reply, parsed.error.issues);
    const id = randomUUID();
    try {
      const saved = await db.query("INSERT INTO credentials(id,workspace_id,name,service,encrypted_payload,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id,name,service,created_at,updated_at", [id, member.id, parsed.data.name, parsed.data.service, JSON.stringify(encryptSecret(parsed.data.secret)), request.user.sub]);
      await audit(db, { workspaceId: member.id, userId: request.user.sub, action: "credential.create", resourceType: "credential", resourceId: id, metadata: { service: parsed.data.service } });
      return reply.code(201).send({ credential: saved.rows[0] });
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "A credential with that name already exists in this workspace." });
      throw error;
    }
  });

  app.delete("/api/workspaces/:workspaceId/credentials/:credentialId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply, true);
    if (!member) return;
    const id = uuidSchema.safeParse(request.params.credentialId);
    if (!id.success) return reply.code(400).send({ error: "Invalid credential id." });
    const result = await db.query("DELETE FROM credentials WHERE workspace_id=$1 AND id=$2 RETURNING id", [member.id, id.data]);
    if (!result.rows[0]) return reply.code(404).send({ error: "Credential not found." });
    await audit(db, { workspaceId: member.id, userId: request.user.sub, action: "credential.delete", resourceType: "credential", resourceId: id.data });
    return reply.code(204).send();
  });

  app.get("/api/workspaces/:workspaceId/audit-logs", { preHandler: [app.authenticate] }, async (request, reply) => {
    const member = await requireMember(request, reply);
    if (!member) return;
    if (!["owner", "admin"].includes(member.role)) return reply.code(403).send({ error: "Admin role is required for audit logs." });
    const result = await db.query("SELECT id,user_id,action,resource_type,resource_id,metadata,created_at FROM audit_logs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 200", [member.id]);
    return { auditLogs: result.rows.map(row => ({ id: row.id, userId: row.user_id, action: row.action, resourceType: row.resource_type, resourceId: row.resource_id, metadata: row.metadata, createdAt: row.created_at })) };
  });

  app.addHook("onClose", async () => {
    if (queue) await queue.close();
  });
  return app;
}
