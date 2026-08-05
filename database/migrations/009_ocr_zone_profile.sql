-- OCR Zone Profiles
-- Stores platform-level drawing regions used for deterministic pre-noise filtering.

CREATE TABLE IF NOT EXISTS ocr_zone_profile (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id UUID NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
  zone_name   VARCHAR(100) NOT NULL,
  x_pct       DECIMAL(5,2) NOT NULL,
  y_pct       DECIMAL(5,2) NOT NULL,
  w_pct       DECIMAL(5,2) NOT NULL,
  h_pct       DECIMAL(5,2) NOT NULL,
  noise_mode  VARCHAR(20) DEFAULT 'exclude',
  is_active   BOOLEAN DEFAULT true,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform_id, zone_name)
);

CREATE INDEX IF NOT EXISTS idx_ocr_zone_profile_platform ON ocr_zone_profile(platform_id);
CREATE INDEX IF NOT EXISTS idx_ocr_zone_profile_active ON ocr_zone_profile(is_active);
