CREATE TABLE IF NOT EXISTS workflow_versions (
  workspace_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  active boolean NOT NULL,
  definition jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, workflow_id, version),
  FOREIGN KEY (workspace_id, workflow_id)
    REFERENCES workflows(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS workflow_versions_lookup_idx
  ON workflow_versions(workspace_id, workflow_id, version DESC);

-- Preserve the current version of every existing workflow before enabling the trigger.
INSERT INTO workflow_versions(workspace_id, workflow_id, version, name, active, definition, created_by, created_at)
SELECT workspace_id, id, version, name, active, definition, updated_by, updated_at
FROM workflows
ON CONFLICT (workspace_id, workflow_id, version) DO NOTHING;

CREATE OR REPLACE FUNCTION snapshot_workflow_version()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.version = OLD.version
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.active IS NOT DISTINCT FROM OLD.active
     AND NEW.definition IS NOT DISTINCT FROM OLD.definition THEN
    RETURN NEW;
  END IF;

  INSERT INTO workflow_versions(workspace_id, workflow_id, version, name, active, definition, created_by, created_at)
  VALUES (NEW.workspace_id, NEW.id, NEW.version, NEW.name, NEW.active, NEW.definition, NEW.updated_by, COALESCE(NEW.updated_at, now()))
  ON CONFLICT (workspace_id, workflow_id, version) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workflows_version_snapshot ON workflows;
CREATE TRIGGER workflows_version_snapshot
AFTER INSERT OR UPDATE ON workflows
FOR EACH ROW EXECUTE FUNCTION snapshot_workflow_version();
