import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readRepoFile = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const UI_ROOT = "26.00.00/theme/AppName_Basic/User/";

test("entry point loads base CSS before premium overrides and the app module", async () => {
  const html = await readRepoFile("index.html");
  const baseIndex = html.indexOf("/css/app.css");
  const premiumIndex = html.indexOf("/css/premium.css");
  const appIndex = html.indexOf("/js/app.js");
  assert.ok(baseIndex >= 0, "base stylesheet should be linked");
  assert.ok(premiumIndex > baseIndex, "premium overrides should load after base CSS");
  assert.ok(appIndex > premiumIndex, "application module should load after stylesheets");
  assert.match(html, /name="viewport"/);
});

test("all referenced UI assets exist in the repository", async () => {
  const html = await readRepoFile("index.html");
  const css = await readRepoFile(UI_ROOT + "css/premium.css");
  const baseCss = await readRepoFile(UI_ROOT + "css/app.css");
  const app = await readRepoFile(UI_ROOT + "js/app.js");
  const engine = await readRepoFile(UI_ROOT + "js/workflow-engine.js");
  const layout = await readRepoFile(UI_ROOT + "js/canvas-layout.js");
  const cron = await readRepoFile(UI_ROOT + "js/cron-schedule.js");
  assert.ok(css.length > 5000 && baseCss.length > 5000);
  assert.ok(app.includes('from "./workflow-engine.js"'));
  assert.ok(app.includes('from "./canvas-layout.js"'));
  assert.ok(engine.includes("export async function executeWorkflow"));
  assert.ok(layout.includes("export function findAvailableNodePosition"));
  assert.ok(cron.includes("export function isValidCronExpression"));
  assert.ok(app.includes('from "./cron-schedule.js"'));
});

test("premium CSS has balanced braces and parentheses", async () => {
  const css = await readRepoFile(UI_ROOT + "css/premium.css");
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
  assert.equal((css.match(/\(/g) || []).length, (css.match(/\)/g) || []).length);
  assert.match(css, /@media\s*\(max-width:\s*620px\)/);
  assert.match(css, /:focus-visible/);
});

test("workflow editor includes search, fit, keyboard controls, and editable JSON test input", async () => {
  const app = await readRepoFile(UI_ROOT + "js/app.js");
  assert.match(app, /id="global-search"/);
  assert.match(app, /id="workflow-filter"/);
  assert.match(app, /function fitCanvasView\(\)/);
  assert.match(app, /id="run-input"/);
  assert.match(app, /event\.key==="Escape"/);
  assert.match(app, /aria-label="Workflow node/);
});

test("index uses versioned style and script URLs to reduce stale UI caching", async () => {
  const html = await readRepoFile("index.html");
  assert.match(html, /premium\.css\?v=/);
  assert.match(html, /app\.js\?v=/);
});


test("HTTP node inspector exposes workspace credential references and secure egress guidance", async () => {
  const app = await readRepoFile("26.00.00/theme/AppName_Basic/User/js/app.js");
  assert.match(app, /data-config="credentialId"/);
  assert.match(app, /data-config="credentialField"/);
  assert.match(app, /data-config="credentialHeader"/);
  assert.match(app, /data-config="credentialPrefix"/);
  assert.match(app, /HTTP_ALLOWED_HOSTS/);
  assert.match(app, /Private IPs, non-HTTPS URLs and redirects are blocked/);
});

test("credential vault makes IDs copyable for secure HTTP node configuration", async () => {
  const app = await readRepoFile("26.00.00/theme/AppName_Basic/User/js/app.js");
  assert.match(app, /data-credential-copy=/);
  assert.match(app, /Credential ID copied/);
  assert.match(app, /Copy ID/);
});

test("main HTML cache-bust version is consistent across all UI assets", async () => {
  const html = await readRepoFile("index.html");
  const versions = [...html.matchAll(/\\?v=([0-9-]+)/g)].map(match => match[1]);
  assert.ok(versions.length >= 3);
  assert.ok(versions.every(version => version === versions[0]), "all UI assets should use the same cache version");
});


test("webhook signature option and one-time signing-secret controls are visible", async () => {
  const app = await readRepoFile("26.00.00/theme/AppName_Basic/User/js/app.js");
  assert.match(app, /data-config-bool="requireSignature"/);
  assert.match(app, /Require signed payload \(HMAC-SHA256\)/);
  assert.match(app, /signatureSecret/);
  assert.match(app, /copy-webhook-signature-secret/);
  assert.match(app, /x-e11e-webhook-timestamp/);
  assert.match(app, /x-e11e-event-id/);
  assert.match(app, /event ID \+ "\." \+ canonical JSON body/);
  assert.match(app, /x-e11e-webhook-signature/);
});


test("credential vault exposes encrypted secret rotation without secret read-back", async () => {
  const app = await readRepoFile("26.00.00/theme/AppName_Basic/User/js/app.js");
  assert.match(app, /data-credential-rotate=/);
  assert.match(app, /method: "PUT"/);
  assert.match(app, /Credential secret rotated and encrypted/);
  assert.match(app, /The existing secret is never displayed/);
});
