-- ═══════════════════════════════════════════════════════════════════
-- ASSETVIEW v3 MIGRATION: Expanded Hierarchy + Transmittal System
-- Run AFTER schema.sql and seed.sql
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. NEW TABLES: client, project ═══

CREATE TABLE IF NOT EXISTS client (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(200) NOT NULL,
    code            VARCHAR(50) NOT NULL UNIQUE,
    description     TEXT,
    contact_name    VARCHAR(200),
    contact_email   VARCHAR(200),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      VARCHAR(100),
    updated_by      VARCHAR(100),
    deleted_at      TIMESTAMPTZ
);

CREATE TRIGGER trg_client_updated BEFORE UPDATE ON client
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS project (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES client(id),
    name            VARCHAR(200) NOT NULL,
    code            VARCHAR(50) NOT NULL,
    project_type    VARCHAR(100),
    description     TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      VARCHAR(100),
    updated_by      VARCHAR(100),
    deleted_at      TIMESTAMPTZ,
    UNIQUE(client_id, code)
);

CREATE TRIGGER trg_project_updated BEFORE UPDATE ON project
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══ 2. ADD project_id TO concession ═══

ALTER TABLE concession ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES project(id);

-- ═══ 3. RENAME field TO location ═══

-- Create location table (safer than ALTER TABLE RENAME for FK references)
CREATE TABLE IF NOT EXISTS location (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concession_id   UUID NOT NULL REFERENCES concession(id),
    name            VARCHAR(200) NOT NULL,
    code            VARCHAR(50) NOT NULL,
    location_type   VARCHAR(100),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      VARCHAR(100),
    updated_by      VARCHAR(100),
    deleted_at      TIMESTAMPTZ,
    UNIQUE(concession_id, code)
);

CREATE TRIGGER trg_location_updated BEFORE UPDATE ON location
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_location_concession ON location(concession_id) WHERE deleted_at IS NULL;

-- ═══ 4. ADD location_id TO complex, keep field_id temporarily ═══

ALTER TABLE complex ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES location(id);

-- ═══ 5. TRANSMITTAL SYSTEM ═══

CREATE TABLE IF NOT EXISTS transmittal (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_number    VARCHAR(100) NOT NULL,
    platform_id         UUID NOT NULL REFERENCES platform(id),
    description         TEXT,
    upload_date         TIMESTAMPTZ DEFAULT NOW(),
    uploaded_by         VARCHAR(100),
    document_count      INTEGER DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'open',
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    UNIQUE(platform_id, reference_number)
);

CREATE TRIGGER trg_transmittal_updated BEFORE UPDATE ON transmittal
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_transmittal_platform ON transmittal(platform_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS document_upload (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transmittal_id      UUID NOT NULL REFERENCES transmittal(id) ON DELETE CASCADE,
    document_type       VARCHAR(50) NOT NULL,
    original_filename   VARCHAR(500) NOT NULL,
    parsed_identifier   VARCHAR(200),
    revision            VARCHAR(20),
    entity_id           UUID,
    version_id          UUID,
    storage_key         VARCHAR(500),
    file_size_bytes     BIGINT,
    file_checksum       VARCHAR(128),
    record_count        INTEGER,
    records_created     INTEGER DEFAULT 0,
    records_updated     INTEGER DEFAULT 0,
    records_errors      INTEGER DEFAULT 0,
    parse_errors        JSONB DEFAULT '[]',
    status              VARCHAR(20) DEFAULT 'draft',
    approved_at         TIMESTAMPTZ,
    approved_by         VARCHAR(100),
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    created_by          VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_document_upload_transmittal ON document_upload(transmittal_id);
CREATE INDEX IF NOT EXISTS idx_document_upload_entity ON document_upload(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_document_upload_status ON document_upload(status);

-- Add transmittal_id to pnid_version
ALTER TABLE pnid_version ADD COLUMN IF NOT EXISTS transmittal_id UUID REFERENCES transmittal(id);
CREATE INDEX IF NOT EXISTS idx_pnid_version_transmittal ON pnid_version(transmittal_id) WHERE transmittal_id IS NOT NULL;

-- ═══ 6. LIST UPLOAD VERSION (for line lists, equipment lists) ═══

CREATE TABLE IF NOT EXISTS list_upload_version (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_id         UUID NOT NULL REFERENCES platform(id),
    list_type           VARCHAR(50) NOT NULL,
    version_number      INTEGER NOT NULL,
    revision            VARCHAR(20),
    transmittal_id      UUID REFERENCES transmittal(id),
    document_upload_id  UUID REFERENCES document_upload(id),
    original_filename   VARCHAR(500),
    storage_key         VARCHAR(500),
    record_count        INTEGER,
    records_created     INTEGER DEFAULT 0,
    records_updated     INTEGER DEFAULT 0,
    records_deleted     INTEGER DEFAULT 0,
    change_summary      TEXT,
    status              VARCHAR(20) DEFAULT 'draft',
    snapshot_data       JSONB,
    batch_id            UUID,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    created_by          VARCHAR(100),
    superseded_at       TIMESTAMPTZ,
    superseded_by       VARCHAR(100),
    UNIQUE(platform_id, list_type, version_number)
);

CREATE INDEX IF NOT EXISTS idx_list_upload_version_platform ON list_upload_version(platform_id);

-- ═══ 7. DATA MIGRATION ═══

-- Create default client from concession operator
INSERT INTO client (id, name, code)
SELECT 'aa000000-0000-0000-0000-000000000001'::uuid, 'ADMA-OPCO', 'ADMA-OPCO'
WHERE NOT EXISTS (SELECT 1 FROM client WHERE code = 'ADMA-OPCO');

-- Create default project
INSERT INTO project (id, client_id, name, code, project_type)
SELECT 'ab000000-0000-0000-0000-000000000001'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'AD219 Development', 'AD219', 'brownfield'
WHERE NOT EXISTS (SELECT 1 FROM project WHERE code = 'AD219');

-- Link concessions to project
UPDATE concession SET project_id = 'ab000000-0000-0000-0000-000000000001'::uuid
WHERE project_id IS NULL;

-- Copy field data to location
INSERT INTO location (id, concession_id, name, code, location_type, metadata, created_at, updated_at, deleted_at)
SELECT id, concession_id, name, code, field_type, metadata, created_at, updated_at, deleted_at
FROM field
WHERE NOT EXISTS (SELECT 1 FROM location WHERE location.id = field.id);

-- Update complex.location_id from field_id
UPDATE complex SET location_id = field_id WHERE location_id IS NULL;

-- Make project_id NOT NULL (after data migration)
ALTER TABLE concession ALTER COLUMN project_id SET NOT NULL;

-- Fix concession code uniqueness: per-project, not global
ALTER TABLE concession DROP CONSTRAINT IF EXISTS concession_code_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'concession_project_code_unique') THEN
    ALTER TABLE concession ADD CONSTRAINT concession_project_code_unique UNIQUE(project_id, code);
  END IF;
END $$;

-- Make location_id NOT NULL (after data migration)
ALTER TABLE complex ALTER COLUMN location_id SET NOT NULL;
