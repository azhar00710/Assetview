-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION 004: Allow multiple storage configs per platform
-- Removes UNIQUE constraint to support per-batch storage selection
-- Adds ocr_provider_preference column for OCR provider configuration
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Drop UNIQUE constraint on storage_config(scope_type, scope_id)
-- This allows a platform to have multiple storage configurations
ALTER TABLE storage_config DROP CONSTRAINT IF EXISTS storage_config_scope_type_scope_id_key;

-- Step 2: Add INDEX on storage_config(scope_type, scope_id) if it doesn't exist
-- This maintains query performance for config lookups
CREATE INDEX IF NOT EXISTS idx_storage_config_scope ON storage_config(scope_type, scope_id);

-- Step 3: Add ocr_provider_preference column if it doesn't exist
-- Values: 'google' (default), 'claude', 'both'
-- Stores per-platform OCR provider preference
ALTER TABLE storage_config
  ADD COLUMN IF NOT EXISTS ocr_provider_preference VARCHAR(20) DEFAULT 'google';

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (uncomment to run)
-- ═══════════════════════════════════════════════════════════════════
-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_name='storage_config' AND constraint_type='UNIQUE';
--
-- SELECT indexname FROM pg_indexes WHERE tablename='storage_config';
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns WHERE table_name='storage_config'
-- ORDER BY ordinal_position;
--
