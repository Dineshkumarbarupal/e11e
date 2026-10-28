import test from "node:test";
import assert from "node:assert/strict";
import { findAvailableNodePosition, getCanvasDimensions } from "../26.00.00/theme/AppName_Basic/User/js/canvas-layout.js";

test("canvas node placement returns a default position for an empty workflow", () => {
  assert.deepEqual(findAvailableNodePosition([]), { x: 120, y: 160 });
});

test("canvas node placement avoids overlap and keeps a visual gap", () => {
  const nodes = [
    { id: "a", x: 90, y: 180 },
    { id: "b", x: 390, y: 180 },
    { id: "c", x: 690, y: 180 }
  ];
  const position = findAvailableNodePosition(nodes);
  assert.ok(position, "an available canvas position should exist");
  for (const node of nodes) {
    const overlaps = position.x < node.x + 240 &&
      position.x + 240 > node.x &&
      position.y < node.y + 150 &&
      position.y + 150 > node.y;
    assert.ok(!overlaps, `new node overlaps ${node.id}`);
  }
});

test("canvas dimensions expand when nodes are dragged beyond default bounds", () => {
  const dimensions = getCanvasDimensions([{ id: "far", x: 2510, y: 1510 }]);
  assert.ok(dimensions.width >= 3030);
  assert.ok(dimensions.height >= 1810);
});

test("canvas dimensions keep a useful minimum size", () => {
  assert.deepEqual(getCanvasDimensions([]), { width: 2200, height: 1300 });
});

test("node placement returns null when every supported grid cell is occupied", () => {
  const nodes = [];
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 20; col += 1) {
      nodes.push({ id: `${row}-${col}`, x: 100 + col * 300, y: 130 + row * 200 });
    }
  }
  assert.equal(findAvailableNodePosition(nodes), null);
});
