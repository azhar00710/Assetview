-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: P&ID Annotation Module — OCR Pipeline Columns
-- Adds annotation status tracking and OCR file references to pnid table
-- ═══════════════════════════════════════════════════════════════════

-- Annotation status: whether the P&ID has been annotated
CREATE TYPE annotation_status AS ENUM ('not_annotated', 'in_progress', 'annotated', 'verified');

ALTER TABLE pnid ADD COLUMN IF NOT EXISTS annotation_status annotation_status DEFAULT 'not_annotated';

-- OCR pipeline output files
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS ocr_raw_storage_key VARCHAR(500);       -- Storage key for raw OCR output
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS ocr_cleaned_storage_key VARCHAR(500);   -- Storage key for cleaned/processed OCR output
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS ocr_raw_data JSONB;                     -- Raw OCR extracted data (JSON)
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS ocr_cleaned_data JSONB;                 -- Cleaned/structured OCR data (JSON)
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS ocr_processed_at TIMESTAMPTZ;           -- When OCR pipeline last ran
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS ocr_status VARCHAR(50) DEFAULT 'pending'; -- 'pending', 'processing', 'completed', 'failed'
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS ocr_error TEXT;                          -- Error message if OCR failed

-- Index for filtering by annotation status
CREATE INDEX IF NOT EXISTS idx_pnid_annotation_status ON pnid(annotation_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pnid_ocr_status ON pnid(ocr_status) WHERE deleted_at IS NULL;
