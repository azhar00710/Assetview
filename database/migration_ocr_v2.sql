-- ============================================================================
-- OCR Pipeline V2 — Processing History & Batch Tracking
-- ============================================================================
-- Tracks per-platform OCR processing history, storage file references,
-- and result exports for the Annotation module handoff.
-- Run after migration_ocr.sql
-- Usage: psql $DATABASE_URL -f database/migration_ocr_v2.sql
-- ============================================================================

-- ─── OCR Batch — groups of files processed together ──────────────────────────

CREATE TABLE IF NOT EXISTS ocr_batch (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_id     UUID NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
    batch_name      VARCHAR(200),
    status          VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'failed')),

    -- Source storage info
    storage_config_id UUID,
    storage_bucket  VARCHAR(255),
    storage_prefix  VARCHAR(500),     -- folder path the files came from

    -- Stats
    total_files     INTEGER DEFAULT 0,
    processed_files INTEGER DEFAULT 0,
    failed_files    INTEGER DEFAULT 0,

    -- Result export
    result_format   VARCHAR(20),       -- 'json', 'xml', 'csv'
    result_storage_key VARCHAR(500),   -- where the result file is stored
    exported_at     TIMESTAMPTZ,

    -- Handoff to annotation module
    passed_to_annotation BOOLEAN DEFAULT false,
    annotation_passed_at TIMESTAMPTZ,

    -- Timing
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_ocr_batch_platform ON ocr_batch(platform_id);
CREATE INDEX IF NOT EXISTS idx_ocr_batch_status ON ocr_batch(status);

-- ─── OCR Batch File — individual files within a batch ────────────────────────

CREATE TABLE IF NOT EXISTS ocr_batch_file (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id        UUID NOT NULL REFERENCES ocr_batch(id) ON DELETE CASCADE,
    storage_key     VARCHAR(500) NOT NULL,
    filename        VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT DEFAULT 0,

    -- Parsed info from filename
    drawing_number  VARCHAR(100),
    revision        VARCHAR(20),

    -- Linked P&ID (null if new file not yet in DB)
    pnid_id         UUID REFERENCES pnid(id) ON DELETE SET NULL,
    ocr_job_id      UUID,              -- links to ocr_job once processed

    -- Status
    status          VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
    error_message   TEXT,

    -- Stats from OCR
    tags_found      INTEGER DEFAULT 0,
    tags_matched    INTEGER DEFAULT 0,

    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_batch_file_batch ON ocr_batch_file(batch_id);
CREATE INDEX IF NOT EXISTS idx_ocr_batch_file_status ON ocr_batch_file(status);
CREATE INDEX IF NOT EXISTS idx_ocr_batch_file_pnid ON ocr_batch_file(pnid_id);

-- ─── Add batch_id to ocr_job (link jobs to batches) ─────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ocr_job' AND column_name = 'batch_id'
  ) THEN
    ALTER TABLE ocr_job ADD COLUMN batch_id UUID REFERENCES ocr_batch(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_ocr_job_batch ON ocr_job(batch_id);
  END IF;
END $$;

-- Done
SELECT 'OCR V2 migration completed' AS status;
