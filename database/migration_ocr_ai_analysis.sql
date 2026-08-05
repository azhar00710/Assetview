-- OCR AI Analysis tables
-- Auto-run by migrationRunner.js (idempotent)

-- AI Analysis Job tracking
CREATE TABLE IF NOT EXISTS ai_analysis_job (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id          UUID NOT NULL REFERENCES ocr_batch(id) ON DELETE CASCADE,
  platform_id       UUID NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
  status            VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed')),
  analysis_type     VARCHAR(50) DEFAULT 'full',
  prompt_template   TEXT,
  input_token_count INTEGER DEFAULT 0,
  output_token_count INTEGER DEFAULT 0,
  ai_model          VARCHAR(100),
  raw_response      JSONB,
  summary_text      TEXT,
  relationships     JSONB,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  created_by        VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_job_batch ON ai_analysis_job(batch_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_job_platform ON ai_analysis_job(platform_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_job_status ON ai_analysis_job(status);

-- AI Generated Entity staging table
CREATE TABLE IF NOT EXISTS ai_generated_entity (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_job_id   UUID NOT NULL REFERENCES ai_analysis_job(id) ON DELETE CASCADE,
  batch_id          UUID NOT NULL,
  platform_id       UUID NOT NULL REFERENCES platform(id),
  entity_type       VARCHAR(20) NOT NULL
                    CHECK (entity_type IN ('system','line','equipment','instrument')),
  suggested_tag     VARCHAR(200) NOT NULL,
  suggested_data    JSONB DEFAULT '{}',
  source_pnid_ids   UUID[],
  source_extractions UUID[],
  confidence        DECIMAL(4,3) DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'draft'
                    CHECK (status IN ('draft','approved','rejected','merged')),
  merged_entity_id  UUID,
  reviewed_by       VARCHAR(100),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_generated_entity_job ON ai_generated_entity(analysis_job_id);
CREATE INDEX IF NOT EXISTS idx_ai_generated_entity_platform ON ai_generated_entity(platform_id);
CREATE INDEX IF NOT EXISTS idx_ai_generated_entity_status ON ai_generated_entity(status);
CREATE INDEX IF NOT EXISTS idx_ai_generated_entity_type ON ai_generated_entity(entity_type);

-- AI Relationship table
CREATE TABLE IF NOT EXISTS ai_relationship (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_job_id   UUID NOT NULL REFERENCES ai_analysis_job(id) ON DELETE CASCADE,
  from_entity_type  VARCHAR(20),
  from_entity_tag   VARCHAR(200),
  from_entity_id    UUID,
  to_entity_type    VARCHAR(20),
  to_entity_tag     VARCHAR(200),
  to_entity_id      UUID,
  relationship_type VARCHAR(50),
  pnid_id           UUID,
  confidence        DECIMAL(4,3) DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'draft',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_relationship_job ON ai_relationship(analysis_job_id);

-- Add AI analysis columns to ocr_batch
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ocr_batch' AND column_name = 'ai_analysis_status'
  ) THEN
    ALTER TABLE ocr_batch ADD COLUMN ai_analysis_status VARCHAR(20);
    ALTER TABLE ocr_batch ADD COLUMN ai_analysis_job_id UUID;
  END IF;
END $$;

-- ═══ AI Cleanup Pipeline columns ═══════════════════════════════════════════

-- AI credentials storage (like vision_credentials_ref)
ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS ai_credentials_ref TEXT;
ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS ai_model_preference VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514';

-- AI cleanup classification on ocr_extraction
ALTER TABLE ocr_extraction ADD COLUMN IF NOT EXISTS ai_classification VARCHAR(20);
  -- real_tag | noise | uncertain
ALTER TABLE ocr_extraction ADD COLUMN IF NOT EXISTS ai_reason TEXT;
ALTER TABLE ocr_extraction ADD COLUMN IF NOT EXISTS revision_status VARCHAR(20);
  -- added | removed | unchanged | moved
ALTER TABLE ocr_extraction ADD COLUMN IF NOT EXISTS previous_extraction_id UUID;

-- AI cleanup tracking on ocr_batch
ALTER TABLE ocr_batch ADD COLUMN IF NOT EXISTS ai_cleanup_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE ocr_batch ADD COLUMN IF NOT EXISTS ai_cleanup_job_id UUID;
ALTER TABLE ocr_batch ADD COLUMN IF NOT EXISTS reconciliation_summary JSONB;

CREATE INDEX IF NOT EXISTS idx_ocr_extraction_ai_class ON ocr_extraction(ai_classification);
CREATE INDEX IF NOT EXISTS idx_ocr_extraction_revision ON ocr_extraction(revision_status)
