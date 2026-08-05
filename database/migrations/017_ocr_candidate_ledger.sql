-- Candidate ledger for OCR Stage 2 coverage accounting.
-- Guarantees each structured candidate has one terminal outcome + reason code.

CREATE TABLE IF NOT EXISTS ocr_candidate_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ocr_job_id UUID NOT NULL REFERENCES ocr_job(id) ON DELETE CASCADE,
  pnid_id UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
  extraction_stage VARCHAR(16) NOT NULL DEFAULT 'stage2',
  candidate_text_raw TEXT NOT NULL,
  candidate_text_norm TEXT NOT NULL,
  candidate_type VARCHAR(32) NOT NULL,
  source VARCHAR(64) NOT NULL,
  source_stage VARCHAR(16) NOT NULL,
  assembly_rule VARCHAR(64),
  assembly_score NUMERIC(6,4),
  word_indices JSONB NOT NULL DEFAULT '[]'::jsonb,
  bbox JSONB,
  confidence_det NUMERIC(6,4),
  confidence_ai NUMERIC(6,4),
  confidence_final NUMERIC(6,4) NOT NULL,
  terminal_outcome VARCHAR(16) NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  reason_detail TEXT,
  superseded_by_candidate_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_job
  ON ocr_candidate_ledger(ocr_job_id);

CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_pnid
  ON ocr_candidate_ledger(pnid_id);

CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_outcome
  ON ocr_candidate_ledger(terminal_outcome, reason_code);

CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_text
  ON ocr_candidate_ledger(candidate_text_norm);

CREATE TABLE IF NOT EXISTS ocr_reason_code (
  code VARCHAR(64) PRIMARY KEY,
  terminal_outcome VARCHAR(16) NOT NULL,
  description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO ocr_reason_code (code, terminal_outcome, description)
VALUES
  ('KEPT_DETERMINISTIC_STRONG', 'kept', 'Candidate kept by deterministic structured validation'),
  ('KEPT_AI_CONFIRMED', 'kept', 'Candidate kept after AI disambiguation'),
  ('UNCERTAIN_LOW_CONFIDENCE', 'uncertain', 'Candidate retained for review due to low confidence'),
  ('UNCERTAIN_COMPETING_HYPOTHESES', 'uncertain', 'Candidate retained due to competing assemblies'),
  ('REJECT_PATTERN_INVALID', 'rejected', 'Candidate rejected due to invalid structured pattern'),
  ('REJECT_PARTIAL_FRAGMENT', 'rejected', 'Candidate rejected as partial tag fragment'),
  ('REJECT_ZONE_SUPPRESSED', 'rejected', 'Candidate rejected due to zone/noise suppression'),
  ('REJECT_AI_REJECTED', 'rejected', 'Candidate rejected by AI decision'),
  ('REJECT_DEDUP_SUPERSEDED', 'rejected', 'Candidate rejected because stronger candidate superseded it'),
  ('REJECT_ASSEMBLY_CONFLICT', 'rejected', 'Candidate rejected due to grouping or assembly conflict'),
  ('REJECT_NO_GEOMETRY', 'rejected', 'Candidate rejected because no valid geometry was available')
ON CONFLICT (code) DO UPDATE
SET
  terminal_outcome = EXCLUDED.terminal_outcome,
  description = EXCLUDED.description,
  active = TRUE;
