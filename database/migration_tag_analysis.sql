-- Migration: tag_analysis table
-- Persists AI tag pattern analysis results for future reference.

CREATE TABLE IF NOT EXISTS tag_analysis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id     UUID NOT NULL REFERENCES platform(id) ON DELETE CASCADE,

  -- What was analyzed
  source_type     TEXT NOT NULL DEFAULT 'mixed',  -- 'ocr_batch', 'data_files', 'mixed'
  ocr_batch_id    UUID REFERENCES ocr_batch(id) ON DELETE SET NULL,
  source_files    JSONB NOT NULL DEFAULT '[]',    -- [{fileName, sheetName, headers, rowCount}]
  column_mapping  JSONB DEFAULT '{}',             -- AI-identified column roles: {colName: role}

  -- Analysis results
  suggestions     JSONB NOT NULL DEFAULT '[]',    -- Full detected entries array
  tag_format      TEXT,                           -- Detected tag convention format string
  line_format     TEXT,                           -- Detected line number format
  fluid_codes     JSONB DEFAULT '{}',             -- {code: description}
  has_location_code BOOLEAN DEFAULT FALSE,
  location_code_length INTEGER,

  -- Stats
  total_entries   INTEGER NOT NULL DEFAULT 0,
  applied_count   INTEGER NOT NULL DEFAULT 0,
  total_rows_analyzed INTEGER NOT NULL DEFAULT 0,
  total_sheets_analyzed INTEGER NOT NULL DEFAULT 0,

  -- AI metadata
  ai_model        TEXT,
  ai_source       TEXT,                           -- 'ai', 'programmatic', 'ai+programmatic'
  tokens_input    INTEGER DEFAULT 0,
  tokens_output   INTEGER DEFAULT 0,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT DEFAULT 'system',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_analysis_platform ON tag_analysis(platform_id);
CREATE INDEX IF NOT EXISTS idx_tag_analysis_created ON tag_analysis(created_at DESC);
