-- Smart Identification: boundary-based P&ID segment digitization
-- Supports parent-child relationships between detected segments

CREATE TABLE IF NOT EXISTS smart_ident_session (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pnid_id         UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
    boundary_x_pct  DECIMAL(6,3) NOT NULL,
    boundary_y_pct  DECIMAL(6,3) NOT NULL,
    boundary_w_pct  DECIMAL(6,3) NOT NULL,
    boundary_h_pct  DECIMAL(6,3) NOT NULL,
    page_number     INT NOT NULL DEFAULT 1,
    status          VARCHAR(20) NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing', 'ready', 'committed', 'failed')),
    segment_count   INT NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smart_ident_session_pnid
    ON smart_ident_session(pnid_id);

CREATE TABLE IF NOT EXISTS smart_ident_segment (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id            UUID NOT NULL REFERENCES smart_ident_session(id) ON DELETE CASCADE,
    pnid_id               UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
    segment_type          VARCHAR(20) NOT NULL
                          CHECK (segment_type IN ('line', 'circle', 'arc', 'rect', 'polyline', 'symbol', 'unknown')),
    geometry              JSONB NOT NULL DEFAULT '{}',
    detection_confidence  DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    linked_entity_type    VARCHAR(20),
    linked_entity_id      UUID,
    parent_segment_id     UUID REFERENCES smart_ident_segment(id) ON DELETE SET NULL,
    display_color         VARCHAR(7),
    assigned_at           TIMESTAMPTZ,
    metadata              JSONB NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smart_ident_segment_session
    ON smart_ident_segment(session_id);

CREATE INDEX IF NOT EXISTS idx_smart_ident_segment_pnid
    ON smart_ident_segment(pnid_id);

CREATE INDEX IF NOT EXISTS idx_smart_ident_segment_parent
    ON smart_ident_segment(parent_segment_id)
    WHERE parent_segment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smart_ident_segment_linked
    ON smart_ident_segment(linked_entity_id)
    WHERE linked_entity_id IS NOT NULL;

CREATE TRIGGER trg_smart_ident_session_updated
    BEFORE UPDATE ON smart_ident_session
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_smart_ident_segment_updated
    BEFORE UPDATE ON smart_ident_segment
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
