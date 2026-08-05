-- ============================================================================
-- OCR Extraction Module — Tables for OCR pipeline
-- ============================================================================
-- Run after schema.sql + all previous migrations.
-- Usage: psql $DATABASE_URL -f database/migration_ocr.sql
-- ============================================================================

-- ─── OCR Job tracking ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ocr_job (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_id         UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
    pnid_version_id UUID,
    status          VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

    -- Stats
    total_words     INTEGER DEFAULT 0,
    tags_found      INTEGER DEFAULT 0,
    tags_matched    INTEGER DEFAULT 0,

    -- Timing
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_ocr_job_pnid ON ocr_job(pnid_id);
CREATE INDEX IF NOT EXISTS idx_ocr_job_status ON ocr_job(status);

-- ─── OCR Extraction staging table ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ocr_extraction (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_id          UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
    pnid_version_id  UUID,

    -- OCR result
    extracted_text   VARCHAR(200) NOT NULL,
    tag_type         VARCHAR(20) NOT NULL
                     CHECK (tag_type IN ('equipment', 'instrument', 'line', 'unknown')),
    confidence       DECIMAL(4,3) DEFAULT 0,

    -- Bounding box (percentage of image dimensions)
    bbox_x_pct       DECIMAL(5,2) NOT NULL DEFAULT 0,
    bbox_y_pct       DECIMAL(5,2) NOT NULL DEFAULT 0,
    bbox_w_pct       DECIMAL(5,2) NOT NULL DEFAULT 0,
    bbox_h_pct       DECIMAL(5,2) NOT NULL DEFAULT 0,

    -- Pixel coordinates (raw, for reference)
    bbox_x_px        INTEGER DEFAULT 0,
    bbox_y_px        INTEGER DEFAULT 0,
    bbox_w_px        INTEGER DEFAULT 0,
    bbox_h_px        INTEGER DEFAULT 0,

    -- Matching
    matched_entity_id UUID,
    match_confidence  DECIMAL(4,3) DEFAULT 0,
    match_method      VARCHAR(50),

    -- Approval
    status           VARCHAR(20) DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected', 'modified')),
    reviewed_by      VARCHAR(100),
    reviewed_at      TIMESTAMPTZ,

    -- Image dimensions used for normalization
    image_width_px   INTEGER DEFAULT 0,
    image_height_px  INTEGER DEFAULT 0,

    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_extraction_pnid ON ocr_extraction(pnid_id);
CREATE INDEX IF NOT EXISTS idx_ocr_extraction_status ON ocr_extraction(status);
CREATE INDEX IF NOT EXISTS idx_ocr_extraction_tag_type ON ocr_extraction(tag_type);
CREATE INDEX IF NOT EXISTS idx_ocr_extraction_matched ON ocr_extraction(matched_entity_id);

-- ─── Add annotation_x_pct / annotation_y_pct to pnid_line if missing ───────
-- (The OCR pipeline writes coordinates to pnid_line, but the original schema
--  may not have these columns)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pnid_line' AND column_name = 'annotation_x_pct'
  ) THEN
    ALTER TABLE pnid_line ADD COLUMN annotation_x_pct DECIMAL(5,2);
    ALTER TABLE pnid_line ADD COLUMN annotation_y_pct DECIMAL(5,2);
  END IF;
END $$;

-- Done
SELECT 'OCR migration completed' AS status;
