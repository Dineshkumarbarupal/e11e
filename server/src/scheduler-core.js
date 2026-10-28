import { cronMatches, isValidCronExpression } from "./cron-schedule.js";

export function minuteSlot(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("A valid Date is required.");
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes())).toISOString();
}

/**
 * Select schedule nodes whose five-field cron expression matches this UTC minute.
 * The function is pure so scheduler matching can be tested without live services.
 */
export function collectDueScheduleNodes(workflowRows, date = new Date()) {
  const slot = minuteSlot(date);
  const slotDate = new Date(slot);
  const due = [];
  const invalid = [];

  for (const row of Array.isArray(workflowRows) ? workflowRows : []) {
    if (!row || row.active !== true) continue;
    const workflowId = row.id || row.workflow_id;
    const workspaceId = row.workspace_id || row.workspaceId;
    const definition = typeof row.definition === "string" ? safeParse(row.definition) : row.definition;
    if (!workflowId || !workspaceId || !definition || !Array.isArray(definition.nodes)) continue;

    for (const node of definition.nodes) {
      if (node?.type !== "schedule") continue;
      const expression = String(node.config?.cron || "");
      const key = [workspaceId, workflowId, node.id].join(":");
      if (!isValidCronExpression(expression)) {
        invalid.push({ key, workflowId, nodeId: node.id, expression });
        continue;
      }
      if (cronMatches(expression, slotDate)) {
        due.push({ key, workspaceId, workflowId, nodeId: node.id, cron: expression, slot });
      }
    }
  }
  return { slot, due, invalid };
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}
