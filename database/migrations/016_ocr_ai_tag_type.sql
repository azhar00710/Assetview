-- Preserve the original AI-assigned tag type on ocr_extraction.
--
-- The tag_type column is constrained to (equipment|instrument|line|unknown),
-- so classes like "drain_header", "drawing_ref", "cross_reference",
-- "line_header" etc. from Stage-2 classification are squashed to 'unknown'
-- during sync. That erases useful context — the reviewer sees "unknown" with
-- no idea what the AI actually thought the tag was.
--
-- ai_tag_type stores the pre-normalization label so the review UI / audit
-- tooling can surface it without re-reading the cleaned JSON.
--
-- Note: the existing ai_classification column is separate and holds the
-- noise/real_tag/uncertain verdict from the AI cleanup service — not the
-- type class.
--
-- Idempotent for migrationRunner.

ALTER TABLE ocr_extraction
  ADD COLUMN IF NOT EXISTS ai_tag_type VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_ocr_extraction_ai_tag_type
  ON ocr_extraction(ai_tag_type)
  WHERE ai_tag_type IS NOT NULL;
