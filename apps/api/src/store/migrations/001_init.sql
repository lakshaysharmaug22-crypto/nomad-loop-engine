-- 001: runs, their ordered event log, and regression sweeps.
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  target      TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'finished', 'failed', 'stopped')),
  policy      TEXT,
  error       TEXT,
  stats       JSONB,
  graph       JSONB,
  bugs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs (created_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
  run_id   TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL,
  type     TEXT NOT NULL,
  payload  JSONB NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE INDEX IF NOT EXISTS run_events_type_idx ON run_events (run_id, type);

CREATE TABLE IF NOT EXISTS sweeps (
  id             TEXT PRIMARY KEY,
  source_run_id  TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  target         TEXT NOT NULL,
  label          TEXT,
  status         TEXT NOT NULL,
  items          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL,
  finished_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sweeps_source_idx ON sweeps (source_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
