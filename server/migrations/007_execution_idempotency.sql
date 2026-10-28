CREATE TABLE IF NOT EXISTS execution_idempotency (
  workspace_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  idempotency_key_hash char(64) NOT NULL,
  request_hash char(64) NOT NULL,
  execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, workflow_id, idempotency_key_hash),
  UNIQUE (execution_id),
  FOREIGN KEY (workspace_id, workflow_id)
    REFERENCES workflows(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS execution_idempotency_created_idx
  ON execution_idempotency(created_at DESC);
