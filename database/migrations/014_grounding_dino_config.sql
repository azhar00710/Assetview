-- Migration: Add GroundingDINO config columns to storage_config
-- Allows independent configuration of T-Rex2 and GroundingDINO visual detectors

ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS grounding_api_url TEXT;
ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS grounding_api_token TEXT;
ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS grounding_model_preference VARCHAR(80);

-- Also ensure visual detector columns exist (added at runtime but should be in migration)
ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS visual_provider_preference VARCHAR(30) DEFAULT 'trex2';
ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS visual_api_url TEXT;
ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS visual_api_token TEXT;
ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS visual_model_preference VARCHAR(80);
