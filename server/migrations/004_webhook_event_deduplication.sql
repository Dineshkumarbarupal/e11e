ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS dedupe_key char(64);

CREATE UNIQUE INDEX IF NOT EXISTS executions_webhook_dedupe_unique_idx
  ON executions(workspace_id, workflow_id, trigger_node_id, dedupe_key)
  WHERE trigger_type='webhook' AND dedupe_key IS NOT NULL;
