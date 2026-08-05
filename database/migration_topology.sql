-- ═══════════════════════════════════════════════════════════════════
-- GEOSOFT ASSETVIEW — TOPOLOGY MIGRATION
-- Adds topology graph tables for system P&ID visualization
-- Run after schema.sql and seed.sql
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- TABLE 1: topology_node
-- Unifies equipment, instruments, tees, boundaries as graph nodes
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS topology_node (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_type       VARCHAR(30) NOT NULL,       -- 'equipment' | 'instrument' | 'tee' | 'reducer' | 'boundary' | 'nozzle'
    reference_id    UUID,                        -- FK to equipment/instrument table (nullable for tees/boundaries)
    system_id       UUID REFERENCES system(id),
    tag             VARCHAR(100),                -- mirrors equipment.tag or auto-generated for tees
    label           VARCHAR(200),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- TABLE 2: topology_edge
-- Connections between nodes via pipe segments
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS topology_edge (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_id         UUID REFERENCES line(id),    -- which line this segment belongs to
    from_node_id    UUID REFERENCES topology_node(id),
    to_node_id      UUID REFERENCES topology_node(id),
    edge_type       VARCHAR(30) NOT NULL,        -- 'pipe' | 'signal' | 'utility' | 'boundary_crossing'
    segment_order   INT DEFAULT 0,
    flow_direction  VARCHAR(15),                 -- 'forward' | 'reverse' | 'bidirectional'
    metadata        JSONB DEFAULT '{}',          -- nominal_size, pipe_class, material from parent line
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- TABLE 3: system_boundary
-- Where systems interconnect
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS system_boundary (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_system_id  UUID REFERENCES system(id),
    to_system_id    UUID REFERENCES system(id),
    boundary_type   VARCHAR(50) NOT NULL,        -- 'tie-in' | 'battery_limit' | 'interface'
    from_node_id    UUID REFERENCES topology_node(id),
    to_node_id      UUID REFERENCES topology_node(id),
    from_line_id    UUID REFERENCES line(id),
    to_line_id      UUID REFERENCES line(id),
    description     TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- TABLE 4: system_layout
-- Store computed or manual layouts per system
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS system_layout (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_id       UUID REFERENCES system(id),
    layout_type     VARCHAR(30) NOT NULL,        -- 'auto_elk' | 'auto_dagre' | 'manual' | 'hybrid'
    node_positions  JSONB NOT NULL,              -- { nodeId: { x, y, width, height, collapsed } }
    edge_routes     JSONB,                       -- { edgeId: { points: [[x,y], ...] } }
    viewport        JSONB,                       -- { x, y, zoom } for saved view state
    is_default      BOOLEAN DEFAULT FALSE,
    created_by      UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one default layout per system
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_layout_default
    ON system_layout(system_id) WHERE is_default = TRUE;

-- ═══════════════════════════════════════════════════════════════════
-- INDEXES: Topology traversal performance
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_topo_node_system ON topology_node(system_id);
CREATE INDEX IF NOT EXISTS idx_topo_node_tag ON topology_node(tag);
CREATE INDEX IF NOT EXISTS idx_topo_node_type ON topology_node(node_type);
CREATE INDEX IF NOT EXISTS idx_topo_node_reference ON topology_node(reference_id) WHERE reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_topo_edge_from ON topology_edge(from_node_id);
CREATE INDEX IF NOT EXISTS idx_topo_edge_to ON topology_edge(to_node_id);
CREATE INDEX IF NOT EXISTS idx_topo_edge_line ON topology_edge(line_id);
CREATE INDEX IF NOT EXISTS idx_topo_edge_type ON topology_edge(edge_type);

CREATE INDEX IF NOT EXISTS idx_system_boundary_from ON system_boundary(from_system_id);
CREATE INDEX IF NOT EXISTS idx_system_boundary_to ON system_boundary(to_system_id);

CREATE INDEX IF NOT EXISTS idx_system_layout_system ON system_layout(system_id);

-- ═══════════════════════════════════════════════════════════════════
-- TRIGGER: Auto-update updated_at for system_layout
-- ═══════════════════════════════════════════════════════════════════

CREATE TRIGGER trg_system_layout_updated
    BEFORE UPDATE ON system_layout
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
