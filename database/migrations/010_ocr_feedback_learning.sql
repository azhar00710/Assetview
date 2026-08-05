-- OCR Feedback + Learned Pattern loop

CREATE TABLE IF NOT EXISTS ocr_feedback_event (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id    UUID NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
  batch_id       UUID REFERENCES ocr_batch(id) ON DELETE SET NULL,
  batch_file_id  UUID REFERENCES ocr_batch_file(id) ON DELETE SET NULL,
  action         VARCHAR(20) NOT NULL,
  original_text  VARCHAR(200),
  corrected_text VARCHAR(200),
  original_type  VARCHAR(30),
  corrected_type VARCHAR(30),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_feedback_platform ON ocr_feedback_event(platform_id);
CREATE INDEX IF NOT EXISTS idx_ocr_feedback_action ON ocr_feedback_event(action);
CREATE INDEX IF NOT EXISTS idx_ocr_feedback_created ON ocr_feedback_event(created_at DESC);

CREATE TABLE IF NOT EXISTS ocr_learned_pattern (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id   UUID NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
  pattern_key   VARCHAR(50) NOT NULL,
  regex_pattern VARCHAR(300) NOT NULL,
  target_type   VARCHAR(30) NOT NULL,
  support_count INTEGER DEFAULT 0,
  confidence    DECIMAL(4,3) DEFAULT 0,
  source        VARCHAR(40) DEFAULT 'review_feedback',
  is_active     BOOLEAN DEFAULT true,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform_id, pattern_key, target_type)
);

CREATE INDEX IF NOT EXISTS idx_ocr_learned_pattern_platform ON ocr_learned_pattern(platform_id);
CREATE INDEX IF NOT EXISTS idx_ocr_learned_pattern_active ON ocr_learned_pattern(is_active);
