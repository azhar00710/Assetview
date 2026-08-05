# AssetView — Deep Technical & Strategic Analysis Prompt

You are a senior systems architect and oil & gas digital transformation consultant. Perform an exhaustive analysis of the AssetView project described below. Be brutally honest about what works, what doesn't, and what's over-engineered.

---

## CONTEXT

**AssetView** is an Intelligent Asset Environment for offshore oil & gas platforms. It allows engineers to navigate plant hierarchy, view P&ID drawings, search equipment, and interact with an AI assistant. The 3D visualization engine is handled separately (nearly ready for integration) — focus your analysis on the 2D canvas, data architecture, and AI-readiness.

**Owner**: GeoSoft | **Industry**: Oil & Gas — Upstream / Offshore
**Stage**: Phase 2 (Foundation Build) — transitioning from POC to production

---

## CURRENT ARCHITECTURE

```
Frontend:  React 18 + Vite + Tailwind CSS + TanStack Query
Canvas:    @xyflow/react (React Flow) v12 + ELK.js (hierarchical layout)
Backend:   Node.js + Fastify 5 + Prisma ORM
Database:  PostgreSQL 15+ (pg_trgm for search, JSONB)
AI:        Anthropic Claude API (function calling)
Real-time: fastify-websocket
3D:        Three.js + @react-three/fiber (separate module, nearly ready)
```

### Data Model (Relational with M:N junctions)

```
concession → field → complex → platform → system
                                              ↓
                                     ┌────────┴────────┐
                                   line            equipment
                                     ↓                 ↓
                                 instrument        (standalone)
```

**Key relationship**: Lines BELONG to systems (ownership) but APPEAR on P&IDs (display).
- `pnid_system` — which systems a P&ID references (has `is_primary` boolean)
- `pnid_line` — which lines appear on which P&IDs (has `is_continuation` boolean)
- `pnid_equipment` — equipment positions on P&ID (annotation x/y/w/h percentages)
- `pnid_instrument` — instrument positions on P&ID

### Current Canvas Implementation (React Flow)

The "System Canvas" uses React Flow with these custom node types:
- `EquipmentNode` — equipment with criticality badge
- `InstrumentNode` — round instrument node
- `GatewayNode` — cross-system navigation (dashed border)
- `CollapsedGroupNode` — hierarchical collapsing

Custom edge types:
- `PipeEdge` — solid (process connections)
- `SignalEdge` — dotted (signal/control)
- `BoundaryEdge` — system boundary

Layout is done with ELK.js (hierarchical). The canvas also has:
- Semantic zoom levels
- BFS upstream/downstream traversal (backend topology service)
- SelectionBus pub-sub for 2D ↔ 3D sync

### Current P&ID Viewer

Separate from the canvas — a pan/zoom image viewer with:
- Annotation overlay (equipment/instrument positions from DB)
- Drawing tools (pin, line, rectangle, circle, diamond, P&ID symbols)
- Entity linking (drawn shape → equipment/line/instrument)
- OCR integration for tag extraction
- Approval workflow (draft → pending_review → approved)

### Frontend UI Pattern

5 Miller Columns: SYSTEMS | P&IDs | LINES | EQUIPMENT | INSTRUMENTS
- Cascade filtering: click item in column N → filters N+1 through 5
- Cross-reference toggle (X-Ref) showing items from other systems at 65% opacity
- Register mode: click column header → full-width sortable/filterable table

### Current Codebase Size

~8,100 lines across ~80 frontend components, 15 backend route modules, topology service with graph traversal.

---

## TARGET USE CASES (CRITICAL — analyze every tool choice against these)

The canvas and overall platform must serve these real oil & gas engineering workflows:

### 1. Equipment Isolation Planning
Engineers need to visually trace process paths to identify all valves, blinds, and isolation points required to safely isolate a piece of equipment for maintenance. The canvas should show the process flow and let engineers click-to-trace upstream/downstream, highlighting the isolation boundary.

### 2. Permit to Work (PTW) Visualization
Before issuing a work permit, supervisors need to see which equipment is under active permits, which areas are restricted, and what the spatial/process relationships are. The canvas should overlay permit status on the process topology.

### 3. Corrosion Loop Tracking
Inspection engineers group equipment into corrosion loops (shared corrosion mechanism). They need to visualize which equipment belongs to which loop, see inspection history, and plan inspection campaigns. The canvas should color-code or group by corrosion loop.

### 4. Shutdown/Turnaround Planning
Planners need to see the full scope of a shutdown — which systems are affected, what equipment needs work, what's the critical path. The canvas should support multi-system views with work-order overlays.

### 5. Safety Instrumented System (SIS) Verification
Safety engineers need to trace Safety Instrumented Functions (SIFs) from sensor through logic solver to final element. The canvas should show SIF paths with SIL ratings and proof test status.

### 6. AI-Powered Workflows (Future)
The architecture must be AI-ready. Claude (or similar) should be able to:
- Query the canvas state ("show me all high-criticality equipment on the Closed Drain system")
- Trigger canvas actions ("highlight the isolation boundary for V-5001")
- Annotate findings ("mark these 3 valves as requiring replacement")
- Generate isolation certificates from traced paths
- Suggest inspection priorities based on corrosion loop data
- Answer natural language questions about process topology

### 7. Cross-System Impact Analysis
When something changes in one system (e.g., a line is re-routed), engineers need to see the downstream impact across connected systems. The canvas should support multi-system graph views with clear boundary indicators.

---

## ANALYSIS REQUIRED

### Part 1: Objective Clarity (Score 1-10 with justification)

