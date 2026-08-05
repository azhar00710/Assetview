# Implementation Plan: System-Based Continuous P&ID with 3D Integration

**Project:** AssetView Next — GeoSoft
**Date:** 2026-03-13
**Based on:** Cross-model research synthesis (4 AI models + our own analysis)

---

## 1. Cross-Model Comparison: What We Already Had vs. New Insights

### Where We Were Already Ahead

| Area | Our Study | Verdict |
|------|-----------|---------|
| Data model analysis | We identified the `from_equipment_tag`/`to_equipment_tag` topology, the ownership-vs-appearance separation, and `model_3d_object_id` — all 3 models confirmed this as the correct foundation | **Validated** |
| React Flow recommendation | All 3 models converge on React Flow (xyflow) as the best choice for the 2D canvas | **Validated** |
| Three.js + web-ifc | All 3 models agree: Three.js (MIT) as core, web-ifc for IFC loading, glTF as runtime format | **Validated** |
| Yjs for CRDT collaboration | All 3 models recommend Yjs for real-time annotation sync | **Validated** |
| DEXPI as canonical standard | All 3 models say DEXPI is the most important standard for P&ID interoperability | **Validated** |
| Multi-dimensional annotations | Our annotation schema (project/session/person/date) was confirmed by all models | **Validated** |
| Graph-RAG for AI querying | All 3 models reference the PIDQA / "Talking like P&IDs" paper as the key architecture | **Validated** |
| Market gap analysis | All 3 confirm: no product combines continuous P&ID + 3D + annotations + PTW. We identified this first. | **Validated** |

### Critical New Insights from the 3 Models

| # | Insight | Source | Impact | Action |
|---|---------|--------|--------|--------|
| **N1** | **ELK (Eclipse Layout Kernel)** is superior to Dagre for orthogonal/layered layouts. All 3 models recommend it. | All 3 | High — orthogonal routing makes the system view look like a real P&ID, not a graph diagram | Replace Dagre with ELK.js (`elkjs` npm package) |
| **N2** | **Sugiyama-style layered layout** for the primary system "spine" with orthogonal branches for secondary systems | Model 1 | High — creates the visual hierarchy engineers expect | Implement as multi-pass layout: spine first, branches second |
| **N3** | **Semantic zooming / multi-scale clustering** — collapse subsystems into "super-nodes" at low zoom, expand on zoom-in | Models 1, 3 | High — makes 1000+ element systems navigable | Add LOD-aware node rendering to React Flow |
| **N4** | **Port-based routing** — equipment nodes have specific connection ports (inlet/outlet nozzles) for clean edge routing | Model 2 | Medium — improves visual quality and engineering accuracy | Define port positions on custom React Flow node types |
| **N5** | **Gateway nodes at system boundaries** — small badge nodes showing target system name, click to navigate | Model 3 | High — solves the cross-system navigation UX problem | Custom React Flow node type: `SystemGateway` |
| **N6** | **tldraw 4.x has restrictive license** — SDK license forbids production use without commercial license | Model 3 | Critical — confirms React Flow is the only viable MIT option | ~~tldraw~~ → React Flow (already our pick) |
| **N7** | **Min-cut / max-flow for isolation** — classical graph algorithms, not ML, for suggesting isolation boundaries | Models 1, 3 | High — more reliable than LLM-only approach. Rule-based: find nearest block valves upstream/downstream, then DBB check | Implement as graph algorithm + Claude for explanation |
| **N8** | **Ghost context in 3D** — show 20-30m around selected equipment as solid, rest as semi-transparent | Model 2 | Medium — powerful UX for focused 3D navigation | Three.js material opacity based on distance from selection |
| **N9** | **Event bus for 2D↔3D sync** — simple pub/sub pattern, not prop drilling | Model 3 | Medium — cleaner architecture than passing selection through React state | Implement shared event emitter or React context |
| **N10** | **Separate `annotation_revision` table** — append-only revision history separate from current state | Model 3 | High — better normalization for audit trail compliance | Add `annotation_revision` table to schema |
| **N11** | **State machine per annotation type** — different lifecycle flows for isolation vs. note vs. permit | Model 3 | Medium — more rigorous than single lifecycle for all types | Define per-type state machines |
| **N12** | **"Sheet mode" export** — allow engineers to export current canvas view as a traditional P&ID-style sheet | Model 2 | Critical for adoption — engineers can use both paradigms during transition | Add "Export as Sheet" feature |
| **N13** | **Neo4j alongside PostgreSQL** for topology queries | Models 1, 3 | Medium — but adds complexity. PostgreSQL with recursive CTEs + JSONB can handle our scale (100s of systems, not millions) | Defer. Start with PostgreSQL adjacency lists. Add Neo4j only if query performance demands it |
| **N14** | **IEC ISO 81346** for system/equipment tagging standard | Model 2 | Medium — ensures tag structure is universally understood | Adopt for tag naming conventions |
| **N15** | **CFIHOS** (Capital Facilities Information HandOver Specification) | Model 2 | Low initially — relevant for owner-operator handover | Note for Phase 6 interoperability |
| **N16** | **BVH spatial indexing** for Three.js raycasting on 100k+ meshes | Model 3 | High for 3D performance — prevents O(N) search on every click | Use `three-mesh-bvh` library |
| **N17** | **In-memory `{ tag → meshRef }` map** for instant 2D↔3D lookup | Model 3 | Medium — O(1) lookup instead of scene traversal | Build on model load |
| **N18** | **Relationformer** transformer model for P&ID graph conversion (arXiv 2411.13929) | Model 3 | Medium — newer than YOLO-based approaches for P&ID digitization | Research for Phase 7 |
| **N19** | **DynaGRAG** paper — graph RAG that keeps graphs native and traverses dynamically | Model 3 | Medium — better architecture reference for our Graph-RAG than generic RAG | Use as reference for Phase 6 AI |
| **N20** | **OSHA 1910.147** (Lockout/Tagout) and **API RP 2009** (Hot Work) as specific regulatory references | Models 1, 2 | High — our annotation model must capture all fields required by these standards | Map regulatory requirements to annotation schema |

