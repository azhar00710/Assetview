# Study: How Commercial Intelligent P&ID Tools Create Diagrams

**Project:** AssetView — GeoSoft
**Date:** 2026-03-13
**Purpose:** Understand whether AVEVA, SmartPlant, and Bentley create P&IDs sheet-by-sheet or as a continuous system model — and what this means for AssetView's approach.

---

## TL;DR — The Answer

**Every commercial tool today still creates P&IDs sheet-by-sheet. None of them offer a continuous system-level view.**

But there's a critical nuance: the *data* lives in a central database, and sheets are "intelligent views" into that database. The sheet is the authoring interface AND the viewing interface — they haven't separated those concerns.

```
                    THE CURRENT STATE OF THE ART
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│   │  Sheet 001   │    │  Sheet 002   │    │  Sheet 003   │    │
│   │  (Drawing)   │    │  (Drawing)   │    │  (Drawing)   │    │
│   │   ┌─┐  ┌─┐  │    │  ┌─┐  ┌─┐  │    │  ┌─┐  ┌─┐  │    │
│   │   │V│──│P│──OPC──OPC│T│──│H│──OPC──OPC│S│──│E│  │    │
│   │   └─┘  └─┘  │    │  └─┘  └─┘  │    │  └─┘  └─┘  │    │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘    │
│          │                   │                   │            │
│          └───────────────────┴───────────────────┘            │
│                              │                                │
│                    ┌─────────┴─────────┐                     │
│                    │  Central Database  │                     │
│                    │  (The "Model")     │                     │
│                    │  Tags, Lines, Equip│                     │
│                    └───────────────────┘                     │
│                                                              │
│   Engineer creates Sheet 001, then Sheet 002, etc.           │
│   Off-Page Connectors (OPCs) link sheets together.           │
│   Database stores the real data; sheets are "smart views."   │
└──────────────────────────────────────────────────────────────┘
```

```
                    WHAT ASSETVIEW WILL DO (UNIQUE)
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ┌──────────────────────────────────────────────────────┐  │
│   │              Continuous System Canvas                  │  │
│   │                                                        │  │
│   │  XT ──── CV-019S ──── FT ──── SDV ──── Manifold      │  │
│   │   │                    │                    │          │  │
│   │   └── PSV             PT                  ──┼── [CD]  │  │
│   │                                             │          │  │
│   │  (Semantic zoom: zoom out = collapsed,      │          │  │
│   │   zoom in = full instrument detail)         │          │  │
│   │                                    [Gateway: CD-001]   │  │
│   └──────────────────────────────────────────────────────┘  │
│                              │                                │
│                    ┌─────────┴─────────┐                     │
│                    │  Topology Graph    │                     │
│                    │  (The "Model")     │                     │
│                    │  Same DB, but      │                     │
│                    │  graph-queryable   │                     │
│                    └───────────────────┘                     │
│                                                              │
│   No sheets. No OPCs. One infinite canvas per system.        │
│   Cross-system links shown as gateway nodes.                 │
│   "Export as Sheet" for traditional deliverable generation.  │
└──────────────────────────────────────────────────────────────┘
```

---

## 1. AVEVA P&ID / AVEVA Diagrams

### How It Works

AVEVA offers **two products**: AVEVA P&ID (heavyweight, AutoCAD-based) and AVEVA Diagrams (lightweight, web-ready). Both are **sheet-based with database backing**.

**Creation workflow:**
1. Engineer opens a **new drawing** (a sheet, typically A1/A3 size)
2. Drags intelligent symbols from a library onto the sheet (equipment, valves, instruments)
3. Connects them with intelligent pipe runs
4. Each symbol placement creates a **database record** in AVEVA's proprietary "Dabacon" database
5. Engineer fills in tag numbers, attributes, pipe specs
6. When a line leaves the sheet boundary, an **Off-Page Connector** is placed
7. Next sheet is opened, matching OPC placed, database links them
8. Repeat for all sheets

**The "intelligent" part:**
- Every graphical symbol is backed by a database object with metadata (tag, material, rating, service)
- Rules engine validates: correct pipe class, proper valve placement, spec compliance
- Reports (line lists, valve lists, equipment lists) auto-generate from the database
- Cross-discipline links: P&ID data feeds into AVEVA E3D (3D design), AVEVA Instrumentation

**What it does NOT do:**
- No continuous view across sheets
- No system-level layout — each sheet is an independent canvas
- Engineer must mentally decide which equipment goes on which sheet
- No auto-generation of sheets from a model (the sheet IS the authoring tool)

