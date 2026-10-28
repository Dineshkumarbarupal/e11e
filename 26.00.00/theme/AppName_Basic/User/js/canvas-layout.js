const NODE_WIDTH = 216;
const NODE_HEIGHT = 126;
const NODE_GAP = 24;
const GRID_X = 300;
const GRID_Y = 200;
const ORIGIN_X = 100;
const ORIGIN_Y = 130;

/**
 * Return the nearest open grid cell near the existing workflow, or null when
 * the bounded placement grid is full. Returned coordinates never overlap an
 * existing node including the visual spacing gap.
 */
export function findAvailableNodePosition(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return { x: 120, y: 160 };
  const positioned = nodes.filter(node => Number.isFinite(node?.x) && Number.isFinite(node?.y));
  if (positioned.length === 0) return { x: 120, y: 160 };

  const centerX = positioned.reduce((sum, node) => sum + node.x + NODE_WIDTH / 2, 0) / positioned.length;
  const centerY = positioned.reduce((sum, node) => sum + node.y + NODE_HEIGHT / 2, 0) / positioned.length;
  const maxX = Math.max(0, ...positioned.map(node => node.x));
  const maxY = Math.max(0, ...positioned.map(node => node.y));
  const cols = Math.min(20, Math.max(7, Math.ceil((maxX + 700) / GRID_X)));
  const rows = Math.min(20, Math.max(6, Math.ceil((maxY + 600) / GRID_Y)));
  const candidates = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = ORIGIN_X + col * GRID_X;
      const y = ORIGIN_Y + row * GRID_Y;
      const collision = positioned.some(node =>
        x < node.x + NODE_WIDTH + NODE_GAP &&
        x + NODE_WIDTH + NODE_GAP > node.x &&
        y < node.y + NODE_HEIGHT + NODE_GAP &&
        y + NODE_HEIGHT + NODE_GAP > node.y
      );
      if (!collision) {
        candidates.push({
          x,
          y,
          score: (x + NODE_WIDTH / 2 - centerX) ** 2 +
            (y + NODE_HEIGHT / 2 - centerY) ** 2
        });
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : null;
}

/** Compute a canvas large enough to leave room around every positioned node. */
export function getCanvasDimensions(nodes = []) {
  const positioned = Array.isArray(nodes)
    ? nodes.filter(node => Number.isFinite(node?.x) && Number.isFinite(node?.y))
    : [];
  return {
    width: Math.max(2200, ...positioned.map(node => Math.ceil((node.x + 520) / 100) * 100)),
    height: Math.max(1300, ...positioned.map(node => Math.ceil((node.y + 300) / 100) * 100))
  };
}
