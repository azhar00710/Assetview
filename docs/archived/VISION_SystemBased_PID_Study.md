# Vision Study: System-Based Continuous P&ID Visualization with 3D Model Integration

**Project:** AssetView — GeoSoft
**Date:** 2026-03-13
**Status:** Research & Requirements Analysis

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Requirements Analysis](#2-requirements-analysis)
3. [Current State Assessment](#3-current-state-assessment)
4. [Architecture Vision](#4-architecture-vision)
5. [Open-Source Libraries & Tools](#5-open-source-libraries--tools)
6. [Academic Research & State of the Art](#6-academic-research--state-of-the-art)
7. [AI Integration Opportunities](#7-ai-integration-opportunities)
8. [Annotation System Design](#8-annotation-system-design)
9. [Operational Use Cases](#9-operational-use-cases)
10. [Implementation Roadmap](#10-implementation-roadmap)
11. [Risks & Mitigations](#11-risks--mitigations)
12. [Reusable Research Prompt](#12-reusable-research-prompt)

---

## 1. Executive Summary

The vision is to **fundamentally rethink how P&IDs are visualized** — moving from the traditional PDF sheet-based paradigm (where a system is fragmented across multiple drawings) to a **continuous, system-based, end-to-end line view** that shows complete systems with all their connections in a single interactive canvas. This system-level view is then **bidirectionally linked to a Three.js-based 3D model**, allowing engineers to click a system in 2D and see it highlighted in 3D, and vice versa. A rich **annotation layer** supports project-based, session-based, person-based, and date-based annotations that serve as formal records for planning, isolation certificates, and permits to work.

**No existing open-source or commercial product fully delivers this vision today.** This represents a genuine greenfield innovation opportunity. The closest analogues exist in fragments across:
- Commercial digital twin platforms (Bentley iTwin, Cintoo, AVEVA)
- Open-source 3D BIM viewers (xeokit, web-ifc/That Open Engine)
- Research papers on AI-driven P&ID digitization and graph-RAG for P&ID querying
- Infinite canvas libraries (React Flow, tldraw, JointJS)

---

## 2. Requirements Analysis

### 2.1 Core Requirements (Extracted from Vision Statement)

| # | Requirement | Priority | Category |
|---|-------------|----------|----------|
| R1 | **Continuous end-to-end linework** — Show complete system piping from source to destination without sheet boundaries | Critical | Visualization |
| R2 | **System-based view** — Organize by system (not by P&ID sheet) as the primary navigation paradigm | Critical | Visualization |
| R3 | **System interconnections** — Show how isolated systems connect to each other (cross-references become first-class connections) | Critical | Visualization |
| R4 | **Hierarchy navigation** — Build hierarchy: Platform → System → Lines → Equipment → Instruments within the continuous view | High | Navigation |
| R5 | **3D Model visualization** — Render 3D plant model in Three.js alongside the 2D system view | Critical | 3D Integration |
| R6 | **2D ↔ 3D linking** — Click a system/equipment in 2D → highlight in 3D model, and vice versa | Critical | 3D Integration |
| R7 | **Multi-dimensional annotations** — Annotations tagged with: project, session, person, date | Critical | Annotation |
| R8 | **Annotation as record** — Annotations serve as formal records (what was drawn, when, by whom) | High | Annotation |
| R9 | **Planning use case** — Annotations used for maintenance planning and scheduling | High | Operations |
| R10 | **Isolation/Permit to Work** — Annotations define isolation boundaries and permit zones, visible in both 2D and 3D | High | Operations |
| R11 | **Dual rendering** — Annotations visible in both 2D system view and 3D model simultaneously | High | Visualization |
| R12 | **AI integration** — AI assists during development, production use, and interaction with the model | Medium | AI |

### 2.2 Implied Requirements

| # | Requirement | Rationale |
|---|-------------|-----------|
| R13 | **Semantic data model** — P&ID elements must be stored as structured data (not just images) to enable system-based reassembly | Continuous view requires understanding of connectivity |
| R14 | **Tag-based identity** — Every element (valve, pipe segment, instrument) needs a unique tag that maps to both 2D and 3D representations | Bidirectional linking |
| R15 | **Real-time collaboration** — Multiple users annotating simultaneously | Planning and PTW workflows involve teams |
| R16 | **Versioning / audit trail** — Annotation history must be immutable for regulatory compliance | Permit to Work is a safety-critical record |
| R17 | **Offline capability** — Field engineers may need access without connectivity | Offshore platform reality |
| R18 | **Performance at scale** — Handle thousands of elements per system without degradation | Large platforms have 50+ systems with hundreds of elements each |

---

## 3. Current State Assessment

### 3.1 What AssetView Has Today

| Capability | Current State | Gap to Vision |
|------------|--------------|---------------|
| P&ID Viewing | 2D raster image + percentage-based hotspot overlays | Need structured vector/SVG representation for continuous reassembly |
| Navigation | Miller Columns (Systems → P&IDs → Lines → Equipment → Instruments) | Already system-first; needs spatial rather than tabular view |
| Cross-References | Tracked via `pnid_system` junction table (`is_primary` flag) | Cross-refs are shown at 65% opacity; need to become first-class connections |
| Data Model | Sophisticated M:N junctions: `pnid_system`, `pnid_line`, `pnid_equipment`, `pnid_instrument` | Strong foundation; needs line connectivity graph (from/to equipment) |
| 3D Integration | `model_3d_object_id` field exists on equipment table but is unused | Need Three.js viewer + tag mapping |
| Annotations | Position data stored in junction tables (annotation_x/y/w/h_pct) | Need multi-dimensional annotation model (project/session/person/date) |
| D3 Visualizations | Sunburst, Constellation Map, XrefNetwork (all SVG-based) | Strong D3 skills; can extend to system-based schematic |
| AI Assistant | Claude API integration with function calling | Foundation for AI-powered annotation and querying |

### 3.2 Data Model Strengths (Already in Place)

The existing data model **already separates ownership from appearance**:
```
Lines BELONG TO systems (1:N via system_id)     — ownership
Lines APPEAR ON P&IDs (M:N via pnid_line)       — display
```

This separation is the **exact foundation** needed for the system-based view. Today, lines are displayed per-P&ID sheet. The vision reassembles them per-system, using the `system_id` ownership relationship as the primary organizer and the `pnid_line` junction as metadata about which original drawing they came from.

The `from_equipment_tag` and `to_equipment_tag` fields on the `line` table already capture connectivity:
```sql
line.from_equipment_tag = 'PV019-XT'  -- line starts at Christmas Tree
line.to_equipment_tag   = 'CV-019S'   -- line ends at Choke Valve
```

This is the **topology graph** needed to render continuous end-to-end linework.

---

## 4. Architecture Vision

### 4.1 Conceptual Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AssetView Next                           │
│                                                                 │
│  ┌──────────────────────┐   ┌──────────────────────────────┐   │
│  │   2D System Canvas    │   │      3D Model Viewer         │   │
│  │   (Infinite Canvas)   │◄─►│      (Three.js/WebGL)        │   │
│  │                       │   │                              │   │
│  │  ┌─────┐   ┌─────┐  │   │  ┌──────────────────────┐   │   │
│  │  │Sys A│───│Sys B│  │   │  │   Plant 3D Model     │   │   │
│  │  │     │   │     │  │   │  │   (IFC/glTF/FBX)     │   │   │
│  │  │ ════╪═══╪═══  │  │   │  │   + Highlight Layer  │   │   │
│  │  │ Pipe│   │Pipe │  │   │  │   + Annotation Layer  │   │   │
│  │  └─────┘   └─────┘  │   │  └──────────────────────┘   │   │
│  │                       │   │                              │   │
│  │  [Annotation Layer]   │   │  [Annotation Layer]          │   │
│  └──────────────────────┘   └──────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Shared State Layer                      │  │
│  │  Selection │ Annotations │ Filters │ Isolation Zones      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                      AI Engine                             │  │
│  │  Graph-RAG │ Annotation Assist │ HAZOP │ PTW Validation   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Data Layer (PostgreSQL)                  │  │
│  │  Systems │ Lines │ Equipment │ Topology Graph │ Annotations│  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 System-Based Continuous View: How It Works

**Traditional (Sheet-Based):**
```
Sheet 15101 (Well PV019):
  XT → CV-019S → [continues on sheet 15501 →]

Sheet 15501 (Production Manifold):
  [← from sheet 15101] → PM-01 → [...continues on sheet 15601 →]
```

**New (System-Based Continuous):**
```
System: Production PV019 (end-to-end):
  XT ═══ CV-019S ═══ [connection to PM system] ═══ PM-01 ═══ ...
         │                                         │
    [CD system]                               [GL system]
    (shown as branch)                         (shown as branch)
```

The key transformation:
1. **Primary axis**: Follow the system's own lines from source to destination
2. **Branch points**: Where other systems connect (cross-references), show as branching connections
3. **Continuations**: Where a line crosses P&ID sheets, seamlessly join them (the `is_continuation` flag tells us where)
4. **Equipment nodes**: Render as interactive nodes at their position along the line
5. **Instruments**: Attach to their parent line/equipment as satellite elements

### 4.3 Topology Graph Data Model Extension

```sql
-- New: Line segment connectivity (extends existing from/to_equipment_tag)
CREATE TABLE line_segment (
    id UUID PRIMARY KEY,
    line_id UUID REFERENCES line(id),
    from_node_type VARCHAR(20),      -- 'equipment' | 'tee' | 'boundary' | 'nozzle'
    from_node_id UUID,               -- FK to equipment or new node table
    to_node_type VARCHAR(20),
    to_node_id UUID,
    segment_order INT,               -- ordering within line
    length_meters DECIMAL(10,2),
    elevation_change DECIMAL(10,2),
    bend_count INT,
    metadata JSONB
);

-- New: System connection points (where systems meet)
CREATE TABLE system_boundary (
    id UUID PRIMARY KEY,
    from_system_id UUID REFERENCES system(id),
    to_system_id UUID REFERENCES system(id),
    boundary_type VARCHAR(50),       -- 'tie-in' | 'battery_limit' | 'interface'
    from_line_id UUID REFERENCES line(id),
    to_line_id UUID REFERENCES line(id),
    from_equipment_id UUID REFERENCES equipment(id),
    to_equipment_id UUID REFERENCES equipment(id),
    description TEXT,
    metadata JSONB
);

-- New: Multi-dimensional annotation model
CREATE TABLE annotation (
    id UUID PRIMARY KEY,

    -- Scope dimensions
    project_id UUID,                 -- which project/campaign
    session_id UUID,                 -- which work session
    created_by UUID,                 -- who created it
    created_at TIMESTAMPTZ,          -- when

    -- What is annotated
    target_type VARCHAR(30),         -- 'line' | 'equipment' | 'instrument' | 'area' | 'boundary'
    target_id UUID,                  -- FK to target entity

    -- Annotation content
    annotation_type VARCHAR(50),     -- 'note' | 'isolation_point' | 'permit_zone' | 'hazard' | 'measurement' | 'markup'
    content TEXT,                    -- text content or structured JSON

    -- 2D position (on system canvas)
    canvas_x DECIMAL(10,2),
    canvas_y DECIMAL(10,2),
    canvas_geometry JSONB,           -- polygon/path for area annotations

    -- 3D position (in model space)
    model_x DECIMAL(10,4),
    model_y DECIMAL(10,4),
    model_z DECIMAL(10,4),
    model_geometry JSONB,            -- 3D volumes for isolation zones

    -- Status tracking
    status VARCHAR(30),              -- 'draft' | 'submitted' | 'approved' | 'closed'
    approved_by UUID,
    approved_at TIMESTAMPTZ,

    -- Metadata
    color VARCHAR(20),
    priority VARCHAR(20),
    tags TEXT[],
    metadata JSONB,

    deleted_at TIMESTAMPTZ
);

-- Annotation grouping (for isolation certificates, PTW)
CREATE TABLE annotation_group (
    id UUID PRIMARY KEY,
    group_type VARCHAR(50),          -- 'isolation_certificate' | 'permit_to_work' | 'inspection_plan'
    title VARCHAR(500),
    description TEXT,
    status VARCHAR(30),
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    created_by UUID,
    approved_by UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);

CREATE TABLE annotation_group_item (
    group_id UUID REFERENCES annotation_group(id),
    annotation_id UUID REFERENCES annotation(id),
    item_order INT,
    PRIMARY KEY (group_id, annotation_id)
);
```

### 4.4 Tag-Based 2D ↔ 3D Mapping

The bidirectional link between 2D and 3D relies on a **shared tag namespace**:

```
Equipment Tag: "CV-019S" (Choke Valve)
  ├── 2D System Canvas: SVG node at layout position
  ├── 3D Model: mesh object with userData.tag = "CV-019S"
  └── Database: equipment.tag = "CV-019S", equipment.model_3d_object_id = "mesh_cv019s"
```

The `model_3d_object_id` field already exists in the database schema. When a user clicks an element in either view:

1. **2D → 3D**: Read `model_3d_object_id` from equipment record → find Three.js mesh → apply highlight material → fly camera to object
2. **3D → 2D**: Read `userData.tag` from clicked mesh → find equipment by tag → scroll/zoom 2D canvas to that node → highlight

---

## 5. Open-Source Libraries & Tools

### 5.1 2D Continuous Canvas (System-Based P&ID View)

| Library | License | Stars | Best For | Limitations |
|---------|---------|-------|----------|-------------|
| **[React Flow (xyflow)](https://reactflow.dev/)** | MIT | 26k+ | Node-based infinite canvas with React components as nodes. Drag, zoom, pan, connect built-in. | No native P&ID symbols; must create custom node types |
| **[JointJS](https://www.jointjs.com/)** | MPL 2.0 | 4k+ | SVG-based diagramming with [SCADA/P&ID demo](https://www.jointjs.com/demos/scada). Foreign objects in SVG for HTML-in-diagram. | Advanced features (JointJS+) are commercial |
| **[tldraw SDK](https://tldraw.dev/)** | Apache 2.0 | 38k+ | Infinite canvas with multiplayer sync, custom shapes, undo/redo, TypeScript/React. | General-purpose; no engineering domain primitives |
| **[D3.js](https://d3js.org/)** | ISC | 109k+ | Low-level SVG rendering, force-directed layouts, custom graph rendering. Already used in AssetView. | No built-in canvas framework; everything is manual |
| **[Cytoscape.js](https://js.cytoscape.org/)** | MIT | 10k+ | Graph visualization with layout algorithms (hierarchical, force-directed, circular). Graph theory algorithms built-in. | Not designed for engineering diagrams |
| **[Flowscape UI](https://github.com/Flowscape-UI/canvas-react)** | MIT | New | High-performance React infinite canvas with plugin architecture. | Early-stage project |

**Recommendation**: **React Flow** as the primary canvas engine. It provides the infinite canvas, node/edge paradigm, pan/zoom, and minimap out of the box. Custom React components serve as P&ID nodes (equipment, instruments), and custom edges serve as pipe segments. The existing D3.js skills in the team can be leveraged for layout algorithms within the React Flow framework.

### 5.2 3D Model Rendering

| Library | License | Best For | Limitations |
|---------|---------|----------|-------------|
| **[Three.js](https://threejs.org/)** | MIT | General-purpose WebGL 3D rendering. Massive ecosystem, loaders for glTF, FBX, OBJ, IFC. | Low-level; need to build viewer features yourself |
| **[xeokit SDK](https://xeokit.io/)** | AGPL v3 | Purpose-built for BIM/AEC. Loads IFC, glTF, point clouds. Double-precision for global coordinates. Object picking, sectioning, annotations. | AGPL license requires open-sourcing your app (or commercial license) |
| **[web-ifc / That Open Engine](https://github.com/ThatOpen/web-ifc-viewer)** | MIT | IFC file loading + Three.js rendering. Sectioning, dimensions, plan navigation. | Focused on BIM/building models; plant models may need custom handling |
| **[Online3DViewer](https://github.com/kovacsv/Online3DViewer)** | MIT | Multi-format viewer (3dm, 3ds, fbx, gltf, ifc, step, stl, obj). | Viewer only; no annotation or selection API |
| **[vA3C](http://va3c.github.io/)** | MIT | Three.js-based AEC viewer, designed as a foundation for forking. | Small project, limited maintenance |
| **[Google model-viewer](https://github.com/google/model-viewer)** | Apache 2.0 | Simple web component for 3D models. AR support. | Too simple for engineering use; no object-level interaction |

**Recommendation**: **Three.js** as the core renderer (MIT license, maximum flexibility), with **web-ifc** as the IFC loader if plant models are in IFC format. If the 3D models come from AVEVA, SmartPlant, or similar tools in formats like RVM, FBX, or glTF, Three.js loaders handle these directly. For a faster start with BIM-specific features, **xeokit** is excellent but the AGPL license must be evaluated.

### 5.3 Data Exchange Standards

| Standard | Description | Relevance |
|----------|-------------|-----------|
| **[DEXPI](https://dexpi.org/specifications/)** | Data Exchange in Process Industry. Open standard for P&ID data based on ISO 15926. XML/JSON format. Creative Commons licensed. | **Critical**: Defines the semantic model for P&ID elements. Use DEXPI as the canonical data model for the system-based view. |
| **[ISO 15926](https://en.wikipedia.org/wiki/ISO_15926)** | Lifecycle integration for process plants. Reference data library (RDL) for equipment types, properties. | Foundation standard underlying DEXPI. |
| **[IFC (ISO 16739)](https://www.buildingsmart.org/standards/bsi-standards/industry-foundation-classes/)** | Industry Foundation Classes. Open BIM format for 3D models. Supported by xeokit, web-ifc. | Use if 3D models are in IFC format. |
| **[OPC UA + DEXPI](https://reference.opcfoundation.org/DEXPI/v100/docs/1)** | OPC UA companion specification for DEXPI. Enables live data streaming to P&ID elements. | For real-time sensor data overlay on the continuous view. |
| **[glTF 2.0](https://www.khronos.org/gltf/)** | Open standard for 3D model transmission. Supported by all Three.js-based tools. | Preferred 3D format for web delivery. Convert from native formats to glTF. |

### 5.4 Annotation & Collaboration

| Library | License | Use Case |
|---------|---------|----------|
| **[Yjs](https://yjs.dev/)** | MIT | CRDT-based real-time collaboration. Powers multiplayer in tldraw, React Flow, and many others. |
| **[Liveblocks](https://liveblocks.io/)** | Commercial (free tier) | Ready-made collaboration infrastructure. Comments, presence, history. |
| **[Socket.IO](https://socket.io/)** | MIT | WebSocket abstraction. Already planned for AssetView (fastify-websocket). |

---

## 6. Academic Research & State of the Art

### 6.1 AI-Driven P&ID Recognition & Digitization

| Paper | Year | Key Contribution |
|-------|------|------------------|
| [Using AI to Support Drawing of P&IDs Using DEXPI Standard](https://www.sciencedirect.com/science/article/pii/S2772508122000291) | 2022 | RNN and GNN trained on DEXPI data to recognize reusable patterns in P&IDs, reducing manual drawing time |
| [Image Format P&ID Recognition Based on Deep Learning](https://www.sciencedirect.com/science/article/pii/S2667379723000566) | 2023 | Deep neural networks for symbol/text/pipeline recognition in raster P&IDs. Dataset: 51 PDF P&IDs from CNOOC |
| [Features Recognition from P&IDs Using Deep Learning](https://www.mdpi.com/1996-1073/12/23/4425) | 2019 | CNN-based preprocessing + feature recognition pipeline for image-format P&IDs |
| [Optimizing P&ID Recognition: Symbol and Text with Single Backbone](https://academic.oup.com/jcde/article/12/6/55/8156798) | 2025 | End-to-end architecture achieving 97.6% precision / 95.2% recall on 82 symbol classes across 20 industrial P&IDs |
| [Digitize-PID (TCS Research)](https://www.tcs.com/what-we-do/research/article/digitize-pid-piping-instrumentation-diagrams) | 2023 | End-to-end pipeline: kernel-based line detection + deep symbol recognition. Provides 500-P&ID synthetic dataset |
| [Automatic Information Extraction from P&IDs](https://www.scitepress.org/Papers/2019/73764/73764.pdf) | 2019 | Tree-like data structure extraction from P&IDs for flow determination. CV + DL hybrid approach |
| [Microsoft ISE P&ID Digitization](https://devblogs.microsoft.com/ise/engineering-document-pid-digitization/) | 2024 | Azure ML + YOLOv2 for symbol detection. Knowledge graph representation. [GitHub repo](https://github.com/Azure-Samples/digitization-of-piping-and-instrument-diagrams) |

### 6.2 LLM + P&ID Integration (Cutting Edge)

| Paper/Tool | Year | Key Contribution |
|------------|------|------------------|
| [Talking like P&IDs — Graph-RAG for P&ID Understanding](https://arxiv.org/html/2502.18928v1) | 2025 | P&IDs as labeled property graphs via DEXPI → integrated with LLMs using graph-RAG. Natural language querying. Mitigates hallucinations. Enables AI-assisted HAZOP |
| [Agentic P&ID Generation from Natural Language](https://arxiv.org/html/2412.12898v1) | 2024 | Multi-step agentic LLM workflow to auto-generate P&IDs from natural language descriptions. Iterative error correction |
| [LLM-CodeGen-Image (GitHub)](https://github.com/hkoziolek/LLM-CodeGen-Image) | 2024 | GPT-4V generating control logic from P&ID images. Chat-based interaction with diagrams |
| [VIKTOR.AI P&ID Analysis](https://www.viktor.ai/blog/202/talk-to-your-drawings-automate-p-and-id-and-single-line-diagram-analysis-with-ai) | 2025 | GPT-4o Mini for Q&A + Gemini 2.5 Pro for object detection on P&IDs. Open source on GitHub |
| [SymphonyAI P&ID Ingestion](https://www.symphonyai.com/industrial/piping-instrumentation-diagrams-ingestion/) | 2025 | ML + Vision AI for P&ID recognition → knowledge graph → integration with LLMs for operational intelligence |

### 6.3 Digital Twin Research

| Paper | Year | Key Contribution |
|-------|------|------------------|
| [Tools, Technologies and Frameworks for Digital Twins in Oil & Gas](https://pmc.ncbi.nlm.nih.gov/articles/PMC11479326/) | 2024 | Comprehensive survey of digital twin technologies for O&G. Covers 3D visualization, IoT integration, predictive maintenance |
| [Digital Twin Frameworks for Oil & Gas Processing Plants](https://www.mdpi.com/2227-9717/13/11/3488) | 2025 | Literature review of DT frameworks. Identifies visualization + annotation as key gap |
| [Linking 2D P&ID to 3D Environment](https://ips-ai.com/resource-centre/blogs/linking-2d-information-from-pid-to-a-3d-environment-the-backbone-of-digitalization-and-digital-twins/) | 2024 | IPS-AI article on tag-based linking as backbone of digitalization |

---

## 7. AI Integration Opportunities

### 7.1 During Development

| AI Application | How | Tools |
|----------------|-----|-------|
| **P&ID Digitization** | Convert existing PDF/raster P&IDs into structured DEXPI data using computer vision + OCR | YOLOv8/YOLOv11 for symbol detection, Tesseract/Azure OCR for text, custom pipeline for topology extraction |
| **3D Model Tag Mapping** | Auto-match equipment tags between 2D data model and 3D model mesh names | LLM fuzzy matching (Claude), string similarity algorithms |
| **Layout Generation** | Auto-generate 2D system canvas layouts from the topology graph | Force-directed (D3), hierarchical (Dagre), or LLM-assisted layout optimization |
| **Test Data Generation** | Generate realistic P&ID scenarios for testing | Claude API with function calling |
| **Code Generation** | Generate React Flow custom nodes, Three.js shaders, SQL queries | Claude Code / Copilot |

### 7.2 During Production (Runtime AI)

| AI Application | How | Value |
|----------------|-----|-------|
| **Natural Language P&ID Querying** | "Show me all high-pressure lines in the production system" → filters + highlights | Uses Graph-RAG (per "Talking like P&IDs" paper). System topology stored as knowledge graph. Claude API with function calling |
| **Annotation Assistance** | "Create an isolation boundary around CV-019S" → AI identifies upstream/downstream valves, proposes isolation points | Claude analyzes topology graph, identifies nearest block valves, generates annotation set |
| **HAZOP Assistance** | "What happens if PT-01901 fails high?" → AI traces cause-effect through the system graph | Graph traversal + Claude reasoning over process knowledge |
| **Permit to Work Validation** | "Can I issue a hot work permit at this location?" → AI checks for conflicts with existing isolations, simultaneous operations | Spatial + temporal conflict detection. Rules engine + LLM fallback for edge cases |
| **Anomaly Detection** | Compare current sensor readings (via OPC UA) against design parameters shown in P&ID | Real-time data overlay + threshold alerting + LLM-powered root cause analysis |
| **Documentation Generation** | Auto-generate isolation certificates, work plans, inspection reports from annotation data | Claude API generates structured documents from annotation groups |

### 7.3 With the Model (3D AI)

| AI Application | How | Value |
|----------------|-----|-------|
| **Spatial Reasoning** | "What equipment is within 5 meters of this hot work zone?" → 3D spatial query | Three.js raycasting + bounding box queries |
| **Access Route Planning** | "Show me the safest route to reach instrument PT-01901" → 3D pathfinding | A* pathfinding on walkway mesh + hazard zone avoidance |
| **Visual Inspection Assistance** | Overlay drone/camera imagery on 3D model, highlight corrosion areas | Computer vision + 3D texture mapping |
| **Change Detection** | Compare as-built scan (point cloud) with design model | Point cloud alignment + difference highlighting |

---

## 8. Annotation System Design

### 8.1 Annotation Dimensions

```
                    ┌─────────────┐
                    │  Annotation  │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
     ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
     │  Identity   │  │   Scope    │  │  Content   │
     └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
           │               │               │
     WHO created it   PROJECT context   WHAT type
     WHEN created     SESSION context   WHERE (2D+3D)
     WHY (purpose)    VALIDITY period   HOW (geometry)
```

### 8.2 Annotation Types

| Type | Use Case | Rendering |
|------|----------|-----------|
| **Note** | General comment on any element | Text bubble with pointer |
| **Markup** | Freehand drawing / highlight over P&ID area | SVG path overlay |
| **Isolation Point** | Tagged valve/blind identified as isolation boundary | Red diamond icon + valve tag |
| **Permit Zone** | Area covered by a work permit | Colored polygon boundary (2D) + translucent volume (3D) |
| **Hazard Zone** | Area with specific hazard classification | Hatched polygon with hazard icon |
| **Measurement** | Distance/elevation annotation | Dimension line with value |
| **Defect** | Identified corrosion, leak, damage | Pin with severity color |
| **Planning** | Planned modification, future connection | Dashed lines, ghost elements |

### 8.3 Annotation Lifecycle

```
DRAFT ──→ SUBMITTED ──→ APPROVED ──→ ACTIVE ──→ CLOSED
  │            │             │           │          │
  │ Author     │ Reviewer    │ Authority │ Expiry   │ Archive
  │ edits      │ comments    │ signs     │ or       │ immutable
  │ freely     │ requests    │ off       │ manual   │ record
  │            │ changes     │           │ close    │
  └──← REJECTED ←──┘             └──← EXTENDED ←──┘
```

### 8.4 Dual Rendering (2D + 3D)

Every annotation stores **both** 2D canvas coordinates and 3D model coordinates:

- **2D**: SVG overlay on the system canvas (React Flow custom edges/nodes)
- **3D**: Three.js sprites/meshes/volumes at corresponding world positions

When an annotation is created in one view, it's automatically positioned in the other:
- Create in 2D → use equipment's `model_3d_object_id` to find 3D position → place 3D annotation at equipment centroid
- Create in 3D → use clicked mesh's `userData.tag` to find 2D node → place 2D annotation at node position

---

## 9. Operational Use Cases

### 9.1 Isolation Certificate Workflow

```
1. Operator opens System "Production PV019" in continuous view
2. Selects "Create Isolation" tool
3. Clicks equipment "CV-019S" (Choke Valve) as the work target
4. AI suggests isolation points:
   - Upstream: Block valve BV-019A (close + tag)
   - Downstream: Block valve BV-019B (close + tag)
   - Drain point: DV-019C (open for depressurization)
   - Vent: VV-019D (open for purging)
5. Operator confirms/adjusts isolation boundary
6. System creates annotation_group (type: 'isolation_certificate')
7. Individual annotations mark each isolation point (type: 'isolation_point')
8. In 3D view: isolation boundary rendered as translucent red volume
9. In 2D view: isolation boundary shown as dashed polygon with tagged points
10. Certificate submitted for approval → approved by authorized signatory
11. Certificate visible to all users as active annotation group
12. On completion: operator closes certificate → annotations archived as record
```

### 9.2 Permit to Work

```
1. Supervisor opens area view in 3D
2. Selects "Create Permit Zone" tool
3. Draws polygon around work area
4. AI checks for conflicts:
   - Existing active permits in overlapping area
   - Active isolations that may be affected
   - Simultaneous operations (SIMOPS) restrictions
5. AI suggests required precautions based on work type
6. Permit linked to isolation certificates (annotation_group references)
7. Permit zone visible in both 2D and 3D with validity period
8. Real-time: other users see the permit zone as they navigate
```

### 9.3 Maintenance Planning

```
1. Planner opens System "Gas Lift Distribution"
2. Reviews upcoming inspections (next_inspection dates on equipment)
3. Creates planning annotations:
   - Mark equipment for inspection
   - Note access requirements
   - Link to work orders
4. Planning session saved with session_id + person_id + date
5. Annotations visible with "Planning" filter toggle
6. Over time: multiple planning sessions build up a visual history
7. Approved plans become formal work packages
```

---

## 10. Implementation Roadmap

### Phase 1: System Topology Engine (Months 1-2)
- Extend data model with `line_segment` and `system_boundary` tables
- Build topology graph builder from existing `line.from_equipment_tag` / `to_equipment_tag`
- Create API endpoints for system-level topology queries
- Prototype automatic layout using Dagre (hierarchical) or ELK (layered)

### Phase 2: Continuous 2D Canvas (Months 2-4)
- Integrate React Flow as the infinite canvas engine
- Create custom node types: Equipment, Instrument, Tee, SystemBoundary
- Create custom edge types: PipeSegment (with size/class rendering)
- Implement system-based layout algorithm
- Add cross-system connection rendering (branch points)
- Minimap, zoom controls, fit-to-system button
- Migrate existing Miller Columns to work alongside (or as navigation for) the canvas

### Phase 3: 3D Model Viewer (Months 3-5)
- Integrate Three.js viewer component (split-pane with 2D canvas)
- Build model loader (glTF preferred, IFC via web-ifc if needed)
- Implement tag-based object picking (click mesh → get tag → highlight)
- Build 2D ↔ 3D selection synchronization via shared state
- Camera fly-to on selection
- Sectioning planes for interior views
- System-level highlighting (all meshes in a system → highlight color)

### Phase 4: Annotation System (Months 4-6)
- Implement annotation data model (tables from Section 4.3)
- Build annotation tools: note, markup, isolation point, permit zone
- Render annotations in both 2D (SVG overlay) and 3D (Three.js sprites)
- Build annotation panel: filters by project/session/person/date
- Implement annotation lifecycle (draft → approved → closed)
- Real-time sync via WebSocket (Yjs or Socket.IO)

### Phase 5: Operational Workflows (Months 6-8)
- Isolation certificate workflow (annotation groups + approval flow)
- Permit to work workflow with spatial conflict detection
- Maintenance planning session management
- Audit trail and compliance reporting
- PDF/document generation from annotation groups

### Phase 6: AI Integration (Months 5-9, parallel)
- Graph-RAG: Store system topology as knowledge graph, integrate with Claude
- Natural language querying: "Show me all safety valves on PV019"
- Isolation assistant: AI suggests isolation points from topology
- HAZOP assistant: cause-effect tracing through system graph
- PTW conflict detection: spatial + temporal analysis

### Phase 7: P&ID Digitization (Optional, Months 8-12)
- Train YOLO model on P&ID symbol library (using TCS Digitize-PID dataset as starting point)
- OCR pipeline for text extraction
- Topology inference from recognized symbols + connections
- Semi-automatic import: AI proposes → engineer validates → system learns

---

## 11. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 3D model format incompatibility | High | Medium | Support multiple formats (glTF, IFC, FBX). Build conversion pipeline. Test with actual project models early. |
| Layout quality for complex systems | High | High | Start with manual layout capability. Auto-layout as enhancement. Allow users to save custom layouts per system. |
| Performance with large systems | High | Medium | React Flow handles 1000+ nodes. Three.js handles 100k+ meshes with LOD. Implement progressive loading. |
| Annotation data integrity | Critical | Low | Append-only annotation history. Soft deletes only. Database-level constraints. Audit logging. |
| AGPL license contamination (if using xeokit) | Medium | Medium | Use Three.js (MIT) instead. Or evaluate xeokit commercial license. |
| Data migration from existing P&IDs | Medium | High | Build semi-automatic digitization pipeline. Accept manual entry initially. |
| Regulatory acceptance of digital isolation certificates | Critical | Medium | Work with HSE/safety teams early. Ensure audit trail meets regulatory requirements. Consider dual (digital + paper) during transition. |
| Offline use on platforms | High | High | Service Worker + IndexedDB for offline canvas. Sync on reconnect. WebRTC for local collaboration. |

---

## 12. Reusable Research Prompt

The following prompt can be pasted into other AI models (GPT-4, Gemini, Mistral, etc.) for further research:

---

```
I am building a next-generation engineering visualization platform for oil & gas offshore platforms. I need your help with detailed research and technical recommendations.

## Context

Currently, Piping & Instrumentation Diagrams (P&IDs) are viewed as static PDF sheets. Each sheet shows a fragment of a system, and engineers must mentally stitch together 10-20 sheets to understand a complete system. Cross-references between sheets are noted with "continues on sheet X" callouts but there is no visual continuity.

## Vision

I want to build a system that:

1. **Replaces sheet-based P&ID viewing with a continuous, system-based view**: Instead of showing individual P&ID sheets, render the complete system's piping as an interactive graph on an infinite 2D canvas. Equipment appears as nodes, pipe segments as edges, and instruments as satellite elements on their parent lines. The user can see an entire system (e.g., "Production Well PV019") end-to-end in a single scrollable/zoomable view.

2. **Shows inter-system connections**: Where systems connect (e.g., a Closed Drain line that branches off a Production line), show these as branch connections from the primary system view. Cross-references become first-class visual connections rather than text callouts.

3. **Integrates a 3D model viewer**: The 2D system view is displayed alongside a Three.js WebGL 3D model of the physical plant. Clicking an equipment item in 2D highlights it in 3D and flies the camera to it, and vice versa. The link is tag-based (e.g., equipment tag "CV-019S" maps to a 3D mesh).

4. **Provides a rich annotation system with multiple dimensions**: Annotations are tagged with:
   - **Project**: Which project or campaign the annotation belongs to
   - **Session**: Which work session created it (for grouping related annotations)
   - **Person**: Who created it (with role-based permissions)
   - **Date/Time**: When it was created (immutable timestamp for records)
   - **Type**: Note, markup, isolation point, permit zone, hazard area, defect, planning marker

   Annotations serve dual purposes: informal communication AND formal safety records (isolation certificates, permits to work).

5. **Supports operational workflows**:
   - **Isolation Certificates**: Define isolation boundaries by marking block valves, drain points, vent points as annotation groups. AI assists by analyzing the topology graph and suggesting isolation points.
   - **Permit to Work**: Define permit zones as spatial polygons visible in both 2D and 3D. System checks for conflicts with existing permits and operations.
   - **Maintenance Planning**: Use annotations to plan inspection campaigns, mark equipment for attention, create work packages.

6. **Annotations render in both 2D and 3D**: An isolation boundary drawn on the 2D system canvas simultaneously appears as a translucent volume in the 3D model, and vice versa.

7. **AI integration throughout**:
   - **Development**: AI assists in digitizing existing PDF P&IDs into structured data, mapping tags between 2D data and 3D models, generating layouts
   - **Production**: Natural language querying ("show me all high-pressure safety valves"), annotation assistance, HAZOP support, permit conflict detection
   - **With the model**: Spatial reasoning, access route planning, change detection (scan vs. design comparison)

## My Technology Stack
- Frontend: React 18, Vite, Tailwind CSS
- 3D: Three.js (WebGL)
- Backend: Node.js, Fastify, Prisma ORM
- Database: PostgreSQL (with JSONB, trigram search, UUID)
- AI: Anthropic Claude API (function calling)
- Existing visualizations: D3.js (SVG-based)
- Candidate 2D canvas: React Flow (xyflow), JointJS, or tldraw

## Data Model (existing)
- Systems belong to Platforms (1:N)
- Lines belong to Systems (1:N ownership)
- Lines appear on P&IDs (M:N via junction table, with `is_continuation` flag)
- Equipment belongs to Systems, optionally on a Line
- Instruments belong to Systems, on a Line
- P&IDs reference multiple Systems (M:N, with `is_primary` flag)
- Lines have `from_equipment_tag` and `to_equipment_tag` for connectivity

## What I Need From You

Please provide detailed research and recommendations on:

1. **System-based continuous P&ID rendering**: Best approaches, layout algorithms (hierarchical, force-directed, orthogonal), how to handle large systems (1000+ elements), how to represent branching and cross-system connections. Any existing implementations or papers?

2. **2D ↔ 3D bidirectional linking**: Best practices for tag-based synchronization between a 2D graph canvas and a Three.js 3D model. How do commercial tools (AVEVA, Bentley, Hexagon) implement this? Performance considerations for large models (100k+ meshes).

3. **Annotation system architecture**: How to design a multi-dimensional annotation system that serves both informal collaboration and formal safety records (isolation certificates, PTW). Data model, rendering in dual views, lifecycle management, versioning, audit trail. Any standards (ISO, OSHA, API) for digital isolation certificates?

4. **AI integration points**: Specific LLM/ML applications for:
   - Topology-aware querying (Graph-RAG approaches)
   - Automated isolation point suggestion from system topology
   - P&ID digitization (converting PDF/raster to structured data)
   - HAZOP assistance using system connectivity data
   - Spatial conflict detection for permits

5. **Open-source libraries and tools**: For each component, recommend specific open-source libraries with license, maturity, and integration guidance. Especially for: infinite canvas (React Flow vs JointJS vs tldraw), 3D model loading (IFC, glTF, RVM), real-time collaboration (Yjs, CRDT-based), and graph layout algorithms.

6. **Standards and interoperability**: DEXPI, ISO 15926, IFC, OPC UA — how do these standards apply to this vision? Which should we adopt and how?

7. **Research papers**: Academic work on continuous/system-based P&ID visualization, AI-assisted engineering diagram understanding, digital twin annotation systems, and smart permit-to-work systems.

8. **Commercial landscape**: What commercial products come closest to this vision? What are their limitations? Where is the market gap that this system would fill?

9. **Implementation risks and challenges**: Technical challenges, data challenges, regulatory challenges, and adoption challenges. How to mitigate each.

10. **Phased implementation roadmap**: How to build this incrementally, delivering value at each phase, with the most critical/risky components addressed first.
```

---

*End of study document*
