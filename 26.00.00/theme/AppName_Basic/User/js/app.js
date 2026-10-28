import { NODE_TYPES, createDefaultWorkflow, executeWorkflow, validateWorkflow } from "./workflow-engine.js";

const STORE_KEY = "e11e.flow.workflows.v1";
const RUNS_KEY = "e11e.flow.runs.v1";
const API_KEY = "e11e.flow.api-connection.v1";
let apiConnection = readApiConnection();
const state = { page: "Overview", currentId: null, selectedNodeId: null, connectFrom: null, connectBranch: null, webhookSetup: null, runs: readRuns(), drag: null, zoom: 1, searchQuery: "", fitPending: false, testInput: JSON.stringify({ example: "hello from e11e", approved: true, user: { name: "Demo User", email: "demo@example.test" } }, null, 2) };

function readRuns() { try { return JSON.parse(localStorage.getItem(RUNS_KEY) || "[]"); } catch { return []; } }
function loadWorkflows() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  const first = createDefaultWorkflow();
  return [
    first,
    { id: "wf_leads", name: "Webhook lead intake demo", active: false, updatedAt: new Date().toISOString(), nodes: [{id:"w1",type:"webhook",name:"Webhook Trigger",x:100,y:130,config:{}},{id:"w2",type:"http",name:"Enrich Lead",x:410,y:130,config:{url:"https://api.example.com/leads",method:"GET",headers:{},timeoutMs:10000}},{id:"w3",type:"log",name:"CRM Output",x:720,y:130,config:{}}], edges:[{id:"we1",source:"w1",target:"w2"},{id:"we2",source:"w2",target:"w3"}]},
    { id: "wf_report", name: "Daily analytics draft (manual demo)", active: false, updatedAt: new Date().toISOString(), nodes: [{id:"r1",type:"manual",name:"Manual Trigger",x:100,y:130,config:{}},{id:"r2",type:"set",name:"Prepare Summary",x:410,y:130,config:{fields:{subject:"Daily report",status:"prepared"}}},{id:"r3",type:"log",name:"Report Output",x:720,y:130,config:{}}], edges:[{id:"re1",source:"r1",target:"r2"},{id:"re2",source:"r2",target:"r3"}]},
    { id: "wf_support", name: "Support ticket classifier demo", active: false, updatedAt: new Date().toISOString(), nodes: [{id:"s1",type:"manual",name:"Manual Trigger",x:100,y:130,config:{}},{id:"s2",type:"if",name:"Priority Check",x:410,y:130,config:{field:"priority",operator:"equals",value:"high"}},{id:"s3",type:"log",name:"Route Ticket",x:720,y:130,config:{}}], edges:[{id:"se1",source:"s1",target:"s2"},{id:"se2",source:"s2",target:"s3",sourceHandle:"true"}]}
  ];
}
let workflows = loadWorkflows();
function persist() { localStorage.setItem(STORE_KEY, JSON.stringify(workflows)); }

