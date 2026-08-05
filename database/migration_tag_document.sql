-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Tag-to-Document Link (Digital Index)
-- Links equipment/instrument tags to P&ID sheet locations
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tag_document_link (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag             VARCHAR(100) NOT NULL,
    document_type   VARCHAR(30) NOT NULL,       -- 'pnid' | 'isometric' | 'datasheet' | 'manual'
    document_id     UUID,                       -- FK to pnid table (or other doc tables)
    document_ref    VARCHAR(200),               -- drawing number or file path
    page_number     INT,                        -- for multi-page PDFs
    region_x_pct    DECIMAL(5,2),               -- optional: region on page where tag appears
    region_y_pct    DECIMAL(5,2),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_doc_tag ON tag_document_link(tag);
CREATE INDEX IF NOT EXISTS idx_tag_doc_type ON tag_document_link(document_type);
CREATE INDEX IF NOT EXISTS idx_tag_doc_tag_trgm ON tag_document_link USING gin(tag gin_trgm_ops);
