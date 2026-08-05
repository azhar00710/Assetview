-- Record why a reviewer (or the auto-reject tier) discarded an OCR tag.
-- Lets rejected extractions stay in the table with status='rejected' for
-- audit/diagnostics instead of disappearing silently, and makes it easy
-- to distinguish reviewer rejections from auto-rejected low-confidence
-- candidates and noise filtered by the pipeline.
-- Idempotent for migrationRunner.

ALTER TABLE ocr_extraction
  ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_ocr_extraction_status_pnid
  ON ocr_extraction(pnid_id, status);
