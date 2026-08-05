-- Link OCR extractions to Konva annotations (WP-E traceability)
-- Idempotent for migrationRunner

ALTER TABLE ocr_extraction
  ADD COLUMN IF NOT EXISTS linked_annotation_id UUID REFERENCES annotation(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ocr_extraction_linked_annotation
  ON ocr_extraction(linked_annotation_id)
  WHERE linked_annotation_id IS NOT NULL;
