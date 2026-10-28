CREATE TABLE IF NOT EXISTS schedule_trigger_state (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL,
  node_id text NOT NULL,
  last_fired_slot timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, workflow_id, node_id),
  FOREIGN KEY (workspace_id, workflow_id)
    REFERENCES workflows(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS schedule_trigger_state_updated_idx
  ON schedule_trigger_state(updated_at DESC);