### AVEVA's Next Generation ("Carnet" / Unified Engineering)

AVEVA is building a **next-generation P&ID environment** (previewed at AVEVA World 2023-2024):
- Moves to cloud (AVEVA Connect)
- Single "Dabacon" project database shared across all disciplines
- Multi-discipline: P&ID + electrical + instrumentation in one environment
- **Still sheet-based** for authoring — but sheets now live in a shared cloud database
- Focus is on discipline integration, not on reimagining the sheet paradigm

**Key quote:** "Engineers and designers can work seamlessly from a single project database, creating an environment that forms the foundation of their digital twin."

> **Verdict:** AVEVA's evolution is about *unifying disciplines around one database*. They have NOT challenged the fundamental sheet-by-sheet authoring paradigm. This is exactly the gap AssetView targets.

### Sources
- [AVEVA P&ID Datasheet (PDF)](https://www.aveva.com/content/dam/aveva/documents/datasheets/Datasheet_AVEVA_P-and-IDandDiagrams.pdf.coredownload.inline.pdf)
- [AVEVA Unified Engineering](https://www.aveva.com/en/products/pid-and-diagrams/)
- [AVEVA Next-Gen Schematics Blog](https://www.aveva.com/en/perspectives/blog/our-next-generation-holistic-approach-to-engineering-and-design-schematic-tools/)
- [AVEVA Carnet Presentation (2023)](https://cdn.osisoft.com/osi/presentations/2023-AVEVA-San-Francisco/UC23NA-2ENU08-AVEVA-Carnet-An-introduction-to-the-next-generation-PandID-tool.pdf)
- [AVEVA P&ID Explained](https://www.multisoftsystems.com/blog/aveva-pid-explained-features-benefits-and-real-world-use-cases)

---

## 2. SmartPlant P&ID (Hexagon, now "Facets P&ID")

### How It Works

SmartPlant P&ID (SPPID) is the **most widely deployed intelligent P&ID tool** in the oil & gas industry. It is fundamentally **sheet-based with a centralized relational database**.

**Creation workflow:**
1. Project administrator configures: plant structure, line classes, symbol libraries, rules
2. Engineer creates a **new drawing** (sheet)
3. Places intelligent symbols (equipment, pipes, valves, instruments) on the sheet
4. Each placement creates a **row in the SQL Server/Oracle database**
5. Engineer draws pipe runs — the system tracks "From" and "To" (flow direction matters)
6. When a line exits a sheet: **Off-Page Connector (OPC)** is placed
7. System auto-generates a "partner OPC" that must be placed on the destination sheet
8. OPCs are the **data bridge** between sheets — they enable To/From automation for line lists

**The database architecture:**
- Centralized relational database (SQL Server or Oracle)
- Every graphical element maps to a database record
- The database IS the "plant model" — but it's populated through sheet-by-sheet drawing
- There is **no concept of building a model first, then generating sheets**
- Reports, line lists, valve lists, equipment lists are all database queries

**Off-Page Connectors — the critical pain point:**
OPCs are described by practitioners as *"the hardest concept to grasp in SPPID."* They are:
- Data flags that link pipe runs between two drawings
- If mishandled, they break the "To/From" data for line lists
- On large projects with multiple drafting sites, **managing OPCs is almost a full-time job**
- Every project must establish its own OPC rules

> This is exactly the problem our continuous canvas eliminates. No sheets = no OPCs = no OPC management overhead.

**Integration:**
- SmartPlant Engineering Manager (SEM) manages plant breakdown structure
- Data publishes to SmartPlant 3D (SP3D), SmartPlant Instrumentation (SPI)
- SmartPlant Foundation acts as data warehouse for cross-tool integration

### Hexagon Facets P&ID (Rebrand)

Hexagon recently spun off "Octave" as an independent brand. Facets P&ID is the rebranded SmartPlant P&ID. Core functionality unchanged — still sheet-based, database-backed.

### Sources
- [SmartPlant P&ID User Tips & Tricks](https://smartprocessdesign.com/intergraph-smartplant-pid-user-tips-tricks-speed/)
- [OPC Management Article (LinkedIn)](https://www.linkedin.com/pulse/off-page-connector-avoiding-mess-allan-van-horn)
- [Hexagon Facets P&ID](https://hexagon.com/products/intergraph-smart-p-id)
- [SmartPlant P&ID Product Sheet](https://pdf.archiexpo.com/pdf/intergraph/smartplant-p-id-product-sheet/103536-146595.html)
- [SPPID Guide](https://www.multisoftsystems.com/blog/sppid-a-comprehensive-guide-to-intelligent-piping-and-instrumentation-design)

---

## 3. Bentley OpenPlant PID

### How It Works

Bentley's approach is the most **standards-forward** of the three, built on **ISO 15926** as its native data model. But it is still **sheet-based for authoring**.

**Creation workflow:**
1. Engineer opens a new drawing in MicroStation-based environment
2. Places "Intelligent Cells" — symbols that carry ISO 15926 data
3. Each cell has: tag, functional class, attributes, connections
4. Data stored in the ISO 15926 schema (not a proprietary format)
5. Rules engine validates design against configurable standards
6. Sheets are the authoring interface

**What makes Bentley different:**
- **ISO 15926 native data model**: First P&ID tool built on an open standard, not a proprietary schema
- **Unique Tag Identification**: Objects have UUIDs independent of tag numbers — so other apps can import, modify, and sync back even if tags change
- **OWL import/export**: Interoperability with any ISO 15926-mapped application via iRING
- **PlantSight integration**: When connected to Bentley iTwin Services, creates a digital twin

**OpenPlant PID ↔ OpenPlant Modeler (3D):**
- Both share the ISO 15926 data model
- Equipment placed in PID automatically available in 3D Modeler
- 3D Modeler generates isometrics, GA drawings, BOMs from the 3D model

**Still sheet-based:**
- Despite the advanced data model, authoring is still one-sheet-at-a-time
- No continuous system view
- No model-first workflow where sheets are generated from topology

### Sources
- [What is OpenPlant PID](https://docs.bentley.com/LiveContent/web/OpenPlant%20PID-v2024.2/Help/en/topics/1332976/GUID-CF87C0C9-7B17-482B-AA68-E49BBD0E8B06.html)
- [Bentley OpenPlant PID Product Page](https://www.bentley.com/software/openplant-pid/)
- [OpenPlant PID CONNECT Wiki](https://communities.bentley.com/products/plant/w/plant_design_and_engineering__wiki/41605/openplant-pid-connect)
- [Bentley OpenPlant PowerPID Presentation](http://files.midamericacadd.org/2013presentations/OPPID_MACC_2013.pdf)
- [OpenPlant PID Datasheet](https://www.bentley.com/wp-content/uploads/PDS-OpenPlant-PID-LTR-EN-HR.pdf)

---

## 4. Notable Outlier: CADISON P&ID

CADISON takes the closest approach to "model-first":
- Object-oriented plant model with hierarchy
- P&ID sheets are generated from the model, not the other way around
- **Automatic path-finding** system for navigation through the topology
- **Cross-reference objects** auto-update when drawing numbers change
- Auto-generates: reports, BOMs, MTOs, isometrics, 2D GA drawings from the model

However, the P&ID authoring itself still appears to happen on individual sheets — the "model-first" aspect is more about the data structure than the viewing paradigm.

### Source
- [CADISON P&ID Designer](https://cadison.com/en/3d-plant-design-software/process-design-engineering-pid-designer)

---

## 5. Comparison Matrix

| Aspect | AVEVA P&ID | SmartPlant P&ID | Bentley OpenPlant | **AssetView (Planned)** |
|--------|-----------|----------------|-------------------|-------------------------|
| **Authoring paradigm** | Sheet-by-sheet | Sheet-by-sheet | Sheet-by-sheet | **System-based continuous canvas** |
| **Data storage** | Proprietary DB (Dabacon) | SQL Server / Oracle | ISO 15926 schema | PostgreSQL + Apache AGE |
| **Data model** | Proprietary object model | Proprietary relational | ISO 15926 (open) | Relational + graph topology |
| **Cross-sheet mechanism** | Off-Page Connectors | Off-Page Connectors (OPCs) | Off-Page Connectors | **Gateway nodes** (no OPCs needed) |
| **Continuous system view** | No | No | No | **Yes — infinite canvas per system** |
| **Model-first or sheet-first** | Sheet-first (DB populated as you draw) | Sheet-first (DB populated as you draw) | Sheet-first (DB populated as you draw) | **Model-first** (topology graph → canvas → optional sheet export) |
| **Cross-system visibility** | Only via OPCs to other sheets | Only via OPCs to other sheets | Only via OPCs to other sheets | **Cross-ref toggle** + gateway nodes |
| **3D integration** | E3D (separate tool, data sync) | SP3D (separate tool, data sync) | OpenPlant Modeler (shared ISO 15926) | **Split-pane 2D↔3D** with event bus |
| **Collaboration** | Cloud via AVEVA Connect (2024+) | SmartPlant Foundation | iTwin Services / PlantSight | **Yjs CRDT** real-time on canvas |
| **AI integration** | None | None | None | **Graph-RAG + isolation BFS + HAZOP** |
| **Sheet export** | Native (sheets are the format) | Native (sheets are the format) | Native (sheets are the format) | **"Export as Sheet"** feature (N12) |
| **Open standard** | No (proprietary) | No (proprietary) | ISO 15926 | **DEXPI export** (planned) |

---

## 6. The Key Architectural Insight

All three commercial tools follow the same pattern:

```
THEIR MODEL:    Sheet → Database
                (Drawing creates the data)

OUR MODEL:      Database → Canvas → (optional) Sheet
                (Data creates the view)
```

In AVEVA/SmartPlant/Bentley:
- The **sheet is the primary authoring artifact**
- The database is a **byproduct** of drawing on sheets
- To see cross-sheet connections, you must follow OPCs manually
- There is no "show me the whole Production system" view

In AssetView:
- The **topology graph is the primary data artifact**
- The canvas is a **live view** of the graph (React Flow + ELK layout)
- Cross-system connections are gateway nodes, not OPCs
- "Show me the whole Production system" is the default view
- Traditional sheets can be **generated** from the canvas when needed (for print, for regulatory submission)

### Why No One Has Done This Yet

1. **Legacy lock-in**: AVEVA/SmartPlant/Bentley have 20-30 years of codebase built around the sheet paradigm. Rewriting would break every customer workflow.
2. **Regulatory inertia**: P&ID sheets are regulatory deliverables (API, ISO). Regulators expect sheets. "Export as Sheet" solves this.
3. **Engineer comfort**: Engineers learned on sheets. The continuous view is unfamiliar. Phase 0.5 (Digital Index) builds trust before the paradigm shift.
4. **No graph database integration**: These tools use traditional relational databases. Graph traversal (upstream/downstream, isolation path finding) requires recursive CTEs or a separate graph DB. Apache AGE gives us this natively.
5. **AutoCAD dependency**: AVEVA P&ID is literally built on AutoCAD. SmartPlant uses its own CAD engine. Both are desktop-first. Web-native infinite canvas (React Flow) wasn't viable until recently.

---

## 7. What This Means for AssetView

### We are NOT competing with AVEVA/SmartPlant/Bentley on authoring

Those tools are for **creating** P&IDs during FEED and detailed design. Engineers spend months drawing sheets in those tools. We should not try to replace that workflow.

### We ARE creating the missing viewing/navigation/operations layer

Once P&IDs are created (in whatever tool), AssetView provides:
1. **Continuous system visualization** — the topology view that no tool offers
2. **3D cross-reference** — click in 2D ↔ fly to 3D
3. **Intelligent annotations** — isolation certificates, PTW, live on the topology
4. **AI querying** — "show me all safety valves upstream of this pump"
5. **Operations-phase tool** — these tools are design-phase; we're operations-phase

### Data flow:
```
Design Phase:              Operations Phase:
AVEVA/SmartPlant/Bentley → Export (DEXPI/ISO 15926) → AssetView imports →
                                                       Topology graph built →
                                                       Continuous canvas rendered →
                                                       3D model linked →
                                                       AI + annotations ready
```

### The Sheet Export feature (N12) is critical

Engineers will ask: "Can I still get a normal P&ID sheet?" Answer must be yes. The "Export as Sheet" feature auto-generates traditional-looking sheets from the continuous canvas, complete with borders, title blocks, and proper OPC-style continuation markers. This is the bridge that makes adoption possible.

---

## 8. Recommendation for AssetView Implementation

Based on this study:

1. **Don't build a P&ID authoring tool** — that's a 20-year, 200-person effort. AVEVA/SmartPlant own that space.
2. **Build the best P&ID viewing/navigation/operations tool** — the continuous canvas is our differentiator.
3. **Import from their formats** — DEXPI import (Phase 6) lets us consume P&IDs from any intelligent tool.
4. **Phase 0.5 (Digital Index)** bridges the gap — even before continuous canvas, link existing PDFs to 3D.
5. **"Export as Sheet"** is table stakes for adoption — engineers need traditional output for regulatory and printing.
6. **OPC elimination is a selling point** — managing OPCs is a known pain point. Our gateway nodes solve this elegantly.

---

*Study based on web research of AVEVA, Hexagon/SmartPlant, and Bentley product documentation, user guides, conference presentations, and practitioner articles.*
