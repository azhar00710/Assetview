-- Migration 012: AI Batch Detection + Knowledge Retention
-- Supports batch detection across multiple P&IDs and learning from feedback

-- Batch detection runs across multiple P&IDs
CREATE TABLE IF NOT EXISTS ai_detection_batch (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id     UUID NOT NULL,
  source_pnid_id  UUID NOT NULL,
  category        VARCHAR(30) NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending',
  total_drawings  INTEGER DEFAULT 0,
  processed       INTEGER DEFAULT 0,
  failed          INTEGER DEFAULT 0,
  example_data    JSONB NOT NULL,
  threshold       DECIMAL(4,3) DEFAULT 0.25,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

-- Per-drawing results within a batch
CREATE TABLE IF NOT EXISTS ai_detection_batch_result (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES ai_detection_batch(id),
  pnid_id         UUID NOT NULL,
  drawing_number  VARCHAR(100),
  status          VARCHAR(20) DEFAULT 'pending',
  detection_count INTEGER DEFAULT 0,
  detections      JSONB,
  error_message   TEXT,
  processing_ms   INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_batch_result_batch ON ai_detection_batch_result(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_result_pnid ON ai_detection_batch_result(pnid_id);

-- Detection feedback: every accept/reject decision
CREATE TABLE IF NOT EXISTS ai_detection_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id     UUID NOT NULL,
  batch_id        UUID,
  pnid_id         UUID NOT NULL,
  category        VARCHAR(30) NOT NULL,
  action          VARCHAR(20) NOT NULL,
  tag_text        VARCHAR(200),
  entity_type     VARCHAR(30),
  confidence      DECIMAL(4,3),
  bbox_x_pct      DECIMAL(7,3),
  bbox_y_pct      DECIMAL(7,3),
  bbox_w_pct      DECIMAL(7,3),
  bbox_h_pct      DECIMAL(7,3),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_platform ON ai_detection_feedback(platform_id);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON ai_detection_feedback(platform_id, category);

-- Detection profiles: named groups with cached embeddings
CREATE TABLE IF NOT EXISTS ai_detection_profile (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id     UUID NOT NULL,
  name            VARCHAR(100) NOT NULL,
  category        VARCHAR(30) NOT NULL,
  example_data    JSONB NOT NULL,
  embeddings      JSONB,
  total_accepted  INTEGER DEFAULT 0,
  total_rejected  INTEGER DEFAULT 0,
  auto_threshold  DECIMAL(4,3),
  exclusion_zones JSONB,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform_id, name)
);

CREATE INDEX IF NOT EXISTS idx_profile_platform ON ai_detection_profile(platform_id);
