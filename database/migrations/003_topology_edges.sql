-- ═══════════════════════════════════════════════════════════════════
-- GEOSOFT ASSETVIEW — MIGRATION 003: topology_edges + canvas_layout
-- Direct entity-to-entity edge table for recursive CTE traversal
-- Run after migration_topology.sql
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- TABLE 1: topology_edges
-- Simplified entity-based edges for graph traversal via recursive CTEs.
-- Unlike topology_edge (node-reference based), this table maps directly
-- between equipment/instrument/tee entity IDs without an intermediate
-- topology_node lookup.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS topology_edges (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_entity_id   UUID NOT NULL,
    from_entity_type VARCHAR(20) NOT NULL,   -- 'equipment' | 'instrument' | 'tee'
    to_entity_id     UUID NOT NULL,
    to_entity_type   VARCHAR(20) NOT NULL,   -- 'equipment' | 'instrument' | 'tee'
    edge_type        VARCHAR(20) NOT NULL,   -- 'process' | 'signal' | 'utility' | 'boundary'
    system_id        UUID NOT NULL REFERENCES system(id),
    line_id          UUID REFERENCES line(id),
    metadata         JSONB DEFAULT '{}',     -- nominal_size, pipe_class, service, etc.
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast graph traversal
CREATE INDEX IF NOT EXISTS idx_topology_edges_from ON topology_edges(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_topology_edges_to ON topology_edges(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_topology_edges_system ON topology_edges(system_id);
CREATE INDEX IF NOT EXISTS idx_topology_edges_line ON topology_edges(line_id) WHERE line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_topology_edges_type ON topology_edges(edge_type);

-- Composite index for system-scoped traversal (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_topology_edges_system_from ON topology_edges(system_id, from_entity_id);

-- ═══════════════════════════════════════════════════════════════════
-- TABLE 2: canvas_layout
-- Per-entity position persistence for the canvas module.
-- Stores individual node positions (x, y) with pinned status.
-- Unlike system_layout (which stores bulk JSONB), this allows
-- per-entity upserts and efficient queries.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS canvas_layout (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_id   UUID NOT NULL REFERENCES system(id),
    entity_id   UUID NOT NULL,
    entity_type VARCHAR(20) NOT NULL,   -- 'equipment' | 'instrument' | 'tee' | 'boundary'
    x           NUMERIC NOT NULL,
    y           NUMERIC NOT NULL,
    pinned      BOOLEAN DEFAULT false,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(system_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_canvas_layout_system ON canvas_layout(system_id);

-- Trigger for auto-updating updated_at
CREATE TRIGGER trg_canvas_layout_updated
    BEFORE UPDATE ON canvas_layout
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (uncomment to run)
-- ═══════════════════════════════════════════════════════════════════
-- SELECT count(*) FROM topology_edges;
-- SELECT count(*) FROM canvas_layout;
-- \d topology_edges
-- \d canvas_layout
