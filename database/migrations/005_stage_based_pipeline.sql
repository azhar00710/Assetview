-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 005: Stage-based OCR Pipeline
-- Adds stage tracking to ocr_batch and per-file output paths
-- Stages: extraction → grouping → cleanup → import
-- ═══════════════════════════════════════════════════════════════════

-- Stage tracking on batch level
ALTER TABLE ocr_batch
  ADD COLUMN IF NOT EXISTS current_stage VARCHAR(20) DEFAULT 'extraction',
  ADD COLUMN IF NOT EXISTS stage1_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stage2_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stage3_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stage4_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ocr_provider_used VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ai_model_used VARCHAR(100);

-- Per-file output paths for each stage
ALTER TABLE ocr_batch_file
  ADD COLUMN IF NOT EXISTS raw_output_key VARCHAR(500),
  ADD COLUMN IF NOT EXISTS grouped_output_key VARCHAR(500),
  ADD COLUMN IF NOT EXISTS cleaned_output_key VARCHAR(500);

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'ocr_batch'
-- ORDER BY ordinal_position;
