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
  assert.ok(css.length > 5000 && baseCss.length > 5000);
  assert.ok(app.includes('from "./workflow-engine.js"'));
  assert.ok(app.includes('from "./canvas-layout.js"'));
  assert.ok(engine.includes("export async function executeWorkflow"));
  assert.ok(layout.includes("export function findAvailableNodePosition"));
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
