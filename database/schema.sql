-- ═══════════════════════════════════════════════════════════════════
-- GEOSOFT ASSETVIEW — PHASE 2 DATABASE SCHEMA
-- PostgreSQL 15+ | Corrected Data Model (Post-Audit)
-- ═══════════════════════════════════════════════════════════════════
-- 
-- KEY DESIGN DECISIONS:
-- 1. UUIDs for all primary keys (distributed-ready)
-- 2. Junction tables for M:N: pnid_system, pnid_line
-- 3. Lines BELONG to systems (ownership) and APPEAR on P&IDs (display)
-- 4. Equipment has nullable line_id (null = standalone)
-- 5. Soft deletes via deleted_at timestamps
-- 6. Full audit trail via created_at, updated_at, created_by, updated_by
-- 7. JSONB metadata columns for extensibility
-- ═══════════════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search

-- ═══ ENUMS ═══
CREATE TYPE system_type AS ENUM ('process', 'utility', 'safety', 'instrument');
CREATE TYPE criticality_level AS ENUM ('high', 'medium', 'low');
CREATE TYPE document_status AS ENUM ('as_built', 'approved', 'issued_for_construction', 'issued_for_review', 'draft', 'superseded');
CREATE TYPE platform_status AS ENUM ('operating', 'under_construction', 'decommissioned', 'planned');
CREATE TYPE instrument_type AS ENUM ('pressure', 'temperature', 'flow', 'level', 'safety_valve', 'control_valve', 'analyzer', 'other');

