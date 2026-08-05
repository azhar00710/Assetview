-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v2.1: Storage Abstraction, P&ID Versioning, Change Log
-- Run AFTER schema.sql and seed.sql
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. STORAGE CONFIGURATION ═══
-- Supports per-scope storage backends (global, per-concession, per-platform)

CREATE TABLE IF NOT EXISTS storage_config (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope_type      VARCHAR(20) NOT NULL DEFAULT 'global',  -- global | concession | platform
    scope_id        UUID,  -- NULL for global, FK for concession/platform
    provider        VARCHAR(20) NOT NULL,  -- s3 | azure | gcs | local
    bucket_or_container TEXT,
    region          VARCHAR(50),
    endpoint_url    TEXT,               -- custom endpoint for S3-compatible / local serve URL
    base_path       TEXT,               -- base prefix within bucket or local path
    credentials_ref TEXT,               -- reference to secret manager, NOT stored in DB
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scope_type, scope_id)
);

CREATE TRIGGER trg_storage_config_updated BEFORE UPDATE ON storage_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══ 2. P&ID TABLE EXTENSIONS ═══
-- Add storage reference columns to existing pnid table

ALTER TABLE pnid ADD COLUMN IF NOT EXISTS storage_key VARCHAR(500);
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS thumbnail_key VARCHAR(500);
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS file_checksum VARCHAR(128);
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT 1;
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR(100);
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS active_version_id UUID;

-- ═══ 3. P&ID VERSION HISTORY ═══
-- Each revision of a P&ID creates a version record; files are immutable per version

CREATE TABLE IF NOT EXISTS pnid_version (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_id               UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
    version_number        INTEGER NOT NULL,
    revision              VARCHAR(20) NOT NULL,
    storage_key           VARCHAR(500) NOT NULL,       -- rendered image key
    pdf_storage_key       VARCHAR(500),                -- original PDF key
    thumbnail_key         VARCHAR(500),
    file_checksum         VARCHAR(128),
    file_size_bytes       BIGINT,
    change_summary        TEXT,
    change_type           VARCHAR(50) DEFAULT 'minor_update',  -- minor_update | equipment_change | layout_change | full_redraw
    status                VARCHAR(20) DEFAULT 'draft',         -- draft | active | superseded
    annotation_snapshot_id UUID,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    created_by            VARCHAR(100),
    superseded_at         TIMESTAMPTZ,
    superseded_by         VARCHAR(100),
    UNIQUE(pnid_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_pnid_version_pnid ON pnid_version(pnid_id);
CREATE INDEX IF NOT EXISTS idx_pnid_version_active ON pnid_version(pnid_id) WHERE status = 'active';

-- FK from pnid to active version (deferred to avoid circular dependency on insert)
ALTER TABLE pnid ADD CONSTRAINT fk_pnid_active_version
    FOREIGN KEY (active_version_id) REFERENCES pnid_version(id)
    DEFERRABLE INITIALLY DEFERRED;

-- ═══ 4. ANNOTATION SNAPSHOTS ═══
-- Frozen copy of all annotation positions at the time a version is superseded

CREATE TABLE IF NOT EXISTS annotation_snapshot (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_version_id   UUID NOT NULL REFERENCES pnid_version(id) ON DELETE CASCADE,
    snapshot_data     JSONB NOT NULL,  -- { equipment: [...], instruments: [...], annotations: [...] }
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Link snapshot back to version
ALTER TABLE pnid_version ADD CONSTRAINT fk_pnid_version_snapshot
    FOREIGN KEY (annotation_snapshot_id) REFERENCES annotation_snapshot(id)
    DEFERRABLE INITIALLY DEFERRED;

-- ═══ 5. ANNOTATION POSITION VERIFICATION ═══
-- Track whether annotation positions have been verified after a P&ID version change

ALTER TABLE pnid_equipment ADD COLUMN IF NOT EXISTS position_verified BOOLEAN DEFAULT true;
ALTER TABLE pnid_equipment ADD COLUMN IF NOT EXISTS verified_for_version UUID;

ALTER TABLE pnid_instrument ADD COLUMN IF NOT EXISTS position_verified BOOLEAN DEFAULT true;
ALTER TABLE pnid_instrument ADD COLUMN IF NOT EXISTS verified_for_version UUID;

-- ═══ 6. CHANGE LOG (AUDIT TRAIL) ═══

CREATE TABLE IF NOT EXISTS change_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type     VARCHAR(50) NOT NULL,   -- pnid | line | equipment | instrument | system | storage_config
    entity_id       UUID NOT NULL,
    action          VARCHAR(20) NOT NULL,   -- create | update | delete | upload | version | import
    changes         JSONB,                  -- { field: { old: "...", new: "..." } }
    source          VARCHAR(50),            -- manual | csv_import | api | upload
    batch_id        UUID,                   -- Groups changes from same import operation
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_change_log_entity ON change_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_change_log_batch ON change_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_change_log_created ON change_log(created_at DESC);

-- ═══ VERIFICATION ═══
SELECT 'Migration v2.1 complete' AS status,
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'storage_config') AS storage_config_exists,
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'pnid_version') AS pnid_version_exists,
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'annotation_snapshot') AS annotation_snapshot_exists,
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'change_log') AS change_log_exists;
