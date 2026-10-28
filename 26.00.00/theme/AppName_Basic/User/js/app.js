import { NODE_TYPES, createDefaultWorkflow, executeWorkflow, validateWorkflow } from "./workflow-engine.js";

const STORE_KEY = "e11e.flow.workflows.v1";
const RUNS_KEY = "e11e.flow.runs.v1";
const state = { page: "Overview", currentId: null, selectedNodeId: null, connectFrom: null, connectBranch: null, runs: readRuns(), drag: null, zoom: 1 };

function readRuns() { try { return JSON.parse(localStorage.getItem(RUNS_KEY) || "[]"); } catch { return []; } }
function loadWorkflows() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  const first = createDefaultWorkflow();
  return [
    first,
    { id: "wf_leads", name: "New lead → CRM sync", active: true, updatedAt: new Date().toISOString(), nodes: [{id:"w1",type:"manual",name:"Webhook Trigger",x:100,y:130,config:{}},{id:"w2",type:"http",name:"Enrich Lead",x:410,y:130,config:{url:"https://api.example.com/leads",method:"GET",headers:{},timeoutMs:10000}},{id:"w3",type:"log",name:"CRM Output",x:720,y:130,config:{}}], edges:[{id:"we1",source:"w1",target:"w2"},{id:"we2",source:"w2",target:"w3"}]},
    { id: "wf_report", name: "Daily analytics digest", active: true, updatedAt: new Date().toISOString(), nodes: [{id:"r1",type:"manual",name:"Schedule Trigger",x:100,y:130,config:{}},{id:"r2",type:"set",name:"Prepare Summary",x:410,y:130,config:{fields:{subject:"Daily report",status:"prepared"}}},{id:"r3",type:"log",name:"Report Output",x:720,y:130,config:{}}], edges:[{id:"re1",source:"r1",target:"r2"},{id:"re2",source:"r2",target:"r3"}]},
    { id: "wf_support", name: "Support ticket classifier", active: true, updatedAt: new Date().toISOString(), nodes: [{id:"s1",type:"manual",name:"Ticket Received",x:100,y:130,config:{}},{id:"s2",type:"if",name:"Priority Check",x:410,y:130,config:{field:"priority",operator:"equals",value:"high"}},{id:"s3",type:"log",name:"Route Ticket",x:720,y:130,config:{}}], edges:[{id:"se1",source:"s1",target:"s2"},{id:"se2",source:"s2",target:"s3",sourceHandle:"true"}]}
  ];
}
let workflows = loadWorkflows();
function persist() { localStorage.setItem(STORE_KEY, JSON.stringify(workflows)); }
function currentWorkflow() { return workflows.find(w => w.id === state.currentId) || workflows[0]; }
function byId(id) { return currentWorkflow().nodes.find(n => n.id === id); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function iconFor(type) { return NODE_TYPES[type]?.icon || "◇"; }
function toast(message) { const old = document.querySelector(".toast"); old?.remove(); const el = document.createElement("div"); el.className = "toast"; el.textContent = message; document.body.appendChild(el); setTimeout(() => el.remove(), 3000); }
function id(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 9); }
function navIcon(name) { return ({Overview:"◈",Workflows:"⌘",Executions:"◷",Integrations:"⧉",Credentials:"♢",Variables:"≋",Settings:"⚙",Documentation:"↗"})[name] || "◇"; }
function setPage(page) { state.page = page; state.connectFrom = null; state.connectBranch = null; render(); }
function openEditor(workflowId) { state.currentId = workflowId; state.selectedNodeId = null; state.page = "Editor"; state.connectFrom = null; render(); }
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
 <section class="panel"><div class="panel-head"><div><h2>All workflows</h2><p>${workflows.length} saved workflow definitions</p></div><button class="btn-quiet" id="export-all">Export all JSON</button><label class="btn-quiet file-label">Import JSON<input type="file" id="import-all" accept="application/json,.json" hidden></label></div>
 <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Nodes</th><th>Status</th><th>Last updated</th><th>Actions</th></tr></thead><tbody>${workflows.map(w=>`<tr><td><button class="table-title" data-open="${esc(w.id)}">${esc(w.name)}</button><small class="table-sub">${esc(w.id)}</small></td><td>${w.nodes.length}</td><td><span class="status ${w.active?"":"paused"}">${w.active?"Active flag":"Inactive"}</span></td><td>${esc(new Date(w.updatedAt).toLocaleString())}</td><td><button class="btn-quiet btn-small" data-open="${esc(w.id)}">Edit</button> <button class="btn-quiet btn-small" data-delete="${esc(w.id)}">Delete</button></td></tr>`).join("")}</tbody></table></div></section>
 <div class="notice">Workflow activation is currently a local UI flag only. Webhook listeners, schedules, credentials, collaboration and server persistence are not enabled in this version.</div>`;
}
function renderExecutions() {
 const runs=readRuns();
 return `<div class="page-head"><div><div class="eyebrow">Observability</div><h1>Execution history</h1><p>Inspect node-by-node results from local test runs.</p></div><button class="btn-quiet" id="clear-runs">Clear history</button></div><section class="panel"><div class="panel-head"><div><h2>Recent test runs</h2><p>${runs.length} local run records</p></div><button class="btn-quiet" id="export-runs">Export JSON</button></div>
 ${runs.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>Run</th><th>Workflow</th><th>Status</th><th>Steps</th><th>Started</th><th></th></tr></thead><tbody>'+runs.map(r=>`<tr><td>${esc(r.id)}</td><td>${esc(r.workflowName||"Workflow")}</td><td><span class="status ${r.status==="success"?"":"paused"}">${esc(r.status)}</span></td><td>${r.nodeRuns?.length||0}</td><td>${esc(new Date(r.startedAt).toLocaleString())}</td><td><button class="btn-quiet btn-small" data-run-detail="${esc(r.id)}">Details</button></td></tr>`).join("")+'</tbody></table></div>':'<div class="empty-state">No executions recorded yet. Go to Workflows, open a workflow and run a test.</div>'}
 <div id="run-details"></div></section><div class="notice">HTTP Request nodes use browser fetch; cross-origin endpoints may reject requests due to CORS. This is not a secure server-side execution engine.</div>`;
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
 return `<div class="editor-page">
 <div class="editor-topline"><div class="editor-title"><button class="back-link" data-page="Workflows">← Workflows</button><span class="slash">/</span><input class="workflow-name-input" id="workflow-name" value="${esc(wf.name)}" aria-label="Workflow name"><span class="save-state"><i></i> Saved locally</span></div><div class="editor-actions"><button class="btn-quiet" id="export-current">Export</button><button class="btn-quiet" id="toggle-active">${wf.active?"Deactivate":"Activate"}</button><button class="btn-primary" id="run-workflow">▶ Test workflow</button></div></div>
 <div class="editor-toolbar"><div class="toolbar-left"><span class="tiny-pill">${wf.nodes.length} nodes</span><span class="tiny-pill">${wf.edges.length} connections</span>${validation.length?`<span class="pill-error">${validation.length} validation error(s)</span>`:'<span class="pill-ok">✓ Valid structure</span>'}</div><div class="toolbar-right"><button class="icon-btn" id="zoom-out" title="Zoom out">−</button><span id="zoom-level">100%</span><button class="icon-btn" id="zoom-in" title="Zoom in">＋</button><button class="icon-btn" id="fit-canvas" title="Fit view">⤢</button></div></div>
 <div class="editor-layout">
  <aside class="node-palette"><div class="palette-head"><strong>Node library</strong><span class="tiny-pill">${Object.keys(NODE_TYPES).length}</span></div><p class="palette-hint">Select a node to add it to the canvas.</p>
   <div class="palette-section">TRIGGERS</div>${["manual"].map(t=>paletteButton(t)).join("")}
   <div class="palette-section">CORE NODES</div>${["set","http","if","merge","wait","log"].map(t=>paletteButton(t)).join("")}
   <div class="palette-help">Tip: connect a node's right handle to the next node's left handle. Click any node to edit its configuration.</div>
  </aside>
  <section class="canvas-shell"><div class="canvas-notice ${state.connectFrom?"connecting":""}" id="canvas-notice">${state.connectFrom?"Connection mode: select an input handle on the target node.": "Canvas · Drag nodes to arrange the flow"}</div><div class="canvas-scroll" id="canvas-scroll"><div class="canvas-inner" id="canvas-inner" style="transform:scale(${state.zoom});width:2200px;height:1300px"><svg class="edge-layer" id="edge-layer" width="2200" height="1300" viewBox="0 0 2200 1300" aria-label="Workflow connections"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#8f86ed"/></marker></defs>${renderEdges(wf)}</svg>${wf.nodes.map(n=>renderNode(n)).join("")}<div class="canvas-watermark">e11e FLOW <span>VISUAL WORKFLOW</span></div></div></div><div class="canvas-legend"><span><i class="legend-dot manual"></i>Trigger</span><span><i class="legend-dot core"></i>Action</span><span><i class="legend-dot if"></i>Condition</span><span class="legend-note">Click output handle → input handle to connect</span></div></section>
  <aside class="inspector"><div class="inspector-head"><div><strong>Node settings</strong><small>${node?esc(node.name):"Select a node"}</small></div>${node?'<button class="icon-btn" id="delete-node" title="Delete node">⌫</button>':""}</div>${node?renderInspector(node):'<div class="inspector-empty"><div class="empty-node-icon">◇</div><b>No node selected</b><p>Select a node on the canvas to inspect its settings, or choose one from the node library.</p></div>'}</aside>
 </div>
 <div class="run-drawer"><div class="run-drawer-head"><div><b>Test output</b><span>${state.lastRun?esc(state.lastRun.status):"Ready to test"}</span></div><button class="text-link" id="toggle-output">${state.outputCollapsed?"Show":"Hide"}</button></div><div class="run-output ${state.outputCollapsed?"collapsed":""}" id="run-output">${renderLastRun()}</div></div>
 </div>`;
}
function paletteButton(type) { const def=NODE_TYPES[type]; return `<button class="palette-node" data-add-node="${type}"><span class="palette-icon ${def.color}">${def.icon}</span><span><b>${def.label}</b><small>${({manual:"Start the workflow",set:"Set or transform fields",http:"Call an HTTP endpoint",if:"Route on a condition",merge:"Combine object inputs",wait:"Pause briefly",log:"Inspect the output"})[type]}</small></span><span class="palette-plus">＋</span></button>`; }
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
 if(n.type==="if") specific=label("Field path",`<input class="field-input" data-config="field" value="${esc(c.field||"")}" placeholder="user.approved">`)+label("Operator",`<select class="field-input" data-config="operator">${[["equals","Equals"],["not-equals","Does not equal"],["contains","Contains"],["greater-than","Greater than"],["less-than","Less than"],["exists","Exists"],["not-empty","Is not empty"]].map(([v,l])=>`<option value="${v}" ${(c.operator||"equals")===v?"selected":""}>${l}</option>`).join("")}</select>`)+label("Compare value",`<input class="field-input" data-config="value" value="${esc(c.value??"")}" placeholder="true">`)+`<p class="field-help">Connect separate branches using the node's output handle menu. Current canvas connections can be tagged true/false later; use the connector menu on the line to set a branch.</p>`;
 if(n.type==="wait") specific=label("Delay in milliseconds (max 1000 in demo)",`<input class="field-input" type="number" min="0" max="1000" data-config-number="ms" value="${esc(c.ms||0)}">`);
 if(n.type==="manual") specific=`<div class="info-block">The workflow starts at this node when you press <b>Test workflow</b>. The test runner passes sample input unless you configure an input payload in a future backend version.</div>`;
 if(n.type==="merge") specific=`<div class="info-block">The demo executor combines object inputs that have already reached this node. Fan-in execution is simplified in this prototype.</div>`;
 if(n.type==="log") specific=`<div class="info-block">Captures its input as the node output. Inspect the Test output drawer after a run.</div>`;
 const relatedEdges=currentWorkflow().edges.filter(e=>e.source===n.id||e.target===n.id); const connections=relatedEdges.length?relatedEdges.map(e=>{const source=byId(e.source),target=byId(e.target);return `<div class="connection-row"><span>${esc(source?.name||e.source)} <i>→</i> ${esc(target?.name||e.target)}<small>${e.sourceHandle?" · "+esc(e.sourceHandle.toUpperCase())+" branch":""}</small></span><button class="icon-btn" data-delete-edge="${esc(e.id)}" title="Remove connection">×</button></div>`;}).join(""):'<div class="field-help">No connections yet.</div>';\n return `<div class="inspector-form">${label("Display name",`<input class="field-input" data-node-name value="${esc(n.name)}">`)}<div class="field-separator"></div>${specific}<div class="inspector-meta"><span>Node ID</span><code>${esc(n.id)}</code></div><div class="inspector-meta"><span>Node type</span><code>${esc(n.type)}</code></div></div><div class="connections-panel"><div class="connections-title">Connections <span>${relatedEdges.length}</span></div>${connections}</div>`;
}
function renderLastRun() {
 if(state.lastRun) return `<div class="run-summary ${state.lastRun.status}"><span>${state.lastRun.status==="success"?"✓":"!"}</span><div><b>Run ${esc(state.lastRun.status)}</b><small>${esc(new Date(state.lastRun.startedAt).toLocaleTimeString())} · ${state.lastRun.nodeRuns.length} node steps</small></div></div><div class="run-node-list">${state.lastRun.nodeRuns.map((r,i)=>`<details class="run-node" ${i===state.lastRun.nodeRuns.length-1?"open":""}><summary><span class="run-node-icon">${iconFor(r.type)}</span><b>${esc(r.name)}</b><span class="run-status">${esc(r.status)}</span><small>${r.durationMs} ms</small></summary><div class="run-json-grid"><div><label>Input</label><pre>${esc(JSON.stringify(r.input,null,2))}</pre></div><div><label>Output / Error</label><pre>${esc(JSON.stringify(r.output??r.message,null,2))}</pre></div></div></details>`).join("")}</div>`;
 return '<div class="run-empty">Press <b>Test workflow</b> to execute the connected nodes locally and inspect input/output values here.</div>';
}
function render() {
 const root=document.querySelector("#app");
 const pages=["Overview","Workflows","Executions","Integrations","Credentials","Variables","Settings","Documentation"];
 root.innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">e</div><div><div class="brand-name">e11e <span style="color:#9d91ff">Flow</span></div><div class="brand-sub">Automation studio</div></div></div><div class="workspace-badge"><span>◈ &nbsp; Personal workspace</span><small>Local prototype</small></div><div><div class="nav-label">Workspace</div><nav class="nav">${pages.slice(0,5).map(p=>`<button class="${state.page===p?"active":""}" data-page="${p}"><span class="ico">${navIcon(p)}</span>${p}</button>`).join("")}</nav></div><div><div class="nav-label">Manage</div><nav class="nav">${pages.slice(5).map(p=>`<button class="${state.page===p?"active":""}" data-page="${p}"><span class="ico">${navIcon(p)}</span>${p}</button>`).join("")}</nav></div><div class="side-bottom"><div class="health"><div class="health-top"><span class="dot"></span> Client status <span style="margin-left:auto;color:#60d7a5">Online</span></div><p>Browser-local mode. Authentication, server runtime and shared database are not connected.</p><div class="mini-meter"><span></span></div></div><div class="user-profile"><div class="avatar">e</div><div>e11e workspace<small>Browser session</small></div></div></div></aside><main class="main"><header class="topbar"><div class="crumb">Workspace <span style="color:#596580">/</span> <strong>${state.page==="Editor"?"Workflow editor":state.page}</strong></div><div class="top-actions"><div class="search">⌕ &nbsp; Search workflows <span class="kbd">⌘ K</span></div><button class="icon-btn" id="help-button" title="Prototype notes">ⓘ</button><div class="avatar">e</div></div></header><div class="content ${state.page==="Editor"?"content-editor":""}">${state.page==="Overview"?renderDashboard():state.page==="Workflows"?renderWorkflows():state.page==="Executions"?renderExecutions():state.page==="Editor"?renderEditor():renderPlaceholder(state.page)}</div></main></div>`;
 root.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>setPage(b.dataset.page)));
 root.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>openEditor(b.dataset.open)));
 root.querySelector("#create-workflow")?.addEventListener("click",createWorkflow);
 root.querySelectorAll("[data-template]").forEach(b=>b.addEventListener("click",()=>createFromTemplate(b.dataset.template)));
 root.querySelector("#help-button")?.addEventListener("click",()=>toast("Prototype notice: workflow data is saved only in this browser. Do not store secrets here."));
 if(state.page==="Workflows") bindWorkflowList();
 if(state.page==="Executions") bindExecutions();
 if(state.page==="Editor") bindEditor();
}
function createFromTemplate(which) {
 const wf=createDefaultWorkflow(); wf.id=id("wf"); wf.name=which==="webhook"?"Webhook intake":which==="conditional"?"Conditional routing":"Data transform";
 if(which==="conditional") { wf.nodes=[{id:"a",type:"manual",name:"Manual Trigger",x:100,y:130,config:{}},{id:"b",type:"if",name:"Check approved",x:410,y:130,config:{field:"approved",operator:"equals",value:true}},{id:"c",type:"log",name:"Approved output",x:740,y:80,config:{}},{id:"d",type:"log",name:"Rejected output",x:740,y:250,config:{}}];wf.edges=[{id:"ab",source:"a",target:"b"},{id:"bc",source:"b",target:"c",sourceHandle:"true"},{id:"bd",source:"b",target:"d",sourceHandle:"false"}];}
 if(which==="webhook") { wf.nodes=[{id:"a",type:"manual",name:"Manual Trigger",x:100,y:150,config:{}},{id:"b",type:"http",name:"HTTP Request",x:410,y:150,config:{url:"https://jsonplaceholder.typicode.com/todos/1",method:"GET",headers:{},timeoutMs:10000}},{id:"c",type:"log",name:"Inspect response",x:740,y:150,config:{}}];wf.edges=[{id:"ab",source:"a",target:"b"},{id:"bc",source:"b",target:"c"}];}
 workflows.unshift(wf);persist();openEditor(wf.id);
}
function bindWorkflowList() {
 document.querySelector("#export-all")?.addEventListener("click",()=>downloadJSON("e11e-workflows.json",workflows));
 document.querySelector("#import-all")?.addEventListener("change",async e=>{try{const text=await e.target.files[0]?.text();if(!text)return;const parsed=JSON.parse(text);const items=Array.isArray(parsed)?parsed:[parsed];for(const w of items){const errors=validateWorkflow(w);if(errors.length)throw new Error(errors.join(" "));if(!w.id)w.id=id("wf");}workflows=[...items,...workflows.filter(old=>!items.some(w=>w.id===old.id))];persist();toast("Workflow JSON imported.");render();}catch(err){toast("Import failed: "+err.message);}});
 document.querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",()=>{if(!confirm("Delete this workflow from this browser?"))return;workflows=workflows.filter(w=>w.id!==b.dataset.delete);persist();render();}));
}
function bindExecutions() {
 document.querySelector("#clear-runs")?.addEventListener("click",()=>{if(confirm("Clear local execution history?")){state.runs=[];localStorage.setItem(RUNS_KEY,"[]");render();}});
 document.querySelector("#export-runs")?.addEventListener("click",()=>downloadJSON("e11e-executions.json",readRuns()));
 document.querySelectorAll("[data-run-detail]").forEach(b=>b.addEventListener("click",()=>{const r=readRuns().find(run=>run.id===b.dataset.runDetail);const target=document.querySelector("#run-details");if(target)target.innerHTML=`<div class="notice"><b>Run ${esc(r?.id||"")}</b><pre>${esc(JSON.stringify(r,null,2))}</pre></div>`;}));
}
function downloadJSON(name,data) { const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url); }
function bindEditor() {
 const wf=currentWorkflow();
 document.querySelector("#workflow-name")?.addEventListener("change",e=>{wf.name=e.target.value.trim()||"Untitled workflow";markSaved();persist();});
 document.querySelector("#export-current")?.addEventListener("click",()=>downloadJSON((wf.name||"workflow").toLowerCase().replace(/[^a-z0-9]+/g,"-")+".json",wf));
 document.querySelector("#toggle-active")?.addEventListener("click",()=>{wf.active=!wf.active;markSaved();persist();render();toast(wf.active?"Active flag enabled locally. No live trigger was created.":"Workflow active flag disabled.");});
 document.querySelector("#run-workflow")?.addEventListener("click",runCurrentWorkflow);
 document.querySelectorAll("[data-add-node]").forEach(b=>b.addEventListener("click",()=>addNode(b.dataset.addNode)));
 document.querySelectorAll("[data-node-settings]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();state.selectedNodeId=b.dataset.nodeSettings;render();}));
 document.querySelectorAll("[data-node]").forEach(el=>el.addEventListener("click",()=>{if(state.connectFrom){toast("Connect using the small input handle on the target node.");return;}state.selectedNodeId=el.dataset.node;render();}));
 document.querySelectorAll("[data-connect-from]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();state.connectFrom=b.dataset.connectFrom;state.connectBranch=b.dataset.connectBranch||null;state.selectedNodeId=b.dataset.connectFrom;render();toast(state.connectBranch?"Connect the "+state.connectBranch.toUpperCase()+" branch to a target input.":"Now click a target node input handle.");}));
 document.querySelectorAll("[data-connect-to]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();const target=b.dataset.connectTo;if(!state.connectFrom){state.selectedNodeId=target;render();return;}if(state.connectFrom===target){toast("A node cannot connect to itself.");return;}const exists=wf.edges.some(ed=>ed.source===state.connectFrom&&ed.target===target);if(!exists)wf.edges.push({id:id("edge"),source:state.connectFrom,target,...(state.connectBranch?{sourceHandle:state.connectBranch}:{})});state.connectFrom=null;state.connectBranch=null;state.selectedNodeId=target;wf.updatedAt=new Date().toISOString();persist();render();}));
 document.querySelectorAll("[data-drag-handle]").forEach(el=>el.addEventListener("pointerdown",startNodeDrag));
 document.querySelectorAll("[data-config]").forEach(el=>el.addEventListener("change",()=>{const n=byId(state.selectedNodeId);if(!n)return;n.config[el.dataset.config]=el.value;wf.updatedAt=new Date().toISOString();persist();syncNodeCard(n);}));
 document.querySelectorAll("[data-config-number]").forEach(el=>el.addEventListener("change",()=>{const n=byId(state.selectedNodeId);if(!n)return;n.config[el.dataset.configNumber]=Number(el.value);persist();syncNodeCard(n);}));
 document.querySelectorAll("[data-config-bool]").forEach(el=>el.addEventListener("change",()=>{const n=byId(state.selectedNodeId);if(!n)return;n.config[el.dataset.configBool]=el.checked;persist();}));
 document.querySelectorAll("[data-config-json]").forEach(el=>el.addEventListener("change",()=>{const n=byId(state.selectedNodeId);if(!n)return;try{const parsed=JSON.parse(el.value||"{}");if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("Enter a JSON object.");n.config[el.dataset.configJson]=parsed;el.classList.remove("invalid");persist();syncNodeCard(n);}catch(err){el.classList.add("invalid");toast("Invalid JSON: "+err.message);}}));
 document.querySelector("[data-node-name]")?.addEventListener("change",e=>{const n=byId(state.selectedNodeId);if(!n)return;n.name=e.target.value.trim()||NODE_TYPES[n.type].label;persist();render();});
 document.querySelectorAll("[data-delete-edge]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();const edgeId=b.dataset.deleteEdge;const flow=currentWorkflow();flow.edges=flow.edges.filter(edge=>edge.id!==edgeId);flow.updatedAt=new Date().toISOString();persist();render();}));
 document.querySelector("#delete-node")?.addEventListener("click",()=>{const node=byId(state.selectedNodeId);if(!node)return;if(!confirm("Delete this node and its connections?"))return;wf.nodes=wf.nodes.filter(n=>n.id!==node.id);wf.edges=wf.edges.filter(e=>e.source!==node.id&&e.target!==node.id);state.selectedNodeId=null;persist();render();});
 document.querySelector("#zoom-in")?.addEventListener("click",()=>changeZoom(.1));
 document.querySelector("#zoom-out")?.addEventListener("click",()=>changeZoom(-.1));
 document.querySelector("#fit-canvas")?.addEventListener("click",()=>{state.zoom=1;updateZoom();});
 document.querySelector("#toggle-output")?.addEventListener("click",()=>{state.outputCollapsed=!state.outputCollapsed;const panel=document.querySelector("#run-output");panel.classList.toggle("collapsed",state.outputCollapsed);document.querySelector("#toggle-output").textContent=state.outputCollapsed?"Show":"Hide";});
}
function addNode(type) {
 const wf=currentWorkflow();const n={id:id("node"),type,name:NODE_TYPES[type].label,x:120+(wf.nodes.length%4)*80,y:150+(wf.nodes.length%5)*70,config:{}};
 if(type==="set")n.config={fields:{result:"ok"},keepInput:true};
 if(type==="http")n.config={url:"https://jsonplaceholder.typicode.com/todos/1",method:"GET",headers:{},timeoutMs:10000};
 if(type==="if")n.config={field:"approved",operator:"equals",value:true};
 if(type==="wait")n.config={ms:250};
 wf.nodes.push(n);wf.updatedAt=new Date().toISOString();state.selectedNodeId=n.id;persist();render();
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
function refreshEdges(){const layer=document.querySelector("#edge-layer");if(layer)layer.innerHTML='<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#8f86ed"/></marker></defs>'+renderEdges(currentWorkflow());}
function changeZoom(delta){state.zoom=Math.min(1.5,Math.max(.5,Math.round((state.zoom+delta)*10)/10));updateZoom();}
function updateZoom(){const inner=document.querySelector("#canvas-inner");if(inner)inner.style.transform="scale("+state.zoom+")";const label=document.querySelector("#zoom-level");if(label)label.textContent=Math.round(state.zoom*100)+"%";}
function syncNodeCard(n){const el=document.querySelector('[data-node="'+CSS.escape(n.id)+'"]');if(!el)return;const desc=el.querySelector(".node-description");if(desc)desc.textContent=nodeSummary(n);const title=el.querySelector(".node-heading b");if(title)title.textContent=n.name;}
function markSaved(){const s=document.querySelector(".save-state");if(s)s.innerHTML="<i></i> Saved locally";}
async function runCurrentWorkflow() {
 const wf=currentWorkflow();const button=document.querySelector("#run-workflow");button.disabled=true;button.textContent="Running…";
 try {
  const result=await executeWorkflow(wf,{input:{example:"hello from e11e",approved:true,user:{name:"Demo User",email:"demo@example.test"}},maxSteps:100});
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