-- ═══════════════════════════════════════════════════════════════════
-- TIER 1: ORGANIZATIONAL HIERARCHY (strict 1:N)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE concession (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(200) NOT NULL,
    code            VARCHAR(50) NOT NULL,
    operator        VARCHAR(200),
    region          VARCHAR(100),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      VARCHAR(100),
    updated_by      VARCHAR(100),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE field (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concession_id   UUID NOT NULL REFERENCES concession(id),
    name            VARCHAR(200) NOT NULL,
    code            VARCHAR(50) NOT NULL,
    field_type      VARCHAR(100),  -- 'offshore', 'onshore', 'subsea'
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      VARCHAR(100),
    updated_by      VARCHAR(100),
    deleted_at      TIMESTAMPTZ,
    UNIQUE(concession_id, code)
);

CREATE TABLE location (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    concession_id   UUID NOT NULL REFERENCES concession(id),
    name            VARCHAR(200) NOT NULL,
    code            VARCHAR(50) NOT NULL,
    location_type   VARCHAR(100),  -- 'offshore', 'onshore', 'subsea'
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      VARCHAR(100),
    updated_by      VARCHAR(100),
    deleted_at      TIMESTAMPTZ,
    UNIQUE(concession_id, code)
);

CREATE TABLE complex (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    field_id        UUID REFERENCES field(id),
    location_id     UUID REFERENCES location(id),
    name            VARCHAR(200) NOT NULL,
    code            VARCHAR(50) NOT NULL,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE(location_id, code)
);

CREATE TABLE platform (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    complex_id      UUID NOT NULL REFERENCES complex(id),
    name            VARCHAR(200) NOT NULL,
    code            VARCHAR(50) NOT NULL,
    platform_type   VARCHAR(100),  -- 'Fixed Jacket', 'Jack-Up', 'FPSO', 'Subsea'
    status          platform_status DEFAULT 'operating',
    latitude        DECIMAL(10, 7),
    longitude       DECIMAL(10, 7),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE(complex_id, code)
);

-- ═══════════════════════════════════════════════════════════════════
-- TIER 2: SYSTEM (belongs to Platform, 1:N)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE system (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_id     UUID NOT NULL REFERENCES platform(id),
    name            VARCHAR(200) NOT NULL,
    code            VARCHAR(50) NOT NULL,
    sys_type        system_type NOT NULL,
    description     TEXT,
    system_number   VARCHAR(20),  -- Engineering system number (e.g., '20', '52')
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE(platform_id, code)
);

CREATE INDEX idx_system_platform ON system(platform_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_system_type ON system(sys_type);

-- ═══════════════════════════════════════════════════════════════════
-- TIER 3: P&ID DOCUMENT (M:N with System via junction)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE pnid (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drawing_number  VARCHAR(100) NOT NULL UNIQUE,  -- e.g., 'AD219-490-D-15101'
    title           VARCHAR(500),
    revision        VARCHAR(20),
    status          document_status DEFAULT 'draft',
    document_type   VARCHAR(50) DEFAULT 'P&ID',  -- Future: 'PFD', 'SLD', 'HVAC', 'F&G'
    sheet_number    INTEGER DEFAULT 1,
    total_sheets    INTEGER DEFAULT 1,
    contractor      VARCHAR(200),
    has_image       BOOLEAN DEFAULT FALSE,
    image_path      VARCHAR(500),  -- Path to rendered image or tile directory
    pdf_path        VARCHAR(500),  -- Original PDF path
    metadata        JSONB DEFAULT '{}',  -- Can store notes, revision history, etc.
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_pnid_drawing ON pnid(drawing_number);
CREATE INDEX idx_pnid_status ON pnid(status);

-- ═══ JUNCTION: P&ID ↔ System (M:N with primary flag) ═══
-- A P&ID has ONE primary system and zero or more secondary systems.
-- This represents the engineering reality that P&IDs cross system boundaries.
CREATE TABLE pnid_system (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_id         UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
    system_id       UUID NOT NULL REFERENCES system(id) ON DELETE CASCADE,
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    notes           TEXT,  -- e.g., 'Relief line to flare shown for context'
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pnid_id, system_id),
    -- Ensure exactly one primary system per P&ID
    EXCLUDE USING btree (pnid_id WITH =) WHERE (is_primary = TRUE)
);

CREATE INDEX idx_pnid_system_pnid ON pnid_system(pnid_id);
CREATE INDEX idx_pnid_system_system ON pnid_system(system_id);
CREATE INDEX idx_pnid_system_primary ON pnid_system(pnid_id) WHERE is_primary = TRUE;

-- ═══════════════════════════════════════════════════════════════════
-- TIER 4: LINE (belongs to System for OWNERSHIP, M:N with P&ID for DISPLAY)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE line (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- OWNERSHIP: which system this line belongs to
    system_id           UUID NOT NULL REFERENCES system(id),
    -- Identity
    line_number         VARCHAR(100) NOT NULL,  -- Full line number, e.g., 'CO-6"-EC12NLD-1195AD'
    -- Engineering attributes (Line List fields)
    service             VARCHAR(200),           -- e.g., 'Production - Short String'
    fluid_code          VARCHAR(50),            -- e.g., 'CO', 'FG', 'VH', 'PI'
    nominal_size        VARCHAR(20),            -- e.g., '6"'
    pipe_class          VARCHAR(50),            -- e.g., 'EC12NLD'
    material            VARCHAR(100),           -- e.g., 'CS', 'SS316', 'L80'
    insulation_code     VARCHAR(50),            -- e.g., 'H1' (hot), 'C1' (cold), 'NONE'
    -- Pressure/Temperature
    design_pressure     DECIMAL(10,2),          -- barg
    design_temperature  DECIMAL(10,2),          -- °C
    operating_pressure  DECIMAL(10,2),          -- barg
    operating_temperature DECIMAL(10,2),        -- °C
    test_pressure       DECIMAL(10,2),          -- barg (hydrotest)
    -- Connections
    from_equipment_tag  VARCHAR(100),           -- Origin equipment tag
    to_equipment_tag    VARCHAR(100),           -- Destination equipment tag
    -- References
    line_class_spec     VARCHAR(100),           -- Full piping spec reference
    isometric_ref       VARCHAR(200),           -- Isometric drawing number(s)
    stress_analysis_ref VARCHAR(200),           -- Stress calculation reference
    -- Metadata
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    UNIQUE(system_id, line_number)
);

CREATE INDEX idx_line_system ON line(system_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_line_number ON line(line_number);
CREATE INDEX idx_line_number_trgm ON line USING gin(line_number gin_trgm_ops);  -- Fuzzy search

-- ═══ JUNCTION: P&ID ↔ Line (M:N — which lines appear on which P&IDs) ═══
-- A line can appear on multiple P&IDs (e.g., starts on one sheet, continues on another).
CREATE TABLE pnid_line (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_id                 UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
    line_id                 UUID NOT NULL REFERENCES line(id) ON DELETE CASCADE,
    is_continuation         BOOLEAN DEFAULT FALSE,  -- TRUE if line continues from another sheet
    continuation_from_pnid_id UUID REFERENCES pnid(id),  -- Which sheet it continues from
    sheet_entry_point       VARCHAR(100),  -- e.g., 'from left, row D'
    sheet_exit_point        VARCHAR(100),  -- e.g., 'to right, row D'
    annotation_x_pct        DECIMAL(5,2),  -- X position on drawing (percentage)
    annotation_y_pct        DECIMAL(5,2),  -- Y position on drawing (percentage)
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pnid_id, line_id)
);

CREATE INDEX idx_pnid_line_pnid ON pnid_line(pnid_id);
CREATE INDEX idx_pnid_line_line ON pnid_line(line_id);

-- ═══════════════════════════════════════════════════════════════════
-- TIER 5: EQUIPMENT (belongs to System, optionally on a Line)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE equipment (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    system_id           UUID NOT NULL REFERENCES system(id),
    line_id             UUID REFERENCES line(id),  -- NULL = standalone equipment
    -- Identity
    tag                 VARCHAR(100) NOT NULL,
    equipment_type      VARCHAR(100) NOT NULL,  -- 'Christmas Tree', 'Choke Valve', 'Vessel', etc.
    description         TEXT,
    -- Classifications
    criticality         criticality_level,
    sil_level           VARCHAR(20),            -- 'SIL 1', 'SIL 2', 'SIL 3', 'SIL 4'
    inspection_group    VARCHAR(50),            -- e.g., 'IG-XT-01'
    corrosion_loop      VARCHAR(50),            -- e.g., 'CL-019-A'
    -- Engineering data
    manufacturer        VARCHAR(200),
    model_number        VARCHAR(100),
    serial_number       VARCHAR(100),
    weight_kg           DECIMAL(10,2),
    -- Operational data
    commissioning_date  DATE,
    last_inspection     DATE,
    next_inspection     DATE,
    -- Virtual Tool integration
    vt_scene_id         VARCHAR(100),           -- Pano2VR scene ID
    vt_hotspot_id       VARCHAR(100),           -- Pano2VR hotspot ID
    -- 3D Model integration (future)
    model_3d_object_id  VARCHAR(200),           -- 3D model object identifier
    -- CMMS/ERP integration (future)
    cmms_asset_id       VARCHAR(100),           -- SAP/Maximo asset ID
    -- Metadata
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_equipment_system ON equipment(system_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_equipment_line ON equipment(line_id) WHERE line_id IS NOT NULL;
CREATE INDEX idx_equipment_tag ON equipment(tag);
CREATE INDEX idx_equipment_tag_trgm ON equipment USING gin(tag gin_trgm_ops);
CREATE INDEX idx_equipment_type ON equipment(equipment_type);
CREATE INDEX idx_equipment_criticality ON equipment(criticality);

-- ═══ JUNCTION: Equipment ↔ P&ID (which P&IDs show this equipment) ═══
CREATE TABLE pnid_equipment (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_id         UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
    equipment_id    UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    annotation_x_pct DECIMAL(5,2),  -- Position on drawing
    annotation_y_pct DECIMAL(5,2),
    annotation_w_pct DECIMAL(5,2),  -- Hotspot width
    annotation_h_pct DECIMAL(5,2),  -- Hotspot height
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pnid_id, equipment_id)
);

CREATE INDEX idx_pnid_equipment_pnid ON pnid_equipment(pnid_id);
CREATE INDEX idx_pnid_equipment_equip ON pnid_equipment(equipment_id);

-- ═══════════════════════════════════════════════════════════════════
-- TIER 5: INSTRUMENT (belongs to System, on a Line)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE instrument (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    system_id           UUID NOT NULL REFERENCES system(id),
    line_id             UUID REFERENCES line(id),
    -- Identity
    tag                 VARCHAR(100) NOT NULL,
    instrument_type     instrument_type NOT NULL,
    description         TEXT,
    -- Engineering data
    range_min           VARCHAR(50),
    range_max           VARCHAR(50),
    range_unit          VARCHAR(20),
    set_point           VARCHAR(50),            -- For safety valves
    calibration_range   VARCHAR(100),
    -- DCS/SCADA
    scada_tag           VARCHAR(100),
    io_type             VARCHAR(20),            -- 'AI', 'AO', 'DI', 'DO'
    signal_type         VARCHAR(50),            -- '4-20mA', 'HART', 'Foundation Fieldbus'
    -- Instrument Index fields
    loop_number         VARCHAR(50),
    junction_box        VARCHAR(50),
    cable_number        VARCHAR(100),
    hookup_drawing      VARCHAR(100),
    datasheet_ref       VARCHAR(100),
    -- Virtual Tool
    vt_scene_id         VARCHAR(100),
    vt_hotspot_id       VARCHAR(100),
    -- Metadata
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_instrument_system ON instrument(system_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_instrument_line ON instrument(line_id);
CREATE INDEX idx_instrument_tag ON instrument(tag);
CREATE INDEX idx_instrument_tag_trgm ON instrument USING gin(tag gin_trgm_ops);
CREATE INDEX idx_instrument_type ON instrument(instrument_type);
CREATE INDEX idx_instrument_scada ON instrument(scada_tag) WHERE scada_tag IS NOT NULL;

-- ═══ JUNCTION: Instrument ↔ P&ID ═══
CREATE TABLE pnid_instrument (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_id         UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
    instrument_id   UUID NOT NULL REFERENCES instrument(id) ON DELETE CASCADE,
    annotation_x_pct DECIMAL(5,2),
    annotation_y_pct DECIMAL(5,2),
    annotation_w_pct DECIMAL(5,2),
    annotation_h_pct DECIMAL(5,2),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pnid_id, instrument_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- TIER 6: COLLABORATIVE ANNOTATIONS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE annotation (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_id         UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL,  -- References user table (not defined here)
    -- Position
    x_pct           DECIMAL(5,2) NOT NULL,
    y_pct           DECIMAL(5,2) NOT NULL,
    w_pct           DECIMAL(5,2),  -- For highlight/shape type
    h_pct           DECIMAL(5,2),  -- For highlight/shape type
    x2_pct          DECIMAL(5,2),  -- Line endpoint X
    y2_pct          DECIMAL(5,2),  -- Line endpoint Y
    -- Shape / style
    shape           VARCHAR(50),            -- 'pin', 'line', 'rectangle', 'circle', 'diamond', 'sym_*'
    color           VARCHAR(20) DEFAULT '#4FE2B0',
    stroke_width    INT DEFAULT 2,
    -- Content
    annotation_type VARCHAR(20) NOT NULL,  -- 'pin', 'note', 'highlight', 'shape', 'symbol'
    text            TEXT,
    attachment_url  VARCHAR(500),           -- Photo/voice memo URL
    -- Entity linking
    linked_entity_type VARCHAR(20),         -- 'equipment', 'instrument', 'line'
    linked_entity_id   UUID,               -- FK to the linked entity
    -- Status
    status          VARCHAR(20) DEFAULT 'open',  -- 'open', 'resolved', 'closed'
    resolved_by     UUID,
    resolved_at     TIMESTAMPTZ,
    -- Metadata
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_annotation_pnid ON annotation(pnid_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_annotation_status ON annotation(status);

CREATE TABLE annotation_reply (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    annotation_id   UUID NOT NULL REFERENCES annotation(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL,
    text            TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_reply_annotation ON annotation_reply(annotation_id) WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- VIEWS: Pre-built queries for Miller Column navigation
-- ═══════════════════════════════════════════════════════════════════

-- Systems with counts
CREATE VIEW v_system_summary AS
SELECT 
    s.id, s.platform_id, s.name, s.code, s.sys_type,
    COUNT(DISTINCT ps.pnid_id) FILTER (WHERE ps.is_primary) AS primary_pnid_count,
    COUNT(DISTINCT l.id) AS line_count,
    COUNT(DISTINCT e.id) AS equipment_count,
    COUNT(DISTINCT i.id) AS instrument_count
FROM system s
LEFT JOIN pnid_system ps ON ps.system_id = s.id
LEFT JOIN line l ON l.system_id = s.id AND l.deleted_at IS NULL
LEFT JOIN equipment e ON e.system_id = s.id AND e.deleted_at IS NULL
LEFT JOIN instrument i ON i.system_id = s.id AND i.deleted_at IS NULL
WHERE s.deleted_at IS NULL
GROUP BY s.id;

-- P&ID with primary system info
CREATE VIEW v_pnid_detail AS
SELECT 
    p.id, p.drawing_number, p.title, p.revision, p.status, p.has_image,
    ps_primary.system_id AS primary_system_id,
    s.code AS primary_system_code,
    s.sys_type AS primary_system_type,
    COUNT(DISTINCT pl.line_id) AS line_count,
    COUNT(DISTINCT ps_all.system_id) AS total_system_count,
    COUNT(DISTINCT ps_all.system_id) FILTER (WHERE NOT ps_all.is_primary) AS xref_system_count
FROM pnid p
LEFT JOIN pnid_system ps_primary ON ps_primary.pnid_id = p.id AND ps_primary.is_primary = TRUE
LEFT JOIN system s ON s.id = ps_primary.system_id
LEFT JOIN pnid_line pl ON pl.pnid_id = p.id
LEFT JOIN pnid_system ps_all ON ps_all.pnid_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY p.id, ps_primary.system_id, s.code, s.sys_type;

-- Line with ownership and appearance info
CREATE VIEW v_line_detail AS
SELECT 
    l.id, l.line_number, l.service, l.nominal_size, l.pipe_class, l.material,
    l.design_pressure, l.design_temperature,
    l.system_id AS owner_system_id,
    s.code AS owner_system_code,
    s.sys_type AS owner_system_type,
    COUNT(DISTINCT pl.pnid_id) AS pnid_count,
    COUNT(DISTINCT e.id) AS equipment_count,
    COUNT(DISTINCT i.id) AS instrument_count,
    ARRAY_AGG(DISTINCT pn.drawing_number) FILTER (WHERE pn.drawing_number IS NOT NULL) AS pnid_numbers
FROM line l
JOIN system s ON s.id = l.system_id
LEFT JOIN pnid_line pl ON pl.line_id = l.id
LEFT JOIN pnid pn ON pn.id = pl.pnid_id AND pn.deleted_at IS NULL
LEFT JOIN equipment e ON e.line_id = l.id AND e.deleted_at IS NULL
LEFT JOIN instrument i ON i.line_id = l.id AND i.deleted_at IS NULL
WHERE l.deleted_at IS NULL
GROUP BY l.id, s.code, s.sys_type;

-- ═══════════════════════════════════════════════════════════════════
-- FUNCTIONS: API query helpers
-- ═══════════════════════════════════════════════════════════════════

-- Get all P&IDs for a system (primary + optionally cross-references)
CREATE OR REPLACE FUNCTION get_pnids_for_system(
    p_system_id UUID,
    p_include_xref BOOLEAN DEFAULT TRUE
) RETURNS TABLE (
    pnid_id UUID,
    drawing_number VARCHAR,
    title VARCHAR,
    revision VARCHAR,
    status document_status,
    is_primary BOOLEAN,
    has_image BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.id, p.drawing_number, p.title, p.revision, p.status, ps.is_primary, p.has_image
    FROM pnid p
    JOIN pnid_system ps ON ps.pnid_id = p.id
    WHERE ps.system_id = p_system_id
      AND p.deleted_at IS NULL
      AND (p_include_xref OR ps.is_primary)
    ORDER BY ps.is_primary DESC, p.drawing_number;
END;
$$ LANGUAGE plpgsql;

-- Get all lines appearing on a P&ID (from any system)
CREATE OR REPLACE FUNCTION get_lines_for_pnid(
    p_pnid_id UUID
) RETURNS TABLE (
    line_id UUID,
    line_number VARCHAR,
    service VARCHAR,
    nominal_size VARCHAR,
    owner_system_id UUID,
    owner_system_code VARCHAR,
    owner_system_type system_type,
    is_continuation BOOLEAN,
    is_cross_reference BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        l.id, l.line_number, l.service, l.nominal_size,
        l.system_id, s.code, s.sys_type,
        COALESCE(pl.is_continuation, FALSE),
        -- Cross-reference = line's owning system is different from the P&ID's primary system
        l.system_id != (
            SELECT ps.system_id FROM pnid_system ps 
            WHERE ps.pnid_id = p_pnid_id AND ps.is_primary LIMIT 1
        ) AS is_xref
    FROM line l
    JOIN pnid_line pl ON pl.line_id = l.id
    JOIN system s ON s.id = l.system_id
    WHERE pl.pnid_id = p_pnid_id
      AND l.deleted_at IS NULL
    ORDER BY is_xref, l.line_number;
END;
$$ LANGUAGE plpgsql;

-- Global search across all entities
CREATE OR REPLACE FUNCTION search_all(
    p_platform_id UUID,
    p_query TEXT,
    p_limit INTEGER DEFAULT 50
) RETURNS TABLE (
    entity_type VARCHAR,
    entity_id UUID,
    tag VARCHAR,
    description TEXT,
    system_code VARCHAR,
    relevance REAL
) AS $$
BEGIN
    RETURN QUERY
    -- Systems
    SELECT 'system'::VARCHAR, s.id, s.code::VARCHAR, s.name::TEXT, s.code, 
           similarity(s.name, p_query) AS rel
    FROM system s WHERE s.platform_id = p_platform_id AND s.deleted_at IS NULL
      AND (s.name ILIKE '%' || p_query || '%' OR s.code ILIKE '%' || p_query || '%')
    UNION ALL
    -- Equipment
    SELECT 'equipment'::VARCHAR, e.id, e.tag::VARCHAR, e.description, sy.code,
           similarity(e.tag, p_query) AS rel
    FROM equipment e JOIN system sy ON sy.id = e.system_id
    WHERE sy.platform_id = p_platform_id AND e.deleted_at IS NULL
      AND (e.tag ILIKE '%' || p_query || '%' OR e.description ILIKE '%' || p_query || '%'
           OR e.equipment_type ILIKE '%' || p_query || '%')
    UNION ALL
    -- Instruments
    SELECT 'instrument'::VARCHAR, i.id, i.tag::VARCHAR, i.description, sy.code,
           similarity(i.tag, p_query) AS rel
    FROM instrument i JOIN system sy ON sy.id = i.system_id
    WHERE sy.platform_id = p_platform_id AND i.deleted_at IS NULL
      AND (i.tag ILIKE '%' || p_query || '%' OR i.scada_tag ILIKE '%' || p_query || '%'
           OR i.description ILIKE '%' || p_query || '%')
    UNION ALL
    -- Lines
    SELECT 'line'::VARCHAR, l.id, l.line_number::VARCHAR, l.service::TEXT, sy.code,
           similarity(l.line_number, p_query) AS rel
    FROM line l JOIN system sy ON sy.id = l.system_id
    WHERE sy.platform_id = p_platform_id AND l.deleted_at IS NULL
      AND (l.line_number ILIKE '%' || p_query || '%' OR l.service ILIKE '%' || p_query || '%')
    UNION ALL
    -- P&IDs
    SELECT 'pnid'::VARCHAR, p.id, p.drawing_number::VARCHAR, p.title::TEXT, 
           COALESCE((SELECT sy2.code FROM pnid_system ps2 JOIN system sy2 ON sy2.id = ps2.system_id 
                     WHERE ps2.pnid_id = p.id AND ps2.is_primary LIMIT 1), ''),
           similarity(p.drawing_number, p_query) AS rel
    FROM pnid p
    WHERE p.deleted_at IS NULL
      AND (p.drawing_number ILIKE '%' || p_query || '%' OR p.title ILIKE '%' || p_query || '%')
    ORDER BY rel DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- TRIGGERS: Auto-update updated_at
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_concession_updated BEFORE UPDATE ON concession FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_field_updated BEFORE UPDATE ON field FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_complex_updated BEFORE UPDATE ON complex FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_platform_updated BEFORE UPDATE ON platform FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_system_updated BEFORE UPDATE ON system FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_pnid_updated BEFORE UPDATE ON pnid FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_line_updated BEFORE UPDATE ON line FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_equipment_updated BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_instrument_updated BEFORE UPDATE ON instrument FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_annotation_updated BEFORE UPDATE ON annotation FOR EACH ROW EXECUTE FUNCTION update_updated_at();
