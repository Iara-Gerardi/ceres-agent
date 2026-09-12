-- Separate from the retired foundation tables; safe to apply repeatedly.
CREATE TABLE IF NOT EXISTS ceres_documents (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  kind text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ceres_documents_kind_id ON ceres_documents (kind, id);
CREATE INDEX IF NOT EXISTS ceres_documents_run_id ON ceres_documents (run_id);

CREATE TABLE IF NOT EXISTS ceres_document_revisions (
  operation text PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES ceres_documents(id),
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  UNIQUE (document_id, version)
);
