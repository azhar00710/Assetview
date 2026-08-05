-- Migration: Add approval_status workflow to annotations
-- Draft annotations can be moved, delinked, adjusted
-- Approved annotations are locked (no modifications allowed)

ALTER TABLE annotation
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Set existing annotations to 'draft' if null
UPDATE annotation SET approval_status = 'draft' WHERE approval_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_annotation_approval_status ON annotation(approval_status);
