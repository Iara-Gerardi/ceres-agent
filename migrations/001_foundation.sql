BEGIN;
CREATE SCHEMA IF NOT EXISTS ceres;
CREATE TABLE IF NOT EXISTS ceres.workspaces (
 id uuid PRIMARY KEY, owner_id text NOT NULL, expires_at timestamptz,
 config jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ceres.documents (
 workspace_id uuid NOT NULL REFERENCES ceres.workspaces(id) ON DELETE CASCADE,
 id uuid NOT NULL, run_id uuid NOT NULL, kind text NOT NULL,
 version integer NOT NULL CHECK (version > 0), body jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ceres.history (
 workspace_id uuid NOT NULL REFERENCES ceres.workspaces(id) ON DELETE CASCADE,
 id uuid NOT NULL, document_id uuid NOT NULL, run_id uuid NOT NULL,
 operation text NOT NULL, version integer NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,operation),
 FOREIGN KEY(workspace_id,document_id) REFERENCES ceres.documents(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS documents_run ON ceres.documents(workspace_id,run_id);
CREATE INDEX IF NOT EXISTS history_record ON ceres.history(workspace_id,document_id,version);
ALTER TABLE ceres.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ceres.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE ceres.history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ceres.history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_scope ON ceres.documents;
CREATE POLICY workspace_scope ON ceres.documents USING (workspace_id = nullif(current_setting('ceres.workspace_id',true),'')::uuid) WITH CHECK (workspace_id = nullif(current_setting('ceres.workspace_id',true),'')::uuid);
DROP POLICY IF EXISTS workspace_scope ON ceres.history;
CREATE POLICY workspace_scope ON ceres.history USING (workspace_id = nullif(current_setting('ceres.workspace_id',true),'')::uuid) WITH CHECK (workspace_id = nullif(current_setting('ceres.workspace_id',true),'')::uuid);
COMMIT;
