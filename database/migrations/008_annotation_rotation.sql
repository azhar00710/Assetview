-- Migration 008: Add rotation support for annotations and entity positions
-- Allows inclined/angled tag annotations on P&ID drawings

ALTER TABLE annotation ADD COLUMN IF NOT EXISTS rotation DECIMAL(5,2) DEFAULT 0;
ALTER TABLE pnid_equipment ADD COLUMN IF NOT EXISTS annotation_rotation DECIMAL(5,2) DEFAULT 0;
ALTER TABLE pnid_instrument ADD COLUMN IF NOT EXISTS annotation_rotation DECIMAL(5,2) DEFAULT 0;