### New Insights from Model 4

| # | Insight | Impact | Action |
|---|---------|--------|--------|
| **N21** | **Kandinsky Model** — the specific orthogonal layout algorithm that handles high-degree nodes (equipment with 5+ connections). ELK implements Kandinsky internally. 3-phase process: topology (minimize crossings) → shape (minimize bends) → coordinate assignment (compact grid). | High — knowing the underlying algorithm helps configure ELK correctly. "Main Header" alignment: primary process flow horizontal, branches drop vertically. | Configure ELK with Kandinsky-aware settings. Set primary flow axis to horizontal. |
| **N22** | **Functional Tag vs Geometric Instance** — A P&ID tag (e.g., "CV-019S") is a *functional identifier*. In 3D, that choke valve may be composed of *multiple meshes* (body, bonnet, handwheel, flanges). Tag→mesh is **1:N, not 1:1**. | Critical — our `{ tag → meshRef }` map assumed 1:1. Real 3D models have mesh hierarchies. Need `{ tag → Three.js Group }` or `{ tag → meshRef[] }`. | Change tag map to `{ tag → Group/Object3D }`. Use `getObjectByName(tag)` on scene hierarchy, or pre-build groups during model load. Highlight entire group on selection, not just one mesh. |
| **N23** | **[Apache AGE](https://age.apache.org/)** — PostgreSQL extension that adds Cypher graph query language. Stays in one database (no Neo4j dependency) while enabling native graph traversal queries. Supports PG 15-18. Available on Azure PostgreSQL. LangChain integration exists. | High — resolves the PostgreSQL-vs-Neo4j debate. Graph queries without a second database. Cypher is more expressive than recursive CTEs for multi-hop topology traversal. | Install AGE extension. Use Cypher for topology queries (isolation BFS, upstream/downstream, path finding). Keep Prisma for CRUD operations. |
| **N24** | **[3D Tiles + three-loader-3dtiles](https://github.com/nytimes/three-loader-3dtiles)** — OGC 3D Tiles format (by Cesium) for streaming massive 3D models. NYT's Three.js loader handles b3dm (batched glTF) and point clouds. LOD-based tile loading = only visible tiles at appropriate detail level are fetched. | High for real platforms — offshore platform models can be 2-5 GB. Cannot load entire model into browser RAM. 3D Tiles streams only what the camera sees. | Add 3D Tiles as loading option alongside raw glTF. Convert large plant models to 3D Tiles tileset offline (using Cesium ion or `3d-tiles-tools`). Use `three-loader-3dtiles` for streaming. |
| **N25** | **IndexedDB caching for 3D model fragments** — Cache loaded glTF/3D Tile chunks in browser IndexedDB so repeat visits don't re-download. | Medium — critical for offshore platforms with satellite bandwidth (~2 Mbps). First load: slow. Subsequent: instant. | Implement Service Worker + IndexedDB cache layer for model tiles. Cache invalidation via model version hash. |
| **N26** | **"Digital Index" as Phase 0.5** — Before building the continuous canvas, deliver immediate value: link existing PDF P&ID sheets to 3D model tags. Click a tag in 3D → opens the correct PDF sheet at the right location. | Critical for adoption — delivers value in weeks, not months. Engineers immediately see benefit before the big paradigm shift. | Insert new Phase 0.5 into roadmap. Build tag→PDF mapping table. 3D viewer with click→PDF-open. |
| **N27** | **Dead Legs detection via graph topology** — AI can flag pipe sections where fluid stagnates by analyzing flow direction rules against the topology graph. Common corrosion/safety issue. | Medium — specific, high-value HAZOP use case. Our HAZOP section was generic; this is a concrete deliverable. | Add as specific AI function: `detect_dead_legs(system_id)` — finds pipe segments with no through-flow based on topology + valve states. |
| **N28** | **ISO 15926-11** (not just ISO 15926 generally) — the specific part addressing lifecycle integration of process plant data, covering handover from design to operations. | Low-medium — more precise reference for our standards compliance. | Reference ISO 15926-11 specifically in annotation/handover design. |

### Where Models Disagreed

| Topic | Model 1 | Model 2 | Model 3 | Our Decision |
|-------|---------|---------|---------|--------------|
| **2D Canvas** | tldraw | React Flow | React Flow (flagged tldraw license risk) | **React Flow** — MIT, React-native, production-safe |
| **Graph DB** | Neo4j required | PostgreSQL sufficient | Neo4j or PostgreSQL | **PostgreSQL first** — our data is relational with graph queries, not a pure graph problem. Recursive CTEs handle topology traversal. Add Neo4j only at scale. |
| **Timeline** | 6-month phases (24 months total) | 6-8 week phases (12 months total) | 5 phases with typical timelines | **Aggressive but realistic** — 4-6 week phases, targeting working MVP in 4 months |
| **Layout algorithm** | Sugiyama hybrid | ELK orthogonal | ELK/Dagre layered | **ELK** as primary (supports orthogonal + hierarchical + port-based), Dagre as fallback |
| **Isolation AI** | Graph traversal + rules + Claude explanation | Graph BFS + Claude | Min-cut/max-flow + rules | **Rule-based graph BFS** (find nearest block valves) + **Claude for rationale generation** |

---

## 2. Final Architecture Decision Record

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AssetView Next Architecture                      │
│                                                                          │
│  ┌─────────────────────────────┐  ┌────────────────────────────────┐   │
│  │   2D System Canvas           │  │   3D Plant Viewer               │   │
│  │   React Flow (xyflow)        │  │   Three.js + web-ifc            │   │
│  │   + ELK.js layout            │◄─►  + three-mesh-bvh             │   │
│  │   + Custom P&ID node types   │  │   + glTF/IFC/3D Tiles loaders            │   │
│  │   + Semantic zoom (LOD)      │  │   + Ghost context rendering     │   │
│  │   + Gateway boundary nodes   │  │   + tag→Group map (1:N)             │   │
│  └──────────┬──────────────────┘  └───────────┬────────────────────┘   │
│             │                                   │                        │
│  ┌──────────┴───────────────────────────────────┴────────────────────┐  │
│  │                    Event Bus (Selection Sync)                      │  │
│  │   tag-selected │ annotation-created │ isolation-updated            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                  Annotation Engine                                 │  │
│  │   Yjs (CRDT) for real-time │ append-only revisions │ state machine │  │
│  │   annotation + annotation_revision + annotation_group tables       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    AI Engine (Claude API)                          │  │
│  │   Graph-RAG queries │ Isolation BFS + rules │ HAZOP tracing       │  │
│  │   PTW conflict detection │ NL→Cypher/SQL translation               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Data Layer                                      │  │
│  │   PostgreSQL 15 (primary) │ Prisma ORM │ pg_trgm search           │  │
│  │   Topology: Apache AGE (Cypher queries) + adjacency lists                       │  │
│  │   Spatial: PostGIS or JSONB geometry                               │  │
│  │   Standards: DEXPI-inspired schema │ IEC 81346 tagging             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    API Layer (Fastify)                              │  │
│  │   REST endpoints │ WebSocket (annotation sync) │ Claude function    │  │
│  │   calling │ Static file serving (3D models, P&ID images)           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Implementation Plan (Phased)

### Phase 0: Topology Foundation (Weeks 1-3)

**Goal:** Transform existing data model into a traversable topology graph.

**Database Changes:**
```sql
-- 1. Topology node table (unifies equipment, tees, boundaries as graph nodes)
CREATE TABLE topology_node (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_type VARCHAR(30) NOT NULL,     -- 'equipment' | 'instrument' | 'tee' | 'reducer' | 'boundary' | 'nozzle'
    reference_id UUID,                   -- FK to equipment/instrument table (nullable for tees/boundaries)
    system_id UUID REFERENCES system(id),
    tag VARCHAR(100),                    -- mirrors equipment.tag or auto-generated for tees
    label VARCHAR(200),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Topology edge table (connections between nodes via pipe segments)
CREATE TABLE topology_edge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_id UUID REFERENCES line(id),    -- which line this segment belongs to
    from_node_id UUID REFERENCES topology_node(id),
    to_node_id UUID REFERENCES topology_node(id),
    edge_type VARCHAR(30) NOT NULL,      -- 'pipe' | 'signal' | 'utility' | 'boundary_crossing'
    segment_order INT DEFAULT 0,
    flow_direction VARCHAR(10),          -- 'forward' | 'reverse' | 'bidirectional'
    metadata JSONB DEFAULT '{}',         -- nominal_size, pipe_class, material from parent line
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. System boundary table (where systems interconnect)
CREATE TABLE system_boundary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_system_id UUID REFERENCES system(id),
    to_system_id UUID REFERENCES system(id),
    boundary_type VARCHAR(50) NOT NULL,  -- 'tie-in' | 'battery_limit' | 'interface'
    from_node_id UUID REFERENCES topology_node(id),
    to_node_id UUID REFERENCES topology_node(id),
    from_line_id UUID REFERENCES line(id),
    to_line_id UUID REFERENCES line(id),
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Layout persistence (store computed or manual layouts per system)
CREATE TABLE system_layout (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_id UUID REFERENCES system(id),
    layout_type VARCHAR(30) NOT NULL,    -- 'auto_elk' | 'auto_dagre' | 'manual' | 'hybrid'
    node_positions JSONB NOT NULL,       -- { nodeId: { x, y, width, height, collapsed } }
    edge_routes JSONB,                   -- { edgeId: { points: [[x,y], ...] } }
    viewport JSONB,                      -- { x, y, zoom } for saved view state
    is_default BOOLEAN DEFAULT FALSE,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_system_layout_default ON system_layout(system_id) WHERE is_default = TRUE;

-- 5. Indexes for topology traversal
CREATE INDEX idx_topo_edge_from ON topology_edge(from_node_id);
CREATE INDEX idx_topo_edge_to ON topology_edge(to_node_id);
CREATE INDEX idx_topo_node_system ON topology_node(system_id);
CREATE INDEX idx_topo_node_tag ON topology_node(tag);
CREATE INDEX idx_topo_edge_line ON topology_edge(line_id);
```

**Backend Tasks:**
- [ ] Migration: Create topology tables
- [ ] Install Apache AGE extension (`CREATE EXTENSION age;`) for Cypher graph queries (per insight N23)
- [ ] Create AGE graph: `SELECT create_graph('plant_topology');` — mirrors topology_node/edge as a labeled property graph
- [ ] Seed script: Auto-generate `topology_node` and `topology_edge` records from existing `line.from_equipment_tag` / `to_equipment_tag` + equipment table
- [ ] Seed script: Auto-generate `system_boundary` records from `pnid_system` cross-references (where a line owned by system A appears on a P&ID whose primary system is B)
- [ ] Sync topology into AGE graph for Cypher queries (upstream/downstream BFS, isolation path finding)
- [ ] API: `GET /api/v1/systems/:systemId/topology` — returns nodes + edges for React Flow
- [ ] API: `GET /api/v1/systems/:systemId/topology/upstream/:nodeId` — Cypher: `MATCH path = (start)-[*]->(target) WHERE start.tag = $tag RETURN path`
- [ ] API: `GET /api/v1/systems/:systemId/topology/downstream/:nodeId` — Cypher-based downstream traversal
- [ ] API: `GET /api/v1/platforms/:platformId/system-boundaries` — returns all inter-system connections

**Validation:**
- [ ] Run topology queries against seed data. Verify: PV019 system has XT → CV-019S → ... path. CD system boundary detected at well P&ID cross-reference.

---

### Phase 0.5: Digital Index — Immediate Value (Weeks 2-4, parallel with Phase 0)

**Goal (per insight N26):** Before the continuous canvas exists, deliver immediate value: click a tag in the 3D model → opens the correct P&ID PDF sheet at the relevant location. This bridges today's PDF world with the future continuous view and gets engineers using the 3D model immediately.

**Database Changes:**
```sql
-- Tag-to-document mapping (links equipment tags to P&ID sheet locations)
CREATE TABLE tag_document_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag VARCHAR(100) NOT NULL,
    document_type VARCHAR(30) NOT NULL,   -- 'pnid' | 'isometric' | 'datasheet' | 'manual'
    document_id UUID,                     -- FK to pnid table (or other doc tables)
    document_ref VARCHAR(200),            -- drawing number or file path
    page_number INT,                      -- for multi-page PDFs
    region_x_pct DECIMAL(5,2),            -- optional: region on page where tag appears
    region_y_pct DECIMAL(5,2),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_tag_doc_tag ON tag_document_link(tag);
CREATE INDEX idx_tag_doc_type ON tag_document_link(document_type);
```

**Frontend Tasks:**
- [ ] Basic Three.js viewer with glTF model loading (simplified — full viewer in Phase 2)
- [ ] Click mesh → read `userData.tag` → query `tag_document_link` → open P&ID PDF in side panel
- [ ] PDF viewer component (using `react-pdf` or `<iframe>`) with page navigation
- [ ] Highlight the region on the PDF where the tag appears (if coordinates available)
- [ ] Tag search bar: type a tag → list matching documents → click to open

**Backend Tasks:**
- [ ] API: `GET /api/v1/tags/:tag/documents` — returns linked documents for a tag
- [ ] Seed: populate `tag_document_link` from existing `pnid_equipment` and `pnid_instrument` junction tables
- [ ] Static serving of P&ID PDF files

**Value Delivered:**
- Engineers click equipment in 3D → instantly see the right P&ID sheet
- No more manual searching through drawing registers
- Builds trust in the 3D model before the paradigm shift to continuous canvas

---

### Phase 1: Continuous 2D Canvas MVP (Weeks 3-7)

**Goal:** Replace sheet-based P&ID viewing with a system-based continuous canvas for a single system.

**Frontend Tasks:**
- [ ] Install dependencies: `@xyflow/react`, `elkjs`
- [ ] Create custom React Flow node types:
  - `EquipmentNode` — renders equipment symbol (valve, vessel, tree, pump) with tag label, criticality color, selection state
  - `InstrumentNode` — renders as satellite circle attached to parent line/equipment
  - `TeeNode` — pipe junction point (small dot)
  - `SystemGatewayNode` — boundary to another system, shows target system name + badge, click to navigate (per insight N5)
  - `CollapsedGroupNode` — semantic zoom: shows collapsed subsystem with element count (per insight N3)
- [ ] Create custom React Flow edge types:
  - `PipeEdge` — renders as styled line with nominal size indicator, pipe class label, flow direction arrow
  - `SignalEdge` — dashed line for instrument signals
  - `BoundaryEdge` — dashed colored line crossing to another system
- [ ] Implement ELK.js layout engine (per insight N1):
  - Multi-pass layout: primary system spine (left-to-right or top-to-bottom flow) + orthogonal branches for cross-system connections
  - Port-based routing on equipment nodes (per insight N4)
  - Layout computed on backend or in web worker (ELK can be slow for large graphs)
- [ ] Implement semantic zooming (per insight N3):
  - Zoom level 1 (overview): Systems as collapsed blocks with equipment counts
  - Zoom level 2 (system): Equipment nodes visible, instruments collapsed
  - Zoom level 3 (detail): All elements visible with full labels and properties
- [ ] Implement system navigation:
  - Miller Columns remain as sidebar navigator (click system → loads topology into canvas)
  - Minimap in corner
  - Fit-to-system button
  - Click SystemGatewayNode → smooth pan/zoom to connected system (load if not already)
- [ ] System-level color coding:
  - Primary system elements: full opacity, system type color
  - Cross-system elements: 65% opacity, owner system's color (matches existing Miller Column behavior)

**UX for Adoption (per insight N12):**
- [ ] "Sheet mode" toggle: switch between continuous system view and traditional P&ID sheet view (existing PnidViewer.jsx)
- [ ] "Export as PDF" button: render current canvas viewport as a P&ID-style PDF sheet

**Key Files to Create:**
```
frontend/src/components/canvas/
├── SystemCanvas.jsx          -- React Flow wrapper, ELK layout, semantic zoom
├── nodes/
│   ├── EquipmentNode.jsx     -- Valve, vessel, tree, pump symbols
│   ├── InstrumentNode.jsx    -- Pressure/temp/flow/level instruments
│   ├── TeeNode.jsx           -- Junction points
│   ├── SystemGatewayNode.jsx -- Cross-system boundary badges
│   └── CollapsedGroupNode.jsx -- Semantic zoom collapsed view
├── edges/
│   ├── PipeEdge.jsx          -- Styled pipe segment
│   ├── SignalEdge.jsx        -- Instrument signal line
│   └── BoundaryEdge.jsx      -- Cross-system connection
├── layout/
│   ├── elkLayout.js          -- ELK.js configuration and runner
│   └── layoutWorker.js       -- Web worker for async layout computation
└── hooks/
    ├── useTopology.js        -- React Query hook for topology API
    └── useSystemLayout.js    -- Layout persistence and caching
```

---

### Phase 2: 3D Model Viewer + 2D↔3D Linking (Weeks 6-10)

**Goal:** Split-pane view: 2D system canvas on left, 3D model on right. Click in either → highlight in both.

**Frontend Tasks:**
- [ ] Install dependencies: `three`, `@react-three/fiber`, `@react-three/drei`, `three-mesh-bvh`, `three-loader-3dtiles`
- [ ] Create `ModelViewer.jsx` component:
  - Three.js canvas with orbit controls
  - **Multi-format loading strategy** (per insight N24):
    - Small models (<500MB): glTF loader (primary) + IFC loader (via web-ifc)
    - Large models (>500MB): 3D Tiles streaming via `three-loader-3dtiles` (only visible tiles loaded at appropriate LOD)
  - **Tag→Group mapping (1:N, per insight N22)**: A functional tag like "CV-019S" maps to a `THREE.Group` containing multiple meshes (body, bonnet, handwheel, flanges). Build `{ tag → Object3D }` map using `scene.getObjectByName(tag)` or by traversing hierarchy and grouping by `userData.tag`. Highlight entire group on selection.
  - **IndexedDB tile cache (per insight N25)**: Cache loaded model tiles in browser IndexedDB. First visit downloads; subsequent visits load from cache. Invalidate via model version hash. Critical for offshore satellite bandwidth (~2 Mbps).
  - BVH spatial indexing for raycasting (per insight N16)
  - System-level visibility: show/hide meshes by system_id
  - Ghost context rendering: selected equipment at full opacity, 20-30m radius at 50% opacity, rest at 10% opacity (per insight N8)
- [ ] Create `SelectionBus.js` — shared event emitter (per insight N9):
  ```javascript
  // Event types:
  // 'tag:select'    { tag, source: '2d'|'3d' }
  // 'tag:deselect'  { tag, source: '2d'|'3d' }
  // 'system:select' { systemId, source }
  // 'camera:flyto'  { position, target }
  ```
- [ ] 2D → 3D flow:
  - Click equipment in React Flow → emit `tag:select` → 3D viewer finds Object3D group by tag → apply highlight material to all child meshes (emissive glow) → smooth camera fly-to group bounding box center (lerp over 1s)
- [ ] 3D → 2D flow:
  - Click mesh in Three.js → raycast → traverse parent hierarchy to find `userData.tag` → emit `tag:select` → React Flow centers on node → highlight with pulsing border
- [ ] Split-pane layout:
  - Resizable split between 2D canvas (left, default 60%) and 3D viewer (right, default 40%)
  - Toggle to full-screen either view
  - Synchronized system selection: changing system in 2D updates 3D visibility

**Backend Tasks:**
- [ ] API: `GET /api/v1/models/:platformId` — returns model metadata (format, URL, size)
- [ ] API: `GET /api/v1/models/:platformId/tag-map` — returns `{ tag → objectId }` mapping for 2D↔3D
- [ ] Static file serving for 3D models (glTF files in `/models/` directory)

**Key Files to Create:**
```
frontend/src/components/viewer3d/
├── ModelViewer.jsx           -- Three.js canvas, model loading, raycasting
├── GhostContext.jsx          -- Distance-based opacity rendering
├── HighlightManager.jsx      -- Selection highlighting (emissive glow)
└── hooks/
    ├── useModelLoader.js     -- glTF/IFC loading with progress
    ├── useTagMap.js          -- { tag → Object3D group } builder (1:N mapping)
    └── useTileCache.js       -- IndexedDB cache for 3D Tiles

frontend/src/lib/
├── SelectionBus.js           -- Event emitter for 2D↔3D sync
└── coordinateUtils.js        -- 2D canvas ↔ 3D world coordinate conversion
```

---

### Phase 3: Annotation System (Weeks 9-14)

**Goal:** Multi-dimensional annotations rendered in both 2D and 3D, with real-time collaboration.

**Database Changes:**
```sql
-- Users table (if not exists)
CREATE TABLE IF NOT EXISTS app_user (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    email VARCHAR(300) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL,          -- 'engineer' | 'supervisor' | 'inspector' | 'planner' | 'admin'
    department VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Annotation projects/campaigns
CREATE TABLE annotation_project (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id UUID REFERENCES platform(id),
    name VARCHAR(300) NOT NULL,
    description TEXT,
    status VARCHAR(30) DEFAULT 'active',  -- 'active' | 'archived'
    created_by UUID REFERENCES app_user(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Annotation sessions (grouping by work session)
CREATE TABLE annotation_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES annotation_project(id),
    created_by UUID REFERENCES app_user(id),
    title VARCHAR(300),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

-- Core annotation table (current state)
CREATE TABLE annotation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES annotation_project(id),
    session_id UUID REFERENCES annotation_session(id),
    created_by UUID REFERENCES app_user(id),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Target
    target_type VARCHAR(30) NOT NULL,     -- 'equipment' | 'line' | 'instrument' | 'area' | 'node' | 'edge'
    target_id UUID,                       -- FK to entity (nullable for area annotations)
    target_tag VARCHAR(100),              -- denormalized tag for fast lookup

    -- Type + content
    annotation_type VARCHAR(50) NOT NULL, -- 'note' | 'markup' | 'isolation_point' | 'permit_zone' | 'hazard_zone' | 'defect' | 'planning' | 'measurement'
    content TEXT,
    structured_data JSONB DEFAULT '{}',   -- type-specific fields (see below)

    -- 2D geometry (on system canvas)
    geometry_2d JSONB,                    -- { type: 'point'|'polyline'|'polygon'|'circle', coordinates: [...] }

    -- 3D geometry (in model space)
    geometry_3d JSONB,                    -- { type: 'point'|'volume'|'path', coordinates: [...] }

    -- State machine (per insight N11)
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    status_machine VARCHAR(50),           -- 'simple' | 'isolation' | 'permit' — determines allowed transitions

    -- Audit
    version INT NOT NULL DEFAULT 1,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,

    -- Display
    color VARCHAR(20),
    priority VARCHAR(20),
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',

    deleted_at TIMESTAMPTZ
);

-- Append-only revision history (per insight N10)
CREATE TABLE annotation_revision (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    annotation_id UUID REFERENCES annotation(id) NOT NULL,
    version INT NOT NULL,
    changed_by UUID REFERENCES app_user(id),
    changed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    change_type VARCHAR(30) NOT NULL,     -- 'created' | 'updated' | 'status_change' | 'deleted'
    previous_state JSONB NOT NULL,        -- full snapshot of annotation before change
    change_description TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Annotation groups (isolation certificates, PTW, inspection plans)
CREATE TABLE annotation_group (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_type VARCHAR(50) NOT NULL,      -- 'isolation_certificate' | 'permit_to_work' | 'inspection_plan' | 'work_package'
    title VARCHAR(500) NOT NULL,
    description TEXT,

    -- Lifecycle
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    -- isolation: draft → reviewed → authorized → applied → cleared → archived
    -- ptw:       draft → approved → active → suspended → closed → archived

    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,

    -- Regulatory fields (per insight N20 — OSHA 1910.147, API RP 2009)
    work_type VARCHAR(100),               -- 'hot_work' | 'confined_space' | 'electrical' | 'mechanical' | 'general'
    isolation_method VARCHAR(100),         -- 'single_block' | 'double_block_bleed' | 'blind' | 'disconnect'
    energy_sources TEXT[],                 -- ['pressure', 'electrical', 'mechanical', 'thermal', 'chemical', 'gravity']
    verification_method VARCHAR(100),      -- 'zero_energy_check' | 'try_test' | 'bleed_drain'

    created_by UUID REFERENCES app_user(id),
    approved_by UUID REFERENCES app_user(id),
    approved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE annotation_group_item (
    group_id UUID REFERENCES annotation_group(id),
    annotation_id UUID REFERENCES annotation(id),
    item_order INT DEFAULT 0,
    item_role VARCHAR(50),                -- 'isolation_point' | 'work_target' | 'boundary_marker' | 'hazard'
    PRIMARY KEY (group_id, annotation_id)
);

-- Indexes
CREATE INDEX idx_annotation_project ON annotation(project_id);
CREATE INDEX idx_annotation_session ON annotation(session_id);
CREATE INDEX idx_annotation_target ON annotation(target_type, target_id);
CREATE INDEX idx_annotation_type ON annotation(annotation_type);
CREATE INDEX idx_annotation_status ON annotation(status);
CREATE INDEX idx_annotation_tag ON annotation(target_tag);
CREATE INDEX idx_annotation_current ON annotation(id) WHERE is_current = TRUE;
CREATE INDEX idx_revision_annotation ON annotation_revision(annotation_id);
CREATE INDEX idx_group_type_status ON annotation_group(group_type, status);
```

**Frontend Tasks:**
- [ ] Install: `yjs`, `y-websocket`
- [ ] Annotation toolbar: type selector (note, markup, isolation, permit zone, defect, planning)
- [ ] 2D annotation rendering: React Flow overlay nodes/edges for each annotation type
- [ ] 3D annotation rendering: Three.js CSS2DRenderer for labels, translucent meshes for zones
- [ ] Annotation panel: sidebar listing annotations with filters (project, session, person, date, type, status)
- [ ] Yjs integration: real-time sync of annotation CRUD operations between users
- [ ] State machine UI: status transitions with role-based permissions (only supervisors can approve)

**Backend Tasks:**
- [ ] Annotation CRUD endpoints (REST + WebSocket broadcast)
- [ ] Revision auto-creation on every annotation update
- [ ] Annotation group CRUD endpoints
- [ ] PDF export for isolation certificates and PTW documents

---

### Phase 4: Isolation & PTW Workflows (Weeks 13-18)

**Goal:** AI-assisted isolation planning and permit-to-work spatial conflict detection.

**AI Integration Tasks:**
- [ ] **Isolation BFS algorithm** (per insight N7):
  ```
  Input: target equipment tag
  Algorithm:
    1. From target node, BFS upstream until reaching a block valve → mark as upstream isolation point
    2. From target node, BFS downstream until reaching a block valve → mark as downstream isolation point
    3. From target node, find nearest drain point (valve with type='drain')
    4. From target node, find nearest vent point (valve with type='vent')
    5. If isolation method is 'double_block_bleed', find two block valves in series with bleed between
  Output: suggested isolation point set (annotation_group with individual annotations)
  ```
- [ ] **Claude integration for isolation rationale**:
  - Feed topology subgraph + isolation suggestions to Claude API
  - Claude generates human-readable explanation: "Upstream isolation at BV-019A because it is the nearest block valve on the 6" production line between the Christmas Tree and the Choke Valve. Design pressure is 5000 psi, requiring a double block and bleed arrangement."
- [ ] **PTW spatial conflict detection**:
  - When creating a permit zone, query all active annotation_groups with overlapping geometry
  - Check for prohibited combinations (e.g., hot work near active hydrocarbon venting)
  - Show warnings with conflict details

**Frontend Tasks:**
- [ ] Isolation wizard UI:
  1. Select target equipment
  2. AI suggests isolation points (displayed on both 2D and 3D)
  3. Engineer adjusts (add/remove points)
  4. Generate isolation certificate (annotation_group)
  5. Submit for approval
- [ ] PTW wizard UI:
  1. Draw permit zone (polygon on 2D canvas or 3D model)
  2. System shows conflicts (overlapping permits, incompatible work types)
  3. Select work type, energy sources, verification method
  4. Generate PTW document
  5. Submit for approval
- [ ] SIMOPS dashboard: map view showing all active permits and isolations with spatial overlap warnings

---

### Phase 5: AI Engine (Weeks 16-22, parallel with Phase 4)

**Goal:** Natural language querying and AI-assisted engineering workflows.

**Tasks:**
- [ ] **Graph-RAG architecture** (per DynaGRAG pattern, insight N19):
  - Store topology as adjacency lists in PostgreSQL
  - Claude function calling tools:
    - `query_topology(system_id, direction, from_tag, depth)` — graph traversal
    - `search_equipment(filters)` — tag/type/criticality search
    - `get_annotations(filters)` — annotation search
    - `find_isolation_points(target_tag, method)` — isolation BFS
    - `check_permit_conflicts(geometry, work_type)` — spatial conflict check
  - Claude receives topology context as structured data, not embeddings — keeps engineering precision
- [ ] **Natural language queries**:
  - "Show me all high-pressure safety valves on PV019" → topology query + highlight in 2D/3D
  - "What equipment is upstream of CV-019S?" → BFS upstream + highlight path
  - "Create an isolation for hot work on CV-019S" → invoke isolation wizard with AI pre-fill
- [ ] **HAZOP assistance**:
  - "What happens if PT-01901 fails high?" → trace through topology, identify affected equipment, suggest consequences based on process knowledge
- [ ] **Dead Legs detection (per insight N27)**:
  - `detect_dead_legs(system_id)` — Cypher query finds pipe segments with no through-flow (terminal branches with no outlet, stagnant connections)
  - Flag as corrosion/safety risk with annotation auto-generated
  - "Show me all dead legs in the Closed Drain system" → highlights stagnant pipe segments in both 2D and 3D

---

### Phase 6: Standards & Interoperability (Weeks 20-26)

**Goal:** DEXPI import/export, IEC 81346 tagging, CFIHOS handover support.

**Tasks:**
- [ ] DEXPI XML export: serialize system topology + annotations to DEXPI format
- [ ] DEXPI XML import: parse DEXPI files from AVEVA/Hexagon/Bentley into our topology model
- [ ] IEC 81346 tag validation: ensure equipment tags follow standard structure
- [ ] CFIHOS handover package generation (per insight N15)
- [ ] OPC UA companion spec alignment (for future live data integration)

---

### Phase 7: P&ID Digitization Pipeline (Weeks 24-32, optional)

**Goal:** Semi-automatic conversion of existing PDF P&IDs into structured topology data.

**Tasks:**
- [ ] Symbol detection: YOLO v11 or Relationformer (per insight N18) trained on P&ID symbol library
- [ ] Text detection + OCR: CRAFT + Tesseract for tag text extraction
- [ ] Line detection + vectorization: skeletonization → pixel tracing → graph assembly
- [ ] Topology inference: connect detected symbols via detected lines
- [ ] Validation UI: engineer reviews AI-proposed topology, corrects errors, system learns
- [ ] Use TCS Digitize-PID synthetic dataset (500 P&IDs) for initial training

---

## 4. Dependency Graph

```
Phase 0 (Topology) ──────────┐
    │                         │
    ├──→ Phase 0.5 (Digital Index)  ←── parallel, immediate value
    │
    ├──→ Phase 1 (2D Canvas)
    │        │
    │        ├──→ Phase 2 (3D Viewer + Linking)  ←── can start Week 6 (overlap)
    │        │        │
    │        │        └──→ Phase 3 (Annotations)  ←── needs both 2D + 3D
    │        │                 │
    │        │                 ├──→ Phase 4 (Isolation/PTW)
    │        │                 │
    │        │                 └──→ Phase 5 (AI Engine)  ←── parallel with Phase 4
    │        │
    │        └──→ Phase 6 (Standards)  ←── can start after Phase 1
    │
    └──→ Phase 7 (Digitization)  ←── independent, start anytime
```

**Critical path:** Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4

**Quick win path:** Phase 0 + Phase 0.5 in parallel → engineers clicking tags in 3D within 3 weeks

**Parallelizable:** Phase 0.5 alongside Phase 0. Phase 5 alongside Phase 4. Phase 6 alongside Phase 3+. Phase 7 independent.

---

## 5. Technology Stack Summary

| Component | Choice | License | Why |
|-----------|--------|---------|-----|
| 2D Canvas | React Flow (xyflow) | MIT | All 3 models agree. React-native, infinite canvas, ports, minimap. tldraw has license risk. |
| Layout Engine | ELK.js (elkjs) | EPL 2.0 | All 3 models recommend. Orthogonal + hierarchical + port-based routing. |
| 3D Engine | Three.js | MIT | Maximum flexibility, massive ecosystem |
| IFC Loading | web-ifc (That Open) | MIT | Three.js integration, IFC 2x3 + 4.3 |
| 3D Performance | three-mesh-bvh | MIT | BVH spatial indexing for raycasting on 100k+ meshes |
| 3D Streaming | three-loader-3dtiles | MIT | OGC 3D Tiles for massive models (>500MB). LOD-based tile streaming. |
| Real-time Collab | Yjs + y-websocket | MIT | CRDT-based, works with React Flow |
| Backend | Fastify 5 | MIT | Already in use. Fastest Node.js framework |
| ORM | Prisma 6 | Apache 2.0 | Already in use. Type-safe, migration support |
| Database | PostgreSQL 15 | PostgreSQL | Already in use. Apache AGE extension for Cypher graph queries |
| Graph Queries | Apache AGE | Apache 2.0 | Cypher queries within PostgreSQL. No separate graph DB needed. Supports PG 15-18. |
| AI | Claude API (Anthropic) | Commercial | Already integrated. Function calling for topology queries |
| P&ID Standard | DEXPI 2.0 | CC | Industry standard for P&ID data exchange |
| Tagging Standard | IEC ISO 81346 | ISO | Standard for system/equipment tagging |

---

## 6. Success Criteria per Phase

| Phase | Ship Criteria | User Value |
|-------|--------------|------------|
| **Phase 0** | Topology API returns correct graph for all 14 systems in seed data. Cypher traversal works via Apache AGE. | Foundation (no user-facing change) |
| **Phase 0.5** | Click equipment tag in 3D model → correct P&ID PDF opens in side panel at the right page/region. Tag search returns matching documents. | "I can click anything in 3D and see the right drawing instantly" |
| **Phase 1** | Engineer can view PV019 system end-to-end on infinite canvas, see all equipment/instruments, navigate cross-system connections. Can toggle between canvas and sheet mode. | "I can finally see my whole system without flipping sheets" |
| **Phase 2** | Click equipment in 2D → highlighted in 3D with camera fly-to. Click in 3D → highlighted in 2D. Ghost context around selection. | "I can see where things are physically" |
| **Phase 3** | Create note/markup annotations visible in both views. Multiple users see each other's annotations in real-time. Annotation history preserved. | "We can collaborate on the diagram" |
| **Phase 4** | Create isolation certificate with AI-suggested isolation points. Create PTW with spatial conflict detection. Export as PDF. | "This replaces our paper isolation certificates" |
| **Phase 5** | Ask "show me all safety valves on PV019" → system highlights them in 2D and 3D. | "I can talk to the diagram" |

---

## 7. What to Build First (Immediate Next Steps)

**Start today (two parallel tracks):**

**Track A — Topology Foundation (Phase 0):**
1. Create `topology_node`, `topology_edge`, `system_boundary` tables
2. Install Apache AGE extension: `CREATE EXTENSION age;`
3. Write seed script to populate topology from existing `line.from_equipment_tag`/`to_equipment_tag`
4. Build `GET /api/v1/systems/:systemId/topology` endpoint
5. Install `@xyflow/react` + `elkjs` in frontend
6. Build first `SystemCanvas.jsx` with PV019 system data

**Track B — Digital Index (Phase 0.5, parallel):**
1. Create `tag_document_link` table, seed from `pnid_equipment`/`pnid_instrument`
2. Basic Three.js viewer with glTF loader
3. Click mesh → read tag → open P&ID PDF in side panel
4. Tag search bar

**Result:** Working continuous system view AND click-to-open-PDF in 3D within 3-4 weeks.

---

*Document synthesized from: Our original VISION study + cross-model research from 4 AI models + AssetView codebase analysis.*
