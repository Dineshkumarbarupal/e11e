ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'manual';
ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS trigger_node_id text;

CREATE TABLE IF NOT EXISTS webhook_tokens (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL,
  node_id text NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, workflow_id, node_id),
  FOREIGN KEY (workspace_id, workflow_id)
    REFERENCES workflows(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS webhook_tokens_workflow_idx ON webhook_tokens(workflow_id);
