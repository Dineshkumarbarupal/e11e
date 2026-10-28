import test from "node:test";
import assert from "node:assert/strict";
import { diffWorkflowDefinitions } from "../26.00.00/theme/AppName_Basic/User/js/workflow-version-diff.js";

test("workflow diff ignores object key ordering but preserves array order", () => {
  const before = { name: "Flow", config: { b: 2, a: 1 }, nodes: ["a", "b"] };
  const same = { nodes: ["a", "b"], config: { a: 1, b: 2 }, name: "Flow" };
  assert.deepEqual(diffWorkflowDefinitions(before, same), []);
  assert.equal(diffWorkflowDefinitions(before, { ...same, nodes: ["b", "a"] }).length, 1);
});

test("workflow diff reports nested changed, added and removed paths deterministically", () => {
  const before = {
    name: "Old",
    nodes: [{ id: "node-a", config: { url: "https://old.example.test", retry: 2 } }],
    obsolete: true
  };
  const after = {
    name: "New",
    nodes: [{ id: "node-a", config: { url: "https://new.example.test", timeout: 5000 } }],
    added: { enabled: true }
  };
  const changes = diffWorkflowDefinitions(before, after);
  assert.deepEqual(changes.map(change => change.path), [
    "$.added",
    "$.name",
    "$.nodes",
    "$.obsolete"
  ]);
  assert.equal(changes.find(change => change.path === "$.name").beforeValue, "Old");
  assert.equal(changes.find(change => change.path === "$.added").beforeExists, false);
  assert.equal(changes.find(change => change.path === "$.obsolete").afterExists, false);
});

test("workflow diff uses bracket notation for unusual keys and distinguishes missing from null", () => {
  const changes = diffWorkflowDefinitions({ "a.b": null }, {});
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, '$["a.b"]');
  assert.equal(changes[0].beforeExists, true);
  assert.equal(changes[0].beforeValue, null);
  assert.equal(changes[0].afterExists, false);
});

test("workflow diff reports a root-level change when one definition is absent", () => {
  assert.deepEqual(diffWorkflowDefinitions(undefined, { name: "Flow" }), [{
    path: "$",
    beforeExists: false,
    afterExists: true,
    beforeValue: undefined,
    afterValue: { name: "Flow" }
  }]);
});

test("workflow diff is stable for differently ordered nested objects inside arrays", () => {
  const before = { nodes: [{ id: "a", config: { key: "v", enabled: true } }] };
  const after = { nodes: [{ config: { enabled: true, key: "v" }, id: "a" }] };
  assert.deepEqual(diffWorkflowDefinitions(before, after), []);
});
