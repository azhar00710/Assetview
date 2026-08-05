-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 006: Stage 3 Human Review
-- Adds review output storage and per-file review tracking
-- ═══════════════════════════════════════════════════════════════════

-- Per-file review output path and status
ALTER TABLE ocr_batch_file
  ADD COLUMN IF NOT EXISTS review_output_key VARCHAR(500),
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_stats JSONB;

-- Index for querying review status
CREATE INDEX IF NOT EXISTS idx_ocr_batch_file_review_status ON ocr_batch_file(review_status);
