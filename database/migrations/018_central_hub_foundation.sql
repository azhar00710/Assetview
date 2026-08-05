-- Central Engineering Hub foundation schema
-- Safe to re-run (idempotent) with migrationRunner.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ceh_deployment_mode') THEN
    CREATE TYPE ceh_deployment_mode AS ENUM (
      'SAAS_MULTI_TENANT',
      'SINGLE_TENANT_CLOUD',
      'ON_PREMISE',
      'HYBRID'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ceh_change_package_status') THEN
    CREATE TYPE ceh_change_package_status AS ENUM (
      'DRAFT',
      'SUBMITTED',
      'VALIDATED',
      'MAPPED',
      'REVIEW_REQUIRED',
      'APPROVED',
      'INJECTED',
      'PUBLISHED',
      'REJECTED',
      'NEEDS_REWORK',
      'CANCELLED'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ceh_approval_decision') THEN
    CREATE TYPE ceh_approval_decision AS ENUM ('APPROVE', 'REJECT', 'REQUEST_REWORK');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS ceh_tenant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code VARCHAR(50) NOT NULL UNIQUE,
  tenant_name VARCHAR(200) NOT NULL,
  deployment_mode ceh_deployment_mode NOT NULL,
  data_residency VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ceh_tenant_module (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES ceh_tenant(id) ON DELETE CASCADE,
  module_name VARCHAR(100) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, module_name)
);

CREATE TABLE IF NOT EXISTS ceh_module_client (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES ceh_tenant(id) ON DELETE CASCADE,
  module_name VARCHAR(100) NOT NULL,
  auth_type VARCHAR(50) NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  callback_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ceh_change_package (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES ceh_tenant(id) ON DELETE CASCADE,
  package_ref VARCHAR(100) NOT NULL UNIQUE,
  source_system VARCHAR(100) NOT NULL,
  source_org VARCHAR(200),
  package_type VARCHAR(50) NOT NULL,
  status ceh_change_package_status NOT NULL DEFAULT 'DRAFT',
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ceh_approval_decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_package_id UUID NOT NULL REFERENCES ceh_change_package(id) ON DELETE CASCADE,
  approver_role VARCHAR(100) NOT NULL,
  approver_id VARCHAR(150) NOT NULL,
  decision ceh_approval_decision NOT NULL,
  reason TEXT,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ceh_change_package_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_package_id UUID NOT NULL REFERENCES ceh_change_package(id) ON DELETE CASCADE,
  from_status ceh_change_package_status,
  to_status ceh_change_package_status NOT NULL,
  action VARCHAR(50) NOT NULL,
  actor_id VARCHAR(150),
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ceh_satellite_checkpoint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES ceh_tenant(id) ON DELETE CASCADE,
  satellite_id VARCHAR(100) NOT NULL,
  checkpoint VARCHAR(200),
  last_event_id VARCHAR(200),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, satellite_id)
);

CREATE TABLE IF NOT EXISTS ceh_event_subscription (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES ceh_tenant(id) ON DELETE CASCADE,
  event_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cp_event_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(50) NOT NULL DEFAULT 'change_package',
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(200) NOT NULL,
  event_key VARCHAR(200),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ceh_tenant_module_tenant ON ceh_tenant_module (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ceh_module_client_tenant ON ceh_module_client (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ceh_change_package_tenant_status ON ceh_change_package (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ceh_change_package_created ON ceh_change_package (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ceh_approval_decision_package ON ceh_approval_decision_log (change_package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ceh_checkpoint_tenant_satellite ON ceh_satellite_checkpoint (tenant_id, satellite_id);
CREATE INDEX IF NOT EXISTS idx_ceh_event_subscription_tenant_active ON ceh_event_subscription (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_cp_event_outbox_unpublished ON cp_event_outbox (created_at ASC) WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION ceh_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ceh_tenant_updated_at ON ceh_tenant;
CREATE TRIGGER trg_ceh_tenant_updated_at
BEFORE UPDATE ON ceh_tenant
FOR EACH ROW EXECUTE FUNCTION ceh_set_updated_at();

DROP TRIGGER IF EXISTS trg_ceh_tenant_module_updated_at ON ceh_tenant_module;
CREATE TRIGGER trg_ceh_tenant_module_updated_at
BEFORE UPDATE ON ceh_tenant_module
FOR EACH ROW EXECUTE FUNCTION ceh_set_updated_at();

DROP TRIGGER IF EXISTS trg_ceh_module_client_updated_at ON ceh_module_client;
CREATE TRIGGER trg_ceh_module_client_updated_at
BEFORE UPDATE ON ceh_module_client
FOR EACH ROW EXECUTE FUNCTION ceh_set_updated_at();

DROP TRIGGER IF EXISTS trg_ceh_change_package_updated_at ON ceh_change_package;
CREATE TRIGGER trg_ceh_change_package_updated_at
BEFORE UPDATE ON ceh_change_package
FOR EACH ROW EXECUTE FUNCTION ceh_set_updated_at();

DROP TRIGGER IF EXISTS trg_ceh_event_subscription_updated_at ON ceh_event_subscription;
CREATE TRIGGER trg_ceh_event_subscription_updated_at
BEFORE UPDATE ON ceh_event_subscription
FOR EACH ROW EXECUTE FUNCTION ceh_set_updated_at();
