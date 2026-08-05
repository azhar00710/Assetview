-- Register staging: queue approved OCR review tags before promoting to pnid_* links / register.
-- Apply run records who promoted what and from which batches.

CREATE TABLE IF NOT EXISTS register_apply_run (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_id  UUID NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
    batch_ids    UUID[] NOT NULL DEFAULT '{}',
    applied_by   VARCHAR(100) DEFAULT 'user',
    summary      JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_register_apply_run_platform ON register_apply_run(platform_id);

CREATE TABLE IF NOT EXISTS register_staging_item (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_id     UUID NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
    batch_id        UUID NOT NULL REFERENCES ocr_batch(id) ON DELETE CASCADE,
    batch_file_id   UUID REFERENCES ocr_batch_file(id) ON DELETE SET NULL,
    pnid_id         UUID REFERENCES pnid(id) ON DELETE SET NULL,
    entity_kind     VARCHAR(20) NOT NULL,
    action_type     VARCHAR(30) NOT NULL,
    extraction_id   UUID REFERENCES ocr_extraction(id) ON DELETE SET NULL,
    matched_entity_id UUID,
    payload         JSONB NOT NULL DEFAULT '{}',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'applied', 'cancelled')),
    dedupe_key      TEXT NOT NULL,
    apply_run_id    UUID REFERENCES register_apply_run(id) ON DELETE SET NULL,
    applied_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_register_staging_platform_status ON register_staging_item(platform_id, status);
CREATE INDEX IF NOT EXISTS idx_register_staging_batch ON register_staging_item(batch_id);
CREATE INDEX IF NOT EXISTS idx_register_staging_entity ON register_staging_item(platform_id, entity_kind);