function readApiConnection() {
  try { return JSON.parse(sessionStorage.getItem(API_KEY) || "null"); } catch { return null; }
}
async function apiRequest(path, options = {}) {
  if (!apiConnection?.baseUrl || !apiConnection?.token) throw new Error("Connect to the e11e API in Settings first.");
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  headers.authorization = "Bearer " + apiConnection.token;
  const response = await fetch(apiConnection.baseUrl + path, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ("API request failed with status " + response.status));
  return data;
}
function workspaceApiPath() { return "/api/workspaces/" + encodeURIComponent(apiConnection.workspaceId); }
function workflowPayload(flow) { return { id: flow.id, name: flow.name, active: Boolean(flow.active), nodes: flow.nodes, edges: flow.edges, updatedAt: flow.updatedAt, version: flow.version }; }
async function syncFromServer(shouldRender = true) {
  const result = await apiRequest(workspaceApiPath() + "/workflows");
  if (Array.isArray(result.workflows) && result.workflows.length) {
    workflows = result.workflows;
    persist();
    if (!workflows.some(flow => flow.id === state.currentId)) state.currentId = workflows[0].id;
  }
  if (shouldRender) render();
  return result.workflows || [];
}
async function syncCurrentWorkflow(shouldRender = true) {
  const flow = currentWorkflow();
  const remote = await apiRequest(workspaceApiPath() + "/workflows");
  const exists = (remote.workflows || []).some(item => item.id === flow.id);
  const path = exists ? workspaceApiPath() + "/workflows/" + encodeURIComponent(flow.id) : workspaceApiPath() + "/workflows";
  const result = await apiRequest(path, { method: exists ? "PUT" : "POST", body: JSON.stringify(workflowPayload(flow)) });
  const saved = result.workflow;
  const index = workflows.findIndex(item => item === flow);
  if (index >= 0) workflows[index] = saved;
  state.currentId = saved.id;
  persist();
  if (shouldRender) render();
  return saved;
}
async function syncAllWorkflows() {
  const remote = await apiRequest(workspaceApiPath() + "/workflows");
  const remoteWorkflows = remote.workflows || [];
  const remoteIds = new Set(remoteWorkflows.map(flow => flow.id));
  const localIds = new Set(workflows.map(flow => flow.id));
  // Preserve remote-only workflows. "Push local" should update matching records,
  // not make unrelated server workflows disappear from the browser list.
  const synced = remoteWorkflows.filter(flow => !localIds.has(flow.id));
  for (const flow of workflows) {
    const exists = remoteIds.has(flow.id);
    const path = exists ? workspaceApiPath() + "/workflows/" + encodeURIComponent(flow.id) : workspaceApiPath() + "/workflows";
    const result = await apiRequest(path, { method: exists ? "PUT" : "POST", body: JSON.stringify(workflowPayload(flow)) });
    synced.push(result.workflow);
    remoteIds.add(result.workflow.id);
  }
  const previousId = state.currentId;
  workflows = synced;
  persist();
  state.currentId = synced.find(flow => flow.id === previousId)?.id || synced[0]?.id || null;
  render();
  toast("Synced " + synced.length + " workflow(s) with the server.");
}
async function generateWebhookToken() {
  if (!apiConnection) throw new Error("Connect to the API in Settings first.");
  const node = byId(state.selectedNodeId);
  if (!node || node.type !== "webhook") throw new Error("Select a Webhook Trigger node first.");
  const flow = await syncCurrentWorkflow(false);
  const result = await apiRequest(workspaceApiPath() + "/workflows/" + encodeURIComponent(flow.id) + "/nodes/" + encodeURIComponent(node.id) + "/webhook-token", { method: "POST", body: JSON.stringify({}) });
  state.webhookSetup = { workflowId: flow.id, nodeId: node.id, path: result.webhook.path, token: result.webhook.token };
  render();
  toast("Webhook token created. Copy it now; it is not stored in workflow JSON.");
}
async function queueServerExecution() {
  let input;
  try { input = JSON.parse(document.querySelector("#run-input")?.value || state.testInput || "{}"); if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Test input must be a JSON object."); }
  catch (error) { toast("Invalid test input: " + error.message); return; }
  const flow = await syncCurrentWorkflow(false);
  const result = await apiRequest(workspaceApiPath() + "/workflows/" + encodeURIComponent(flow.id) + "/executions", {
    method: "POST",
    body: JSON.stringify({ input })
  });
  toast("Server execution queued: " + result.execution.id);
}
function renderSettings() {
  const connection = apiConnection
    ? '<div class="notice"><b>Connected session:</b> ' + esc(apiConnection.email) + '<br>API: ' + esc(apiConnection.baseUrl) + '<br>Workspace: ' + esc(apiConnection.workspaceId) + '<br>Token is held in sessionStorage for this browser tab. The API JWT expires after 30 minutes.</div><div class="settings-actions"><button class="btn-quiet" id="pull-server">Pull workflows from server</button><button class="btn-primary" id="push-server">Push local workflows</button><button class="btn-quiet" id="disconnect-api">Disconnect session</button></div>'
    : '<div class="notice">Not connected. Use the browser-only editor without an API, or connect to a separately running e11e server.</div>';
  return '<div class="page-head"><div><div class="eyebrow">Workspace settings</div><h1>Server connection</h1><p>Sign in to the e11e API to sync workflow definitions and queue server-side test runs.</p></div></div><section class="panel settings-panel"><div class="panel-head"><div><h2>API connection</h2><p>For local development, the default API URL is http://127.0.0.1:8787.</p></div></div>' + connection + '<div class="settings-form"><label class="field-label">API base URL<input class="field-input" id="api-base" value="' + esc(apiConnection?.baseUrl || "http://127.0.0.1:8787") + '" placeholder="https://api.example.com"></label><label class="field-label">Name (required for account creation)<input class="field-input" id="api-name" placeholder="Your name"></label><label class="field-label">Email<input class="field-input" id="api-email" type="email" value="' + esc(apiConnection?.email || "") + '" placeholder="you@example.com"></label><label class="field-label">Password<input class="field-input" id="api-password" type="password" autocomplete="current-password" placeholder="At least 12 characters for registration"></label><div class="settings-actions"><button class="btn-primary" id="api-login">Sign in</button><button class="btn-quiet" id="api-register">Create account</button></div></div><div class="notice"><b>Security:</b> this UI stores the short-lived JWT in sessionStorage so it does not survive a browser-tab session. Do not use real business credentials in this prototype. Set CORS_ORIGINS to include the exact frontend origin.</div></section><section class="panel settings-panel"><div class="panel-head"><div><h2>Current deployment limits</h2><p>The browser editor remains usable without a server connection.</p></div></div><div class="info-block">Local test runs execute in the browser. Server-queued runs execute only supported safe nodes (Manual, Edit Fields, IF, Merge, Wait and Log). Server-side HTTP nodes remain disabled until outbound network security and credential references are implemented. Token-protected webhook triggers are available when the API is connected; schedule/cron triggers and the enterprise integration catalog are not implemented yet.</div></section>';
}
async function connectApi(mode) {
  let baseUrl = (document.querySelector("#api-base")?.value || "").trim();
  while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
  const email = (document.querySelector("#api-email")?.value || "").trim();
  const password = document.querySelector("#api-password")?.value || "";
  const name = (document.querySelector("#api-name")?.value || "").trim();
  if (!(baseUrl.startsWith("http://") || baseUrl.startsWith("https://"))) throw new Error("Enter an API base URL beginning with http:// or https://.");
  const payload = mode === "register" ? { email, name, password } : { email, password };
  if (mode === "register" && !name) throw new Error("Enter your name to create an account.");
  const response = await fetch(baseUrl + (mode === "register" ? "/api/auth/register" : "/api/auth/login"), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ("Sign-in failed with status " + response.status));
  const workspaceId = data.workspace?.id || data.workspaces?.[0]?.id;
  if (!workspaceId) throw new Error("The API account has no workspace.");
  apiConnection = { baseUrl, token: data.token, workspaceId, email: data.user?.email || email };
  sessionStorage.setItem(API_KEY, JSON.stringify(apiConnection));
  const remote = await syncFromServer(false);
  state.page = "Workflows";
  render();
  toast("Connected to the API. " + remote.length + " server workflow(s) found.");
}
function bindSettings() {
  document.querySelector("#api-login")?.addEventListener("click", async () => { try { await connectApi("login"); } catch (error) { toast(error.message); } });
  document.querySelector("#api-register")?.addEventListener("click", async () => { try { await connectApi("register"); } catch (error) { toast(error.message); } });
  document.querySelector("#pull-server")?.addEventListener("click", async () => { try { const result = await syncFromServer(); toast("Pulled " + result.length + " workflow(s)."); } catch (error) { toast(error.message); } });
  document.querySelector("#push-server")?.addEventListener("click", async () => { try { await syncAllWorkflows(); } catch (error) { toast(error.message); } });
  document.querySelector("#disconnect-api")?.addEventListener("click", () => { sessionStorage.removeItem(API_KEY); apiConnection = null; state.serverRuns = null; render(); toast("Disconnected this browser session. The server token will expire independently."); });
}
async function loadServerExecutions() {
  const result = await apiRequest(workspaceApiPath() + "/executions");
  state.serverRuns = result.executions || [];
  const target = document.querySelector("#server-executions");
  if (target) target.innerHTML = '<div class="server-runs-title">Server queue history (' + state.serverRuns.length + ')</div>' + (state.serverRuns.length ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>Execution</th><th>Workflow</th><th>Status</th><th>Queued</th></tr></thead><tbody>' + state.serverRuns.map(run => '<tr><td>' + esc(run.id) + '</td><td>' + esc(run.workflowId) + '</td><td>' + esc(run.status) + '</td><td>' + esc(run.queuedAt ? new Date(run.queuedAt).toLocaleString() : "") + '</td></tr>').join("") + '</tbody></table></div>' : '<div class="empty-state">No server executions yet.</div>');
}
function currentWorkflow() { return workflows.find(w => w.id === state.currentId) || workflows[0]; }
function byId(id) { return currentWorkflow().nodes.find(n => n.id === id); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function iconFor(type) { return NODE_TYPES[type]?.icon || "◇"; }
function toast(message) { const old = document.querySelector(".toast"); old?.remove(); const el = document.createElement("div"); el.className = "toast"; el.textContent = message; document.body.appendChild(el); setTimeout(() => el.remove(), 3000); }
function id(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 9); }
function navIcon(name) { return ({Overview:"◈",Workflows:"⌘",Executions:"◷",Integrations:"⧉",Credentials:"♢",Variables:"≋",Settings:"⚙",Documentation:"↗"})[name] || "◇"; }
function setPage(page) { state.page = page; state.connectFrom = null; state.connectBranch = null; render(); }
function openEditor(workflowId) { state.currentId = workflowId; state.selectedNodeId = null; state.page = "Editor"; state.connectFrom = null; state.connectBranch = null; state.fitPending = true; render(); }
function createWorkflow() {
  const workflow = createDefaultWorkflow();
  workflow.id = id("wf"); workflow.name = "Untitled workflow"; workflow.active = false;
  workflow.nodes = [{id:id("node"),type:"manual",name:"Manual Trigger",x:150,y:180,config:{}}];
  workflow.edges = [];
  workflows.unshift(workflow); persist(); openEditor(workflow.id);
}
function allCounts() {
  const runs = readRuns();
  return {flows:workflows.length, active:workflows.filter(w=>w.active).length, runs:runs.length, ok:runs.filter(r=>r.status==="success").length};
}
function renderDashboard() {
  const counts = allCounts();
  return `<div class="page-head"><div><div class="eyebrow">Workspace overview</div><h1>Your automations, at a glance <span style="color:#a69bff">✳</span></h1><p>Design workflows, run tests, and inspect each node's output from one workspace.</p></div><button class="btn-primary" id="create-workflow">＋ Create workflow</button></div>
  <div class="stats">
   <div class="stat-card"><div class="stat-head">Saved workflows <span class="stat-icon">⌘</span></div><div class="stat-value">${counts.flows}</div><div class="stat-foot">Stored in this browser</div></div>
   <div class="stat-card"><div class="stat-head">Active flags <span class="stat-icon">◉</span></div><div class="stat-value">${counts.active}</div><div class="stat-foot">Local demo only; no live triggers</div></div>
   <div class="stat-card"><div class="stat-head">Test executions <span class="stat-icon">✓</span></div><div class="stat-value">${counts.runs}</div><div class="stat-foot"><span class="positive">${counts.ok} successful</span> in this browser</div></div>
   <div class="stat-card"><div class="stat-head">Node types <span class="stat-icon">◇</span></div><div class="stat-value">${Object.keys(NODE_TYPES).length}</div><div class="stat-foot">Available in the local executor</div></div>
  </div>
  <div class="dashboard-grid">
   <section class="panel"><div class="panel-head"><div><h2>Workflow activity</h2><p>Latest local test runs</p></div><button class="text-link" data-page="Executions">View executions →</button></div>
    <div class="mini-activity">${readRuns().slice(0,5).map(r=>`<div class="activity-item"><div class="activity-icon ${r.status==="error"?"warn":""}">${r.status==="success"?"✓":"!"}</div><div><div class="activity-title">${esc(r.workflowName||"Workflow run")}</div><div class="activity-desc">${esc(r.status)} · ${Number(r.nodeRuns?.length||0)} node steps</div><div class="activity-time">${esc(new Date(r.startedAt).toLocaleString())}</div></div></div>`).join("") || '<div class="empty-state">No test executions yet. Open a workflow and click <b>Test workflow</b>.</div>'}</div>
    <div class="notice"><b>Local-first prototype:</b> workflows and run history persist in this browser's local storage. Metrics are calculated from your local data, not a central production service.</div>
   </section>
   <section class="panel"><div class="panel-head"><div><h2>Start with a template</h2><p>Open an editable workflow</p></div></div><div class="quick-grid"><button class="quick-card" data-template="webhook"><div class="qicon">↗</div><strong>Webhook intake</strong><span>Trigger → HTTP request → output</span></button><button class="quick-card" data-template="conditional"><div class="qicon">⑂</div><strong>Conditional routing</strong><span>Split flow using an IF node</span></button><button class="quick-card" data-template="data"><div class="qicon">✎</div><strong>Data transform</strong><span>Set fields then inspect output</span></button></div></section>
  </div>
  <div class="bottom-grid"><section class="panel"><div class="panel-head"><div><h2>Recent workflows</h2><p>Saved in this browser</p></div><button class="text-link" data-page="Workflows">See all →</button></div><div class="workflow-list">${workflows.slice(0,5).map(w=>`<button class="workflow-row clickable-row" data-open="${esc(w.id)}"><span class="wf-icon">⌘</span><span><span class="wf-name">${esc(w.name)}</span><span class="wf-meta">${w.nodes.length} nodes · Updated ${esc(new Date(w.updatedAt).toLocaleString())}</span></span><span class="status ${w.active?"":"paused"}">${w.active?"Active flag":"Inactive"}</span></button>`).join("")}</div></section>
   <section class="panel"><div class="panel-head"><div><h2>Available nodes</h2><p>Supported in local execution mode</p></div></div><div class="node-catalog-mini">${Object.entries(NODE_TYPES).map(([type,n])=>`<div><span class="wf-icon">${n.icon}</span><span><b>${n.label}</b><small>${({manual:"Starts a manual test",set:"Add or change fields",http:"Fetch an HTTP endpoint",if:"Route true/false branches",merge:"Combine object inputs",wait:"Short bounded delay",log:"Capture an output value"})[type]}</small></span></div>`).join("")}</div></section>
  </div><div class="footer"><span>e11e Flow · Automation Studio</span><span>Local prototype · No background workers or live triggers</span></div>`;
}
function renderWorkflows() {
 return `<div class="page-head"><div><div class="eyebrow">Automation library</div><h1>Workflows</h1><p>Create, edit, export and test your workflows. Saved locally to this browser.</p></div><button class="btn-primary" id="create-workflow">＋ Create workflow</button></div>
 <section class="panel"><div class="panel-head"><div><h2>All workflows</h2><p>${workflows.length} saved workflow definitions</p></div><button class="btn-quiet" id="export-all">Export all JSON</button><button class="btn-quiet" id="sync-server">↻ Sync with server</button><label class="btn-quiet file-label">Import JSON<input type="file" id="import-all" accept="application/json,.json" hidden></label></div>
 <label class="workflow-filter-label"><span>FILTER WORKFLOWS</span><input class="field-input workflow-filter" id="workflow-filter" type="search" value="${esc(state.searchQuery)}" placeholder="Search by name or ID" aria-label="Filter workflows"></label><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Nodes</th><th>Status</th><th>Last updated</th><th>Actions</th></tr></thead><tbody>${workflows.map(w=>`<tr><td><button class="table-title" data-open="${esc(w.id)}">${esc(w.name)}</button><small class="table-sub">${esc(w.id)}</small></td><td>${w.nodes.length}</td><td><span class="status ${w.active?"":"paused"}">${w.active?"Active flag":"Inactive"}</span></td><td>${esc(new Date(w.updatedAt).toLocaleString())}</td><td><button class="btn-quiet btn-small" data-open="${esc(w.id)}">Edit</button> <button class="btn-quiet btn-small" data-delete="${esc(w.id)}">Delete</button></td></tr>`).join("")}</tbody></table></div><div id="workflow-filter-empty" class="empty-state" hidden>No workflows match this search.</div></section>
 <div class="notice">Activation is a local UI flag; it does not itself start a background listener. Token-protected webhooks work when the API and worker are configured. Schedule/cron triggers, collaboration and continuous server sync are not available yet.</div>`;
}
function renderExecutions() {
 const runs=readRuns();
 return `<div class="page-head"><div><div class="eyebrow">Observability</div><h1>Execution history</h1><p>Inspect node-by-node results from local test runs.</p></div><button class="btn-quiet" id="clear-runs">Clear history</button></div><section class="panel"><div class="panel-head"><div><h2>Recent test runs</h2><p>${runs.length} local run records</p></div><button class="btn-quiet" id="export-runs">Export JSON</button>${apiConnection?'<button class="btn-quiet" id="load-server-runs">Load server runs</button>':""}</div>
 ${runs.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>Run</th><th>Workflow</th><th>Status</th><th>Steps</th><th>Started</th><th></th></tr></thead><tbody>'+runs.map(r=>`<tr><td>${esc(r.id)}</td><td>${esc(r.workflowName||"Workflow")}</td><td><span class="status ${r.status==="success"?"":"paused"}">${esc(r.status)}</span></td><td>${r.nodeRuns?.length||0}</td><td>${esc(new Date(r.startedAt).toLocaleString())}</td><td><button class="btn-quiet btn-small" data-run-detail="${esc(r.id)}">Details</button></td></tr>`).join("")+'</tbody></table></div>':'<div class="empty-state">No executions recorded yet. Go to Workflows, open a workflow and run a test.</div>'}
 <div id="run-details"></div><div id="server-executions"></div></section><div class="notice">HTTP Request nodes use browser fetch; cross-origin endpoints may reject requests due to CORS. This is not a secure server-side execution engine.</div>`;
}

function renderCredentials() {
  if (!apiConnection) return '<div class="page-head"><div><div class="eyebrow">Security</div><h1>Credentials vault</h1><p>Store integration credentials encrypted on the API server.</p></div></div><section class="panel page-placeholder"><div><div class="brand-mark" style="margin:auto">e</div><h2>Connect your API first</h2><p>Sign in to enable server-side credential storage. Secrets are not stored in browser localStorage.</p><button class="btn-primary" data-page="Settings">Open server settings</button></div></section>';
  return '<div class="page-head"><div><div class="eyebrow">Security</div><h1>Credentials vault</h1><p>Credential payloads are encrypted at rest by the server. This screen shows metadata only after saving.</p></div></div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Add credential</h2><p>Use a test value; production rotation and KMS are not yet implemented.</p></div></div><form id="credential-form"><label class="field-label">Credential name<input class="field-input" id="credential-name" required maxlength="120" placeholder="CRM API token"></label><label class="field-label">Service / provider<input class="field-input" id="credential-service" required maxlength="120" placeholder="Example CRM"></label><label class="field-label">Secret payload (JSON)<textarea class="field-input code-input" id="credential-secret" rows="7" required placeholder="{&quot;token&quot;:&quot;replace-me&quot;}"></textarea></label><button class="btn-primary" type="submit">Encrypt and save</button></form><div class="notice"><b>Never share secrets in screenshots or logs.</b> The secret is submitted to your configured API and is not shown again in the list.</div></section><section class="panel"><div class="panel-head"><div><h2>Saved credentials</h2><p>Metadata only · workspace scoped</p></div><button class="btn-quiet" id="reload-credentials">Refresh</button></div><div id="credential-list"><div class="empty-state">Loading credentials…</div></div></section></div>';
}
async function loadCredentials() {
  const result = await apiRequest(workspaceApiPath() + "/credentials");
  const target = document.querySelector("#credential-list");
  if (!target) return;
  const items = result.credentials || [];
  target.innerHTML = items.length
    ? '<div class="credential-list">' + items.map(item => '<div class="credential-item"><div class="credential-symbol">♢</div><div class="credential-info"><b>' + esc(item.name) + '</b><small>' + esc(item.service) + ' · updated ' + esc(item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—") + '</small></div><button class="icon-btn" data-credential-delete="' + esc(item.id) + '" title="Delete credential">×</button></div>').join("") + '</div>'
    : '<div class="empty-state">No credentials stored in this workspace.</div>';
  target.querySelectorAll("[data-credential-delete]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Delete this encrypted credential? Existing workflows may stop working.")) return;
    try { await apiRequest(workspaceApiPath() + "/credentials/" + encodeURIComponent(button.dataset.credentialDelete), { method: "DELETE" }); toast("Credential deleted."); await loadCredentials(); }
    catch (error) { toast(error.message); }
  }));
}
function bindCredentials() {
  document.querySelector("#credential-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const secret = JSON.parse(document.querySelector("#credential-secret").value);
      if (!secret || typeof secret !== "object" || Array.isArray(secret)) throw new Error("Secret payload must be a JSON object.");
      await apiRequest(workspaceApiPath() + "/credentials", { method: "POST", body: JSON.stringify({
        name: document.querySelector("#credential-name").value.trim(),
        service: document.querySelector("#credential-service").value.trim(),
        secret
      }) });
      document.querySelector("#credential-secret").value = "";
      document.querySelector("#credential-name").value = "";
      document.querySelector("#credential-service").value = "";
      toast("Credential encrypted and stored.");
      await loadCredentials();
    } catch (error) { toast(error.message); }
  });
  document.querySelector("#reload-credentials")?.addEventListener("click", async () => { try { await loadCredentials(); } catch (error) { toast(error.message); } });
  loadCredentials().catch(error => toast(error.message));
}
function renderPlaceholder(page) {
 const copy = {Integrations:["Integration registry","App connectors, OAuth lifecycle and reusable integration packages are planned, not implemented."],Credentials:["Credentials vault","Do not put real secrets into workflow fields. A server-side encrypted credentials vault is a required future milestone."],Variables:["Environment variables","Per-environment variables and secret references will be provided by the backend. Browser-local values are not secrets."],Settings:["Workspace settings","User authentication, tenants, RBAC, audit policies and org settings require the backend milestone."],Documentation:["Developer documentation","Review the architecture and roadmap in the repository README and docs folder."]}[page]||["Workspace","Choose a section from the navigation."];
 return `<div class="page-head"><div><div class="eyebrow">Workspace</div><h1>${copy[0]}</h1><p>${copy[1]}</p></div></div><section class="panel page-placeholder"><div><div class="brand-mark" style="margin:auto">e</div><h2>${copy[0]} is on the roadmap</h2><p>This page is intentionally transparent about unimplemented server features.</p><button class="btn-quiet" data-page="Overview">← Back to overview</button></div></section>`;
}
function renderEditor() {
 const wf=currentWorkflow();
 const validation=validateWorkflow(wf);
 const node=byId(state.selectedNodeId);
 const ready=wf.nodes.length>0 && !validation.length;
 const canvasWidth=Math.max(2200,...wf.nodes.map(n=>Math.ceil((n.x+520)/100)*100));
 const canvasHeight=Math.max(1300,...wf.nodes.map(n=>Math.ceil((n.y+300)/100)*100));
 return `<div class="editor-page">
 <div class="editor-topline"><div class="editor-title"><button class="back-link" data-page="Workflows">← Workflows</button><span class="slash">/</span><input class="workflow-name-input" id="workflow-name" value="${esc(wf.name)}" aria-label="Workflow name"><span class="save-state"><i></i> Saved locally</span></div><div class="editor-actions"><button class="btn-quiet" id="export-current">Export</button>${apiConnection?'<button class="btn-quiet" id="sync-current">Sync to server</button><button class="btn-quiet" id="queue-server-run">Queue server run</button>':""}<button class="btn-quiet" id="toggle-active">${wf.active?"Clear active flag":"Set active flag"}</button><button class="btn-primary" id="run-workflow">▶ Test workflow</button></div></div>
 <div class="editor-toolbar"><div class="toolbar-left"><span class="tiny-pill">${wf.nodes.length} nodes</span><span class="tiny-pill">${wf.edges.length} connections</span>${validation.length?`<span class="pill-error">${validation.length} validation error(s)</span>`:'<span class="pill-ok">✓ Valid structure</span>'}</div><div class="toolbar-right"><button class="icon-btn" id="zoom-out" title="Zoom out">−</button><span id="zoom-level">100%</span><button class="icon-btn" id="zoom-in" title="Zoom in">＋</button><button class="icon-btn" id="fit-canvas" title="Fit view">⤢</button></div></div>
 <div class="editor-layout">
  <aside class="node-palette"><div class="palette-head"><strong>Node library</strong><span class="tiny-pill">${Object.keys(NODE_TYPES).length}</span></div><p class="palette-hint">Select a node to add it to the canvas.</p>
   <div class="palette-section">TRIGGERS</div>${["manual","webhook"].map(t=>paletteButton(t)).join("")}
   <div class="palette-section">CORE NODES</div>${["set","http","if","merge","wait","log"].map(t=>paletteButton(t)).join("")}
   <div class="palette-help">Tip: connect a node's right handle to the next node's left handle. Click any node to edit its configuration.</div>
  </aside>
  <section class="canvas-shell"><div class="canvas-notice ${state.connectFrom?"connecting":""}" id="canvas-notice">${state.connectFrom?"Connection mode: select an input handle on the target node.": "Canvas · Drag nodes to arrange the flow"}</div><div class="canvas-scroll" id="canvas-scroll"><div class="canvas-inner" id="canvas-inner" style="transform:scale(${state.zoom});width:${canvasWidth}px;height:${canvasHeight}px"><svg class="edge-layer" id="edge-layer" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" aria-label="Workflow connections"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#8f86ed"/></marker></defs>${renderEdges(wf)}</svg>${wf.nodes.map(n=>renderNode(n)).join("")}<div class="canvas-watermark">e11e FLOW <span>VISUAL WORKFLOW</span></div></div></div><div class="canvas-legend"><span><i class="legend-dot manual"></i>Trigger</span><span><i class="legend-dot core"></i>Action</span><span><i class="legend-dot if"></i>Condition</span><span class="legend-note">Click output handle → input handle to connect</span></div></section>
  <aside class="inspector"><div class="inspector-head"><div><strong>Node settings</strong><small>${node?esc(node.name):"Select a node"}</small></div>${node?'<button class="icon-btn" id="delete-node" title="Delete node">⌫</button>':""}</div>${node?renderInspector(node):'<div class="inspector-empty"><div class="empty-node-icon">◇</div><b>No node selected</b><p>Select a node on the canvas to inspect its settings, or choose one from the node library.</p></div>'}</aside>
 </div>
 <div class="run-drawer"><div class="run-drawer-head"><div><b>Test output</b><span>${state.lastRun?esc(state.lastRun.status):"Ready to test"}</span></div><button class="text-link" id="toggle-output">${state.outputCollapsed?"Show":"Hide"}</button></div><div class="run-input-panel"><label class="field-label" for="run-input">TEST INPUT <span class="run-input-hint">JSON object passed to the trigger</span><textarea class="field-input code-input run-input" id="run-input" rows="5" spellcheck="false">${esc(state.testInput)}</textarea></label><div class="run-input-footer"><span>Tip: IF rules can read fields such as <code>approved</code> or <code>user.name</code>.</span><button class="btn-quiet btn-small" id="reset-test-input">Reset sample</button></div></div><div class="run-output ${state.outputCollapsed?"collapsed":""}" id="run-output">${renderLastRun()}</div></div>
 </div>`;
}
function paletteButton(type) { const def=NODE_TYPES[type]; return `<button class="palette-node" data-add-node="${type}"><span class="palette-icon ${def.color}">${def.icon}</span><span><b>${def.label}</b><small>${({manual:"Start the workflow",webhook:"Accept authenticated HTTP POST",set:"Set or transform fields",http:"Call an HTTP endpoint",if:"Route on a condition",merge:"Combine object inputs",wait:"Pause briefly",log:"Inspect the output"})[type]}</small></span><span class="palette-plus">＋</span></button>`; }
function renderNode(n) {
 const def=NODE_TYPES[n.type]||{label:n.type,icon:"◇",color:"slate"};
 const incoming=currentWorkflow().edges.some(e=>e.target===n.id);
 return `<div class="flow-node ${state.selectedNodeId===n.id?"selected":""} ${def.color} ${state.connectFrom===n.id?"connect-source":""}" data-node="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px">
  <div class="node-top" data-drag-handle="${esc(n.id)}"><span class="node-icon ${def.color}">${def.icon}</span><span class="node-heading"><b>${esc(n.name)}</b><small>${def.label}</small></span><button class="node-more" data-node-settings="${esc(n.id)}" title="Node settings">···</button></div>
  <div class="node-description">${esc(nodeSummary(n))}</div><div class="node-footer"><span class="node-kind">${n.type==="manual"?"TRIGGER":n.type==="if"?"BRANCH":n.type.toUpperCase()}</span><span class="node-port-label">${incoming?"CONNECTED":"INPUT"}<i class="port input-port ${state.connectFrom?"port-target":""}" data-connect-to="${esc(n.id)}" title="Connect from previous node"></i></span></div>
  ${n.type==="if"?`<span class="branch-label true">T</span><button class="port output-port true-port" data-connect-from="${esc(n.id)}" data-connect-branch="true" title="Connect TRUE branch"></button><span class="branch-label false">F</span><button class="port output-port false-port" data-connect-from="${esc(n.id)}" data-connect-branch="false" title="Connect FALSE branch"></button>`:`<button class="port output-port" data-connect-from="${esc(n.id)}" data-connect-branch="" title="Start a connection"></button>`}
 </div>`;
}
function nodeSummary(n) {
 const c=n.config||{};
 if(n.type==="http") return (c.method||"GET")+" · "+(c.url||"Set URL");
 if(n.type==="webhook") return "Authenticated HTTP POST trigger";
 if(n.type==="set") return Object.keys(c.fields||{}).length+" field(s) configured";
 if(n.type==="if") return (c.field||"field")+" "+(c.operator||"equals")+" "+String(c.value??"");
 if(n.type==="wait") return (c.ms||0)+" ms delay";
 if(n.type==="merge") return "Combine input objects";
 if(n.type==="log") return "Capture node input/output";
 return "Ready to start";
}
function renderEdges(wf) {
 return wf.edges.map(e=>{const a=wf.nodes.find(n=>n.id===e.source),b=wf.nodes.find(n=>n.id===e.target);if(!a||!b)return "";const x1=a.x+216,y1=a.y+(e.sourceHandle==="true"?57:e.sourceHandle==="false"?85:63),x2=b.x,y2=b.y+63,mid=(x1+x2)/2;return `<path class="edge-path ${e.sourceHandle||""}" data-edge="${esc(e.id)}" d="M ${x1} ${y1} C ${Math.max(x1+35,mid)} ${y1}, ${Math.min(x2-35,mid)} ${y2}, ${x2} ${y2}" marker-end="url(#arrow)"/>`;}).join("");
}
function renderInspector(n) {
 const c=n.config||{};
 const label=(name,html)=>`<label class="field-label">${name}${html}</label>`;
 let specific="";
 if(n.type==="set") specific=label("Fields (JSON)",`<textarea class="field-input code-input" rows="7" data-config-json="fields">${esc(JSON.stringify(c.fields||{},null,2))}</textarea>`)+`<label class="check-row"><input type="checkbox" data-config-bool="keepInput" ${c.keepInput===false?"":"checked"}> Keep incoming fields</label><p class="field-help">String values can interpolate like {{ user.email }} based on the incoming object.</p>`;
 if(n.type==="http") specific=label("HTTP method",`<select class="field-input" data-config="method">${["GET","POST","PUT","PATCH","DELETE","HEAD"].map(m=>`<option ${(c.method||"GET")===m?"selected":""}>${m}</option>`).join("")}</select>`)+label("Request URL",`<input class="field-input" data-config="url" placeholder="https://api.example.com/items" value="${esc(c.url||"")}">`)+label("Headers (JSON)",`<textarea class="field-input code-input" rows="4" data-config-json="headers">${esc(JSON.stringify(c.headers||{},null,2))}</textarea>`)+label("Request body",`<textarea class="field-input code-input" rows="3" data-config="body" placeholder="JSON or text">${esc(c.body||"")}</textarea>`)+label("Timeout (ms)",`<input class="field-input" type="number" min="1000" max="30000" data-config-number="timeoutMs" value="${esc(c.timeoutMs||10000)}">`)+`<p class="field-help warn-text">Requests run in your browser. CORS may block calls; never place secret API keys here.</p>`;
 if(n.type==="if") specific=label("Field path",`<input class="field-input" data-config="field" value="${esc(c.field||"")}" placeholder="user.approved">`)+label("Operator",`<select class="field-input" data-config="operator">${[["equals","Equals"],["not-equals","Does not equal"],["contains","Contains"],["greater-than","Greater than"],["less-than","Less than"],["exists","Exists"],["not-empty","Is not empty"]].map(([v,l])=>`<option value="${v}" ${(c.operator||"equals")===v?"selected":""}>${l}</option>`).join("")}</select>`)+label("Compare value",`<input class="field-input" data-config="value" value="${esc(c.value??"")}" placeholder="true">`)+`<p class="field-help">Choose the T or F output handle on the IF node to create a true/false branch.</p>`;
 if(n.type==="wait") specific=label("Delay in milliseconds (max 1000 in demo)",`<input class="field-input" type="number" min="0" max="1000" data-config-number="ms" value="${esc(c.ms||0)}">`);
 if(n.type==="manual") specific=`<div class="info-block">The workflow starts at this node when you press <b>Test workflow</b>. The test runner passes sample input unless you configure an input payload in a future backend version.</div>`;
 if(n.type==="webhook") {
   const setup = state.webhookSetup && state.webhookSetup.workflowId === currentWorkflow().id && state.webhookSetup.nodeId === n.id ? state.webhookSetup : null;
   specific = '<div class="info-block">Accepts an external HTTP POST when the workflow is active and synced to the server. Create a per-node token; the server stores only a SHA-256 hash.</div>' +
     (apiConnection ? '<button class="btn-quiet" id="generate-webhook-token">Generate / rotate endpoint token</button>' : '<button class="btn-quiet" data-page="Settings">Connect API to configure endpoint</button>') +
     (setup ? '<div class="webhook-result"><b>Endpoint</b><input class="field-input" readonly value="' + esc(apiConnection.baseUrl + setup.path) + '"><b>Token (shown only now)</b><input class="field-input" readonly value="' + esc(setup.token) + '"><div class="field-help">Header: x-e11e-webhook-token</div><button class="btn-quiet" id="copy-webhook-token">Copy token</button><small>Use POST with a JSON body. Keep this token private; it is not saved in workflow JSON.</small></div>' : '');
 }
 if(n.type==="merge") specific=`<div class="info-block">The demo executor combines object inputs that have already reached this node. Fan-in execution is simplified in this prototype.</div>`;
 if(n.type==="log") specific=`<div class="info-block">Captures its input as the node output. Inspect the Test output drawer after a run.</div>`;
 const relatedEdges=currentWorkflow().edges.filter(e=>e.source===n.id||e.target===n.id); const connections=relatedEdges.length?relatedEdges.map(e=>{const source=byId(e.source),target=byId(e.target);return `<div class="connection-row"><span>${esc(source?.name||e.source)} <i>→</i> ${esc(target?.name||e.target)}<small>${e.sourceHandle?" · "+esc(e.sourceHandle.toUpperCase())+" branch":""}</small></span><button class="icon-btn" data-delete-edge="${esc(e.id)}" title="Remove connection">×</button></div>`;}).join(""):'<div class="field-help">No connections yet.</div>';
 return `<div class="inspector-form">${label("Display name",`<input class="field-input" data-node-name value="${esc(n.name)}">`)}<div class="field-separator"></div>${specific}<div class="inspector-meta"><span>Node ID</span><code>${esc(n.id)}</code></div><div class="inspector-meta"><span>Node type</span><code>${esc(n.type)}</code></div></div><div class="connections-panel"><div class="connections-title">Connections <span>${relatedEdges.length}</span></div>${connections}</div>`;
}
function renderLastRun() {
 if(state.lastRun) return `<div class="run-summary ${state.lastRun.status}"><span>${state.lastRun.status==="success"?"✓":"!"}</span><div><b>Run ${esc(state.lastRun.status)}</b><small>${esc(new Date(state.lastRun.startedAt).toLocaleTimeString())} · ${state.lastRun.nodeRuns.length} node steps</small></div></div><div class="run-node-list">${state.lastRun.nodeRuns.map((r,i)=>`<details class="run-node" ${i===state.lastRun.nodeRuns.length-1?"open":""}><summary><span class="run-node-icon">${iconFor(r.type)}</span><b>${esc(r.name)}</b><span class="run-status">${esc(r.status)}</span><small>${r.durationMs} ms</small></summary><div class="run-json-grid"><div><label>Input</label><pre>${esc(JSON.stringify(r.input,null,2))}</pre></div><div><label>Output / Error</label><pre>${esc(JSON.stringify(r.output??r.message,null,2))}</pre></div></div></details>`).join("")}</div>`;
 return '<div class="run-empty">Press <b>Test workflow</b> to execute the connected nodes locally and inspect input/output values here.</div>';
}
function render() {
 const root=document.querySelector("#app");
 const previousCanvas=state.page==="Editor"&&!state.fitPending?document.querySelector("#canvas-scroll"):null;
 const previousCanvasScroll=previousCanvas?{left:previousCanvas.scrollLeft,top:previousCanvas.scrollTop}:null;
 const pages=["Overview","Workflows","Executions","Integrations","Credentials","Variables","Settings","Documentation"];
 root.innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">e</div><div><div class="brand-name">e11e <span style="color:#9d91ff">Flow</span></div><div class="brand-sub">Automation studio</div></div></div><div class="workspace-badge"><span>◈ &nbsp; Personal workspace</span><small>${apiConnection?"Server session":"Local prototype"}</small></div><div><div class="nav-label">Workspace</div><nav class="nav">${pages.slice(0,5).map(p=>`<button class="${state.page===p?"active":""}" data-page="${p}"><span class="ico">${navIcon(p)}</span>${p}</button>`).join("")}</nav></div><div><div class="nav-label">Manage</div><nav class="nav">${pages.slice(5).map(p=>`<button class="${state.page===p?"active":""}" data-page="${p}"><span class="ico">${navIcon(p)}</span>${p}</button>`).join("")}</nav></div><div class="side-bottom"><div class="health"><div class="health-top"><span class="dot"></span> Client status <span style="margin-left:auto;color:#60d7a5">Online</span></div><p>${apiConnection?"API: "+esc(apiConnection.baseUrl):"Browser-local mode. Connect an API in Settings for shared workflows."}</p><div class="mini-meter"><span></span></div></div><div class="user-profile"><div class="avatar">e</div><div>e11e workspace<small>Browser session</small></div></div></div></aside><main class="main"><header class="topbar"><div class="crumb">Workspace <span style="color:#596580">/</span> <strong>${state.page==="Editor"?"Workflow editor":state.page}</strong></div><div class="top-actions"><label class="search" for="global-search"><span aria-hidden="true">⌕</span><input id="global-search" type="search" value="${esc(state.searchQuery)}" placeholder="Search workflows" aria-label="Search workflows"><span class="kbd">⌘ K</span></label><button class="icon-btn" id="help-button" title="Prototype notes">ⓘ</button><div class="avatar">e</div></div></header><div class="content ${state.page==="Editor"?"content-editor":""}">${state.page==="Overview"?renderDashboard():state.page==="Workflows"?renderWorkflows():state.page==="Executions"?renderExecutions():state.page==="Editor"?renderEditor():state.page==="Settings"?renderSettings():state.page==="Credentials"?renderCredentials():renderPlaceholder(state.page)}</div></main></div>`;
 root.querySelector("#global-search")?.addEventListener("keydown",event=>{if(event.key==="Enter"){state.searchQuery=event.currentTarget.value.trim();state.page="Workflows";render();document.querySelector("#global-search")?.focus();}});
 window.onkeydown=event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();document.querySelector("#global-search")?.focus();}else if(event.key==="Escape"&&state.connectFrom){state.connectFrom=null;state.connectBranch=null;render();}}
 root.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>setPage(b.dataset.page)));
 root.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>openEditor(b.dataset.open)));
 root.querySelector("#create-workflow")?.addEventListener("click",createWorkflow);
 root.querySelectorAll("[data-template]").forEach(b=>b.addEventListener("click",()=>createFromTemplate(b.dataset.template)));
 root.querySelector("#help-button")?.addEventListener("click",()=>toast("Prototype notice: workflow data is saved only in this browser. Do not store secrets here."));
 if(state.page==="Workflows") bindWorkflowList();
 if(state.page==="Executions") bindExecutions();
 if(state.page==="Settings") bindSettings();
 if(state.page==="Credentials") bindCredentials();
 if(state.page==="Editor") bindEditor();
 if(state.page==="Editor" && previousCanvasScroll && !state.fitPending) requestAnimationFrame(()=>{const viewport=document.querySelector("#canvas-scroll");if(viewport){viewport.scrollLeft=previousCanvasScroll.left;viewport.scrollTop=previousCanvasScroll.top;}});
}
function createFromTemplate(which) {
 const wf=createDefaultWorkflow(); wf.id=id("wf"); wf.name=which==="webhook"?"Webhook intake":which==="conditional"?"Conditional routing":"Data transform";
 if(which==="conditional") { wf.nodes=[{id:"a",type:"manual",name:"Manual Trigger",x:100,y:130,config:{}},{id:"b",type:"if",name:"Check approved",x:410,y:130,config:{field:"approved",operator:"equals",value:true}},{id:"c",type:"log",name:"Approved output",x:740,y:80,config:{}},{id:"d",type:"log",name:"Rejected output",x:740,y:250,config:{}}];wf.edges=[{id:"ab",source:"a",target:"b"},{id:"bc",source:"b",target:"c",sourceHandle:"true"},{id:"bd",source:"b",target:"d",sourceHandle:"false"}];}
 if(which==="webhook") { wf.nodes=[{id:"a",type:"webhook",name:"Webhook Trigger",x:100,y:150,config:{}},{id:"b",type:"http",name:"HTTP Request",x:410,y:150,config:{url:"https://jsonplaceholder.typicode.com/todos/1",method:"GET",headers:{},timeoutMs:10000}},{id:"c",type:"log",name:"Inspect response",x:740,y:150,config:{}}];wf.edges=[{id:"ab",source:"a",target:"b"},{id:"bc",source:"b",target:"c"}];}
 workflows.unshift(wf);persist();openEditor(wf.id);
}
function bindWorkflowList() {
 const filter=document.querySelector("#workflow-filter");
 const empty=document.querySelector("#workflow-filter-empty");
 const applyFilter=()=>{const query=(filter?.value||"").trim().toLowerCase();let visible=0;document.querySelectorAll(".data-table tbody tr").forEach(row=>{const match=!query||row.textContent.toLowerCase().includes(query);row.hidden=!match;if(match)visible+=1;});if(empty)empty.hidden=visible>0;};
 if(filter){filter.addEventListener("input",()=>{state.searchQuery=filter.value;applyFilter();});applyFilter();}

 document.querySelector("#export-all")?.addEventListener("click",()=>downloadJSON("e11e-workflows.json",workflows));
 document.querySelector("#sync-server")?.addEventListener("click",async()=>{if(!apiConnection){state.page="Settings";render();toast("Connect to the API in Settings first.");return;}try{await syncAllWorkflows();}catch(error){toast(error.message);}});
 document.querySelector("#import-all")?.addEventListener("change",async e=>{try{const text=await e.target.files[0]?.text();if(!text)return;const parsed=JSON.parse(text);const items=Array.isArray(parsed)?parsed:[parsed];for(const w of items){const errors=validateWorkflow(w);if(errors.length)throw new Error(errors.join(" "));if(!w.id)w.id=id("wf");}workflows=[...items,...workflows.filter(old=>!items.some(w=>w.id===old.id))];persist();toast("Workflow JSON imported.");render();}catch(err){toast("Import failed: "+err.message);}});
 document.querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",()=>{if(!confirm("Delete this workflow from this browser?"))return;workflows=workflows.filter(w=>w.id!==b.dataset.delete);persist();render();}));
}
function bindExecutions() {
 document.querySelector("#clear-runs")?.addEventListener("click",()=>{if(confirm("Clear local execution history?")){state.runs=[];localStorage.setItem(RUNS_KEY,"[]");render();}});
 document.querySelector("#export-runs")?.addEventListener("click",()=>downloadJSON("e11e-executions.json",readRuns()));
 document.querySelector("#load-server-runs")?.addEventListener("click",async()=>{try{await loadServerExecutions();}catch(error){toast(error.message);}});
 document.querySelectorAll("[data-run-detail]").forEach(b=>b.addEventListener("click",()=>{const r=readRuns().find(run=>run.id===b.dataset.runDetail);const target=document.querySelector("#run-details");if(target)target.innerHTML=`<div class="notice"><b>Run ${esc(r?.id||"")}</b><pre>${esc(JSON.stringify(r,null,2))}</pre></div>`;}));
}
function downloadJSON(name,data) { const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url); }
function bindEditor() {
 const wf=currentWorkflow();
 document.querySelector("#workflow-name")?.addEventListener("change",e=>{wf.name=e.target.value.trim()||"Untitled workflow";markSaved();persist();});
 document.querySelector("#export-current")?.addEventListener("click",()=>downloadJSON((wf.name||"workflow").toLowerCase().replace(/[^a-z0-9]+/g,"-")+".json",wf));
 document.querySelector("#toggle-active")?.addEventListener("click",()=>{wf.active=!wf.active;markSaved();persist();render();toast(wf.active?"Active flag saved locally. This does not start a background listener.":"Active flag cleared.");});
 document.querySelector("#run-workflow")?.addEventListener("click",runCurrentWorkflow);
 document.querySelector("#run-input")?.addEventListener("input",event=>{state.testInput=event.currentTarget.value;});
 document.querySelector("#reset-test-input")?.addEventListener("click",()=>{state.testInput=JSON.stringify({example:"hello from e11e",approved:true,user:{name:"Demo User",email:"demo@example.test"}},null,2);const input=document.querySelector("#run-input");if(input)input.value=state.testInput;});
 document.querySelector("#sync-current")?.addEventListener("click",async()=>{try{await syncCurrentWorkflow();toast("Workflow saved to the server.");}catch(error){toast(error.message);}});
 document.querySelector("#queue-server-run")?.addEventListener("click",async()=>{try{await queueServerExecution();}catch(error){toast(error.message);}});
 document.querySelector("#generate-webhook-token")?.addEventListener("click",async()=>{try{await generateWebhookToken();}catch(error){toast(error.message);}});
 document.querySelector("#copy-webhook-token")?.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(state.webhookSetup.token);toast("Webhook token copied.");}catch{toast("Clipboard unavailable; copy the token manually.");}});
 document.querySelectorAll("[data-add-node]").forEach(b=>b.addEventListener("click",()=>addNode(b.dataset.addNode)));
 document.querySelectorAll("[data-node-settings]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();state.selectedNodeId=b.dataset.nodeSettings;render();}));
 document.querySelectorAll("[data-node]").forEach(el=>el.addEventListener("click",()=>{if(state.connectFrom){toast("Connect using the small input handle on the target node.");return;}state.selectedNodeId=el.dataset.node;render();}));
 document.querySelectorAll("[data-connect-from]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();state.connectFrom=b.dataset.connectFrom;state.connectBranch=b.dataset.connectBranch||null;state.selectedNodeId=b.dataset.connectFrom;render();toast(state.connectBranch?"Connect the "+state.connectBranch.toUpperCase()+" branch to a target input.":"Now click a target node input handle.");}));
 document.querySelectorAll("[data-connect-to]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();const target=b.dataset.connectTo;if(!state.connectFrom){state.selectedNodeId=target;render();return;}if(state.connectFrom===target){toast("A node cannot connect to itself.");return;}const exists=wf.edges.some(ed=>ed.source===state.connectFrom&&ed.target===target&&(ed.sourceHandle||null)===(state.connectBranch||null));if(!exists)wf.edges.push({id:id("edge"),source:state.connectFrom,target,...(state.connectBranch?{sourceHandle:state.connectBranch}:{})});state.connectFrom=null;state.connectBranch=null;state.selectedNodeId=target;wf.updatedAt=new Date().toISOString();persist();render();}));
 document.querySelectorAll("[data-drag-handle]").forEach(el=>el.addEventListener("pointerdown",startNodeDrag));
 document.querySelectorAll("[data-config]").forEach(el=>el.addEventListener("change",()=>{const n=byId(state.selectedNodeId);if(!n)return;n.config[el.dataset.config]=el.value;wf.updatedAt=new Date().toISOString();persist();syncNodeCard(n);}));
 document.querySelectorAll("[data-config-number]").forEach(el=>el.addEventListener("change",()=>{const n=byId(state.selectedNodeId);if(!n)return;n.config[el.dataset.configNumber]=Number(el.value);wf.updatedAt=new Date().toISOString();persist();markSaved();syncNodeCard(n);}));
 document.querySelectorAll("[data-config-bool]").forEach(el=>el.addEventListener("change",()=>{const n=byId(state.selectedNodeId);if(!n)return;n.config[el.dataset.configBool]=el.checked;wf.updatedAt=new Date().toISOString();persist();markSaved();}));
 document.querySelectorAll("[data-config-json]").forEach(el=>el.addEventListener("change",()=>{const n=byId(state.selectedNodeId);if(!n)return;try{const parsed=JSON.parse(el.value||"{}");if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("Enter a JSON object.");n.config[el.dataset.configJson]=parsed;el.classList.remove("invalid");wf.updatedAt=new Date().toISOString();persist();markSaved();syncNodeCard(n);}catch(err){el.classList.add("invalid");toast("Invalid JSON: "+err.message);}}));
 document.querySelector("[data-node-name]")?.addEventListener("change",e=>{const n=byId(state.selectedNodeId);if(!n)return;n.name=e.target.value.trim()||NODE_TYPES[n.type].label;persist();render();});
 document.querySelectorAll("[data-delete-edge]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();const edgeId=b.dataset.deleteEdge;const flow=currentWorkflow();flow.edges=flow.edges.filter(edge=>edge.id!==edgeId);flow.updatedAt=new Date().toISOString();persist();render();}));
 document.querySelector("#delete-node")?.addEventListener("click",()=>{const node=byId(state.selectedNodeId);if(!node)return;if(!confirm("Delete this node and its connections?"))return;wf.nodes=wf.nodes.filter(n=>n.id!==node.id);wf.edges=wf.edges.filter(e=>e.source!==node.id&&e.target!==node.id);state.selectedNodeId=null;persist();render();});
 document.querySelector("#zoom-in")?.addEventListener("click",()=>changeZoom(.1));
 document.querySelector("#zoom-out")?.addEventListener("click",()=>changeZoom(-.1));
 document.querySelector("#fit-canvas")?.addEventListener("click",fitCanvasView);
 document.querySelector("#toggle-output")?.addEventListener("click",()=>{state.outputCollapsed=!state.outputCollapsed;const panel=document.querySelector("#run-output");panel.classList.toggle("collapsed",state.outputCollapsed);document.querySelector("#toggle-output").textContent=state.outputCollapsed?"Show":"Hide";});
 if(state.fitPending){state.fitPending=false;fitCanvasView();}
}
function findAvailableNodePosition(wf) {
 const nodes=wf.nodes||[];if(!nodes.length)return {x:120,y:160};
 const centerX=nodes.reduce((sum,n)=>sum+n.x+108,0)/nodes.length;
 const centerY=nodes.reduce((sum,n)=>sum+n.y+63,0)/nodes.length;
 const maxX=Math.max(0,...nodes.map(n=>n.x));const maxY=Math.max(0,...nodes.map(n=>n.y));
 const cols=Math.min(20,Math.max(7,Math.ceil((maxX+700)/300)));
 const rows=Math.min(20,Math.max(6,Math.ceil((maxY+600)/200)));
 const candidates=[];
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  const x=100+col*300,y=130+row*200;
  const collision=nodes.some(n=>x<n.x+240&&x+240>n.x&&y<n.y+150&&y+150>n.y);
  if(!collision)candidates.push({x,y,score:Math.pow(x+108-centerX,2)+Math.pow(y+63-centerY,2)});
 }
 candidates.sort((a,b)=>a.score-b.score);return candidates[0]?{x:candidates[0].x,y:candidates[0].y}:null;
}
function addNode(type) {
 const wf=currentWorkflow();const position=findAvailableNodePosition(wf);if(!position){toast("The canvas is full. Move or delete a node before adding another.");return;}const n={id:id("node"),type,name:NODE_TYPES[type].label,...position,config:{}};
 if(type==="set")n.config={fields:{result:"ok"},keepInput:true};
 if(type==="http")n.config={url:"https://jsonplaceholder.typicode.com/todos/1",method:"GET",headers:{},timeoutMs:10000};
 if(type==="if")n.config={field:"approved",operator:"equals",value:true};
 if(type==="wait")n.config={ms:250};
 wf.nodes.push(n);wf.updatedAt=new Date().toISOString();state.selectedNodeId=n.id;state.fitPending=true;persist();render();
}
function startNodeDrag(event) {
 if(event.button!==0||event.target.closest("button"))return;
 const nodeId=event.currentTarget.dataset.dragHandle;const node=byId(nodeId);if(!node)return;
 const el=document.querySelector('[data-node="'+CSS.escape(nodeId)+'"]');
 state.drag={nodeId,startX:event.clientX,startY:event.clientY,originX:node.x,originY:node.y,el};el.classList.add("dragging");event.preventDefault();
 const move=e=>{if(!state.drag)return;const dx=(e.clientX-state.drag.startX)/state.zoom,dy=(e.clientY-state.drag.startY)/state.zoom;node.x=Math.max(0,Math.round(state.drag.originX+dx));node.y=Math.max(0,Math.round(state.drag.originY+dy));el.style.left=node.x+"px";el.style.top=node.y+"px";refreshEdges();};
 const up=()=>{if(state.drag){state.drag.el?.classList.remove("dragging");state.drag=null;currentWorkflow().updatedAt=new Date().toISOString();persist();markSaved();}window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);};
 window.addEventListener("pointermove",move);window.addEventListener("pointerup",up,{once:true});
}
function refreshEdges(){const wf=currentWorkflow();const width=Math.max(2200,...wf.nodes.map(n=>Math.ceil((n.x+520)/100)*100));const height=Math.max(1300,...wf.nodes.map(n=>Math.ceil((n.y+300)/100)*100));const inner=document.querySelector("#canvas-inner");const layer=document.querySelector("#edge-layer");if(inner){inner.style.width=width+"px";inner.style.height=height+"px";}if(layer){layer.setAttribute("width",String(width));layer.setAttribute("height",String(height));layer.setAttribute("viewBox","0 0 "+width+" "+height);layer.innerHTML='<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#8f86ed"/></marker></defs>'+renderEdges(wf);}}
function changeZoom(delta){const viewport=document.querySelector("#canvas-scroll");const oldZoom=state.zoom;const centerX=viewport?(viewport.scrollLeft+viewport.clientWidth/2)/oldZoom:0;const centerY=viewport?(viewport.scrollTop+viewport.clientHeight/2)/oldZoom:0;state.zoom=Math.min(1.5,Math.max(.35,Math.round((state.zoom+delta)*10)/10));updateZoom();if(viewport){viewport.scrollLeft=Math.max(0,centerX*state.zoom-viewport.clientWidth/2);viewport.scrollTop=Math.max(0,centerY*state.zoom-viewport.clientHeight/2);}}
function updateZoom(){const inner=document.querySelector("#canvas-inner");if(inner)inner.style.transform="scale("+state.zoom+")";const label=document.querySelector("#zoom-level");if(label)label.textContent=Math.round(state.zoom*100)+"%";}
function fitCanvasView(){const viewport=document.querySelector("#canvas-scroll");const wf=currentWorkflow();if(!viewport||!wf?.nodes?.length){state.zoom=1;updateZoom();return;}const minX=Math.min(...wf.nodes.map(n=>n.x)),minY=Math.min(...wf.nodes.map(n=>n.y));const maxX=Math.max(...wf.nodes.map(n=>n.x+216)),maxY=Math.max(...wf.nodes.map(n=>n.y+126));const width=Math.max(1,maxX-minX),height=Math.max(1,maxY-minY);const availableWidth=Math.max(160,viewport.clientWidth-54),availableHeight=Math.max(160,viewport.clientHeight-104);state.zoom=Math.max(.35,Math.min(1.1,availableWidth/width,availableHeight/height));updateZoom();requestAnimationFrame(()=>{const current=document.querySelector("#canvas-scroll");if(current){current.scrollLeft=Math.max(0,Math.round(minX*state.zoom-28));current.scrollTop=Math.max(0,Math.round(minY*state.zoom-44));}});}
function syncNodeCard(n){const el=document.querySelector('[data-node="'+CSS.escape(n.id)+'"]');if(!el)return;const desc=el.querySelector(".node-description");if(desc)desc.textContent=nodeSummary(n);const title=el.querySelector(".node-heading b");if(title)title.textContent=n.name;}
function markSaved(){const s=document.querySelector(".save-state");if(s)s.innerHTML="<i></i> Saved locally";}
async function runCurrentWorkflow() {
 const wf=currentWorkflow();const button=document.querySelector("#run-workflow");let input;
 try{input=JSON.parse(document.querySelector("#run-input")?.value||state.testInput||"{}");if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Test input must be a JSON object.");state.testInput=JSON.stringify(input,null,2);}catch(error){toast("Invalid test input: "+error.message);return;}
 button.disabled=true;button.textContent="Running…";
 try {
  const selected=byId(state.selectedNodeId);const triggerNodeId=selected?.type==="webhook"?selected.id:undefined;
  const result=await executeWorkflow(wf,{input,maxSteps:100,...(triggerNodeId?{triggerNodeId}:{})});
  result.workflowName=wf.name;result.workflowId=wf.id;state.lastRun=result;const runs=readRuns();runs.unshift(result);localStorage.setItem(RUNS_KEY,JSON.stringify(runs.slice(0,100)));state.runs=runs.slice(0,100);state.outputCollapsed=false;
  const output=document.querySelector("#run-output");if(output){output.classList.remove("collapsed");output.innerHTML=renderLastRun();}
  const head=document.querySelector(".run-drawer-head span");if(head)head.textContent="success · "+result.nodeRuns.length+" steps";
  toast("Test run completed. Inspect node output below.");
 } catch(error) {
  const result=error.nodeRuns?{id:id("run"),status:"error",startedAt:new Date().toISOString(),nodeRuns:error.nodeRuns,output:error.message,workflowName:wf.name}:null;
  if(result){state.lastRun=result;result.workflowId=wf.id;const runs=readRuns();runs.unshift(result);localStorage.setItem(RUNS_KEY,JSON.stringify(runs.slice(0,100)));state.runs=runs.slice(0,100);}
  const output=document.querySelector("#run-output");if(output){output.classList.remove("collapsed");output.innerHTML=result?renderLastRun():'<div class="notice"><b>Run failed:</b> '+esc(error.message)+'</div>';}
  toast("Test failed: "+error.message);
 } finally {button.disabled=false;button.textContent="▶ Test workflow";const details=document.querySelector("#run-output");if(details&&state.lastRun)details.innerHTML=renderLastRun();}
}
render();
