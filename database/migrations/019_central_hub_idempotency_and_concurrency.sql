-- Central Hub phase 2.1 hardening:
-- 1) idempotency key registry
-- 2) optimistic concurrency version on change packages

CREATE TABLE IF NOT EXISTS ceh_idempotency_key (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope VARCHAR(200) NOT NULL,
  idem_key VARCHAR(200) NOT NULL,
  request_hash VARCHAR(128) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  response_code INTEGER,
  response_body JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(scope, idem_key)
);

ALTER TABLE ceh_change_package
  ADD COLUMN IF NOT EXISTS lock_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ceh_idempotency_scope_created
  ON ceh_idempotency_key (scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ceh_idempotency_status
  ON ceh_idempotency_key (status);

DROP TRIGGER IF EXISTS trg_ceh_idempotency_updated_at ON ceh_idempotency_key;
CREATE TRIGGER trg_ceh_idempotency_updated_at
BEFORE UPDATE ON ceh_idempotency_key
FOR EACH ROW EXECUTE FUNCTION ceh_set_updated_at();
