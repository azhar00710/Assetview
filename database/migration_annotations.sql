-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Extend annotation table for shape annotations & entity linking
-- ═══════════════════════════════════════════════════════════════════

-- Shape endpoint coordinates (for line annotations)
ALTER TABLE annotation ADD COLUMN IF NOT EXISTS x2_pct DECIMAL(5,2);
ALTER TABLE annotation ADD COLUMN IF NOT EXISTS y2_pct DECIMAL(5,2);

-- Shape type: 'line', 'rectangle', 'circle', 'diamond'
ALTER TABLE annotation ADD COLUMN IF NOT EXISTS shape VARCHAR(20);

-- Visual styling
ALTER TABLE annotation ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#4FE2B0';
ALTER TABLE annotation ADD COLUMN IF NOT EXISTS stroke_width INTEGER DEFAULT 2;

-- Entity linking: link annotation to equipment, instrument, or line
ALTER TABLE annotation ADD COLUMN IF NOT EXISTS linked_entity_type VARCHAR(20);
ALTER TABLE annotation ADD COLUMN IF NOT EXISTS linked_entity_id UUID;

CREATE INDEX IF NOT EXISTS idx_annotation_linked ON annotation(linked_entity_type, linked_entity_id)
  WHERE linked_entity_id IS NOT NULL;