1. Is the project objective well-defined? Does it try to do too much or too little?
2. Is the phasing (P2.1 → P2.6) practical? What's missing?
3. Are the use cases above realistic and prioritized correctly?
4. What's the MVP that would deliver real value to field engineers TODAY?

### Part 2: Architecture & Tool Choices (Deep Dive)

For EACH technology choice, answer:
- **Does it serve the use cases above?** Be specific.
- **Is it the simplest tool that could work?** Or is it over-engineered?
- **What are the scaling limits?** (100 users? 1000? 10,000 equipment items?)
- **What's the migration cost if we need to switch?**

Specifically evaluate:

#### A. React Flow (@xyflow/react) for the Canvas
- Is React Flow the right choice for visualizing P&ID process topology?
- Can it handle the complexity of isolation tracing, SIF paths, corrosion loops?
- How does it compare to: D3.js force-directed, Cytoscape.js, JointJS, GoJS, or a custom SVG/Canvas renderer?
- Can React Flow handle 500+ nodes with acceptable performance?
- Is ELK.js the right layout engine? What about Dagre, Cola.js, or custom layout?
- **Key question**: Should the "System Canvas" and "P&ID Viewer" be the SAME component or separate? Currently they're separate — is that right?

#### B. Database Design
- Is PostgreSQL with junction tables the right model for graph traversal (upstream/downstream)?
- Should we use a graph database (Neo4j) or PostgreSQL's recursive CTEs instead?
- Is the BFS traversal in JavaScript (backend service) the right approach, or should this be a database query?
- How does the M:N junction table model perform at scale (1000+ P&IDs, 10,000+ equipment)?

#### C. ELK.js for Layout
- Is hierarchical layout correct for P&ID process flow?
- P&IDs are traditionally left-to-right flow diagrams — does ELK respect this?
- What about orthogonal routing (right-angle pipe connections)?
- Performance with 500+ nodes?

#### D. Three.js / React Three Fiber for 3D
- Given the 3D engine is separate and nearly ready, is the 2D↔3D sync architecture (SelectionBus pub-sub) adequate?
- What data contract should exist between 2D canvas and 3D viewer?
- Is WebSocket the right sync mechanism, or is local event bus sufficient?

#### E. Fastify + Prisma Backend
- Is Prisma the right ORM for the graph-traversal queries needed?
- Should the topology service use raw SQL instead of Prisma?
- Is the REST API design sufficient, or should we consider GraphQL for the flexible querying the canvas needs?

#### F. AI Integration Architecture
- Is function calling (tool use) the right pattern for Claude ↔ Canvas interaction?
- What "tools" should Claude have access to? (Currently just equipment queries)
- How should Canvas state be exposed to the AI? (Full graph? Filtered view? Natural language description?)
- Should the AI be able to MODIFY canvas state (add annotations, highlight paths) or only READ?
- What's the right architecture for AI-powered isolation certificate generation?

### Part 3: Simplicity Audit

The guiding principle is **simplicity is key**. For each component, answer:
- What can be REMOVED without losing core value?
- What's over-engineered for the current stage?
- What should be deferred to Phase 3+?

Specifically flag:
1. Is the OCR pipeline premature? (6 service classes for a feature that could be a simple API call)
2. Are 5 cloud storage providers necessary? (S3, GCS, Azure, DO Spaces, Local)
3. Is the admin panel (11 route files, 9 components) too much for Phase 2?
4. Is the annotation system (drawing tools, approval workflow) needed before basic canvas works?
5. Should the Miller Columns be the primary nav, or should the canvas BE the primary nav?

### Part 4: AI-Readiness Score (1-10)

Evaluate how well the current architecture supports future AI workflows:
1. **Data accessibility**: Can an AI model easily query the current data model?
2. **Action surface**: Can an AI trigger meaningful actions (highlight, annotate, generate reports)?
3. **Context window**: Can the current graph be serialized into a context that fits in a 200K token window?
4. **Feedback loop**: Can user corrections to AI suggestions be captured for fine-tuning?
5. **Composability**: Can AI workflows chain together (trace path → generate certificate → create work order)?

### Part 5: Recommended Architecture

Based on your analysis, propose:

1. **Revised tech stack** — what to keep, replace, or add
2. **Revised canvas architecture** — unified or separate? Which library?
3. **Revised data model** — any schema changes needed for the use cases?
4. **Revised AI integration** — detailed architecture for Claude ↔ Canvas ↔ 3D
5. **Revised phasing** — what to build first, second, third
6. **Kill list** — what to remove entirely from the current codebase

### Part 6: Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|

Cover at minimum:
- Performance ceiling of React Flow at scale
- Prisma limitations for graph queries
- AI hallucination in safety-critical contexts (isolation planning)
- Data integrity for M:N junction tables
- Developer velocity with current complexity

---

## OUTPUT FORMAT

Structure your response as:
1. **Executive Summary** (1 paragraph — the single most important finding)
2. **Objective Clarity** (Part 1)
3. **Architecture Deep Dive** (Part 2, section per technology)
4. **Simplicity Audit** (Part 3)
5. **AI-Readiness Assessment** (Part 4)
6. **Recommended Architecture** (Part 5)
7. **Risk Matrix** (Part 6)
8. **Immediate Action Items** (Top 5 things to do THIS WEEK)

Be specific. Use concrete examples from the use cases. No hand-waving. If you'd recommend a different library, show WHY with a code comparison or capability matrix. If you'd change the data model, show the new schema.

**Remember: Simplicity is king. The best architecture is the one that a small team can build, maintain, and extend without drowning in complexity. Every abstraction must earn its place.**
