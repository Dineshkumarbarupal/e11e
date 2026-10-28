CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  definition jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS workflows_workspace_updated_idx ON workflows(workspace_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS executions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','success','error','cancelled')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  node_runs jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  FOREIGN KEY (workspace_id, workflow_id) REFERENCES workflows(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS executions_workspace_queued_idx ON executions(workspace_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS executions_workflow_idx ON executions(workflow_id, queued_at DESC);
CREATE TABLE IF NOT EXISTS credentials (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  service text NOT NULL,
  encrypted_payload jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_workspace_created_idx ON audit_logs(workspace_id, created_at DESC);
