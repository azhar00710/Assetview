# AssetView Canvas Module — Architecture & Strategy

## Document Purpose
This is the master architecture document for the Canvas module — the primary interface of AssetView. Every sub-agent, team member, or AI assistant working on any canvas sub-element should read this first.

---

## 1. WHAT IS THE CANVAS?

The Canvas is a **continuous system-based topology viewer** that replaces sheet-based P&ID navigation. It renders equipment, lines, and instruments as an interactive directed graph where engineers can:

- See an entire system's topology in one view (not fragmented across sheets)
- Trace upstream/downstream from any equipment
- Highlight isolation boundaries, corrosion loops, SIS paths
- Navigate across system boundaries via gateway nodes
- Zoom from platform overview → system → detail levels

**The Canvas is NOT a P&ID editor.** It's a logical topology viewer. The P&ID Viewer (separate component) shows the actual engineering drawing. They are linked but never merged.

---

## 2. ARCHITECTURE DECISIONS (LOCKED)

These decisions are made. Do not revisit them.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering engine | **React Flow (@xyflow/react)** | Good for 200-800 nodes with memoization. Adequate for offshore platforms (typically 50-300 equipment per system). React-native integration. |
| Layout engine | **ELK.js (layered + orthogonal)** | Best for P&ID-style left-to-right flow with right-angle edges. Compute once → persist → re-layout only on topology change. |
| Layout computation | **Web Worker** (frontend) or **backend pre-compute** | Never block the main thread. Cache aggressively. |
| State management | **Zustand** (canvas-specific store) | Lightweight, no Redux boilerplate. Replaces scattered useState. |
| Selection sync | **SelectionBus** (local event bus) | Already implemented. No WebSocket needed for same-tab sync. |
| Canvas vs P&ID Viewer | **SEPARATE components** | Canvas = logical topology. P&ID = engineering drawing. Different interaction models. Linked via SelectionBus. |
| Canvas vs Miller Columns | **Canvas = primary**, Miller = sidebar filter | Engineers work spatially, not hierarchically. |
| Graph traversal | **PostgreSQL recursive CTEs** | Replace JS-side BFS. 10x faster, no full-graph memory load. |
| Topology edges | **Explicit `topology_edges` table** | Stop inferring connections from tag naming. Explicit edges are reliable and AI-queryable. |

---

## 3. CANVAS SUB-MODULES

The canvas is composed of 8 sub-modules that can be developed independently:

```
canvas/
├── core/                    ← Sub-module 1: Core Canvas Shell
│   ├── CanvasProvider.jsx       # Zustand store provider + context
│   ├── SystemCanvas.jsx         # Main React Flow wrapper (REFACTORED)
│   └── CanvasToolbar.jsx        # Zoom controls, layer toggles, mode switches
│
├── nodes/                   ← Sub-module 2: Node Types
│   ├── EquipmentNode.jsx        # Equipment block (valve, vessel, pump, etc.)
│   ├── InstrumentNode.jsx       # Circular instrument symbol
│   ├── CollapsedGroupNode.jsx   # System super-node at overview zoom
│   ├── SystemGatewayNode.jsx    # Cross-system boundary node
│   ├── TeeNode.jsx              # Pipe junction
│   ├── HeaderNode.jsx           # NEW: Production/gas lift header
│   └── nodeRegistry.js          # Maps node type strings → components
│
├── edges/                   ← Sub-module 3: Edge Types
│   ├── PipeEdge.jsx             # Process piping (solid, sized)
│   ├── SignalEdge.jsx           # Instrument signal (dashed yellow)
│   ├── BoundaryEdge.jsx         # Cross-system boundary (dashed colored)
│   ├── UtilityEdge.jsx          # NEW: Utility piping (blue, different style)
│   └── edgeRegistry.js          # Maps edge type strings → components
│
├── overlays/                ← Sub-module 4: Overlay System
│   ├── OverlayManager.jsx       # Layer visibility toggles
│   ├── IsolationOverlay.jsx     # Highlight isolation boundary + valve lineup
│   ├── CorrosionOverlay.jsx     # Color-code corrosion loop segments
│   ├── PermitOverlay.jsx        # Show active permit zones
│   ├── SISOverlay.jsx           # Safety instrumented function paths
│   └── TracingOverlay.jsx       # Upstream/downstream trace highlight
│
├── layout/                  ← Sub-module 5: Layout Engine
│   ├── elkLayout.js             # ELK wrapper (EXISTING, refactor)
│   ├── layoutWorker.js          # Web Worker for async layout (EXISTING)
│   ├── layoutPersistence.js     # NEW: Save/load positions to DB
│   └── layoutUtils.js           # NEW: Manual nudge, snap-to-grid
│
├── interactions/            ← Sub-module 6: User Interactions
│   ├── useCanvasStore.js        # Zustand store definition
│   ├── useSemanticZoom.js       # Zoom level detection + node/edge filtering
│   ├── useTracing.js            # BFS trace trigger + result state
│   ├── useSelection.js          # Multi-select, shift-click, box select
│   └── useContextMenu.js        # Right-click → trace/isolate/details
│
├── contracts/               ← Sub-module 7: Shared Contracts
│   ├── SelectionContract.js     # Shared selection event types
│   ├── CanvasAction.js          # Actions other modules can trigger
│   ├── TopologyTypes.js         # Node/edge/overlay data shapes
│   └── AIToolInterface.js       # What AI can query/do on canvas
│
└── symbols/                 ← Sub-module 8: P&ID Symbol Library
    ├── EquipmentSymbols.jsx     # SVG symbols per equipment type
    ├── InstrumentSymbols.jsx    # ISA 5.1 instrument symbols
    ├── ValveSymbols.jsx         # Valve type symbols
    └── symbolRegistry.js        # Maps type strings → SVG components
```

---

## 4. CANVAS STATE (Zustand Store)

```javascript
// useCanvasStore.js — single source of truth for canvas state
const useCanvasStore = create((set, get) => ({
  // === VIEW STATE ===
  zoomLevel: 'SYSTEM',           // 'OVERVIEW' | 'SYSTEM' | 'DETAIL'
  viewport: { x: 0, y: 0, zoom: 1 },

  // === DATA STATE ===
  activeSystemId: null,
  activePlatformId: null,
  nodes: [],                     // React Flow nodes (positioned)
  edges: [],                     // React Flow edges

  // === SELECTION STATE ===
  selectedNodeIds: new Set(),     // Multi-select support
  hoveredNodeId: null,

  // === TRACING STATE ===
  traceResult: null,             // { startNodeId, direction, path: [nodeIds], boundary: [nodeIds] }
  traceMode: null,               // null | 'upstream' | 'downstream' | 'isolation'

  // === OVERLAY STATE ===
  activeOverlays: new Set(),     // Set of active overlay names
  overlayData: {},               // { isolation: {...}, corrosion: {...}, permit: {...} }

  // === LAYOUT STATE ===
  layoutMode: 'auto',            // 'auto' | 'manual' | 'persisted'
  layoutReady: false,

  // === ACTIONS ===
  setSystem: (systemId) => { ... },
  selectNode: (nodeId) => { ... },
  deselectAll: () => { ... },
  startTrace: (nodeId, direction) => { ... },
  clearTrace: () => { ... },
  toggleOverlay: (name) => { ... },
  updateNodePosition: (nodeId, pos) => { ... },
  setZoomLevel: (level) => { ... },
}));
```

---

## 5. INTERACTION FLOWS

### 5.1 Primary Flow: Trace Isolation Boundary
```
Engineer clicks equipment (e.g., CV-019S)
  → Context menu: "Trace Isolation"
  → Canvas calls: POST /api/v1/topology/isolation?equipment_id=xxx
  → Backend runs recursive CTE: finds all paths, identifies boundary valves
  → Response: { boundary_valves: [...], affected_equipment: [...], affected_lines: [...] }
  → IsolationOverlay highlights:
      - RED ring on boundary valves (these must be closed)
      - ORANGE fill on affected equipment (within isolation zone)
      - DIMMED everything outside isolation zone
  → Sidebar shows: Isolation Certificate draft with valve lineup
```

### 5.2 Trace Upstream/Downstream
```
Engineer right-clicks equipment
  → "Trace Upstream" or "Trace Downstream"
  → Canvas calls: GET /api/v1/topology/upstream/:nodeId or /downstream/:nodeId
  → TracingOverlay highlights the path with animated edge flow
  → Cross-system paths show gateway transitions
```

### 5.3 Semantic Zoom
```
Zoom < 0.45x → OVERVIEW
  - Show CollapsedGroupNodes (one per system)
  - Edges show cross-system connections
  - Click system → zoom to SYSTEM level

Zoom 0.45x–1.2x → SYSTEM
  - Show equipment nodes + pipe edges
  - Hide instruments
  - Gateway nodes visible at boundaries

Zoom > 1.2x → DETAIL
  - Show all: equipment + instruments + signal edges
  - Full labels, criticality badges, SIL ratings
```

### 5.4 Cross-System Navigation
```
Engineer clicks a SystemGatewayNode
  → Canvas animates zoom-out to OVERVIEW
  → Then zooms into the target system
  → SelectionBus emits system:select event
  → P&ID Viewer (if open) shows relevant P&ID
```

---

## 6. DATA FLOW

```
Database (PostgreSQL)
  ↓
  topology_edges table + equipment/line/instrument tables
  ↓
Backend API (Fastify)
  ↓
  GET /api/v1/systems/:id/topology → { nodes, edges, gateways }
  GET /api/v1/topology/upstream/:nodeId → { path, visited }
  GET /api/v1/topology/downstream/:nodeId → { path, visited }
  POST /api/v1/topology/isolation → { boundary, affected, zones }
  GET /api/v1/topology/layout/:systemId → { positions (persisted) }
  PUT /api/v1/topology/layout/:systemId → save manual positions
  ↓
Frontend (React Query → Zustand → React Flow)
  ↓
  useCanvasStore (Zustand) → single state
  ↓
  SystemCanvas.jsx → renders React Flow
  ↓
  OverlayManager → conditionally renders overlay layers
  ↓
  SelectionBus → emits events to P&ID Viewer / 3D / AI Panel
```

---

## 7. MOCK DATA STRATEGY

For standalone canvas development, we use rich mock data that exercises ALL canvas features:

**Mock Platform: WHT-5 (Abu Dhabi Offshore)**
- 14 systems (process, utility, safety, instrument)
- Per system: 8-25 equipment, 3-10 lines, 5-15 instruments
- Cross-system connections via gateway nodes
- Pre-defined isolation scenarios
- Corrosion loop groupings
- Active permit zones

Mock data lives in `frontend/src/canvas/mock/` and is loaded when `VITE_USE_MOCK=true`.

The mock data structure EXACTLY matches the API response format so switching to real API is a config change, not a code change.

---

## 8. PERFORMANCE STRATEGY

| Scale | Nodes | Strategy |
|-------|-------|----------|
| Small | <100 | No optimization needed |
| Medium | 100-400 | Memoize custom nodes (React.memo), cache ELK layout |
| Large | 400-800 | Semantic zoom hides instruments at lower zooms, layout in Web Worker |
| Very Large | 800+ | Subgraph loading (only render visible viewport + buffer), virtualize offscreen nodes |

Key rules:
1. **Never re-layout on zoom/pan.** Layout is computed once per topology change.
2. **Memoize ALL custom nodes.** React.memo with shallow prop comparison.
3. **ELK runs in Web Worker.** Never block main thread.
4. **Persist layouts.** Don't recompute what hasn't changed.
5. **Limit visible nodes.** At SYSTEM zoom, hide instruments. At OVERVIEW, collapse to groups.

---

## 9. AI INTEGRATION POINTS

The canvas exposes these interfaces for AI (Claude) interaction:

```javascript
// What AI can READ from the canvas:
getCanvasSummary(systemId)     → compact JSON of nodes/edges/active overlays
getSelectedEntities()          → what the user has selected
getActiveTrace()               → current trace result (if any)
getVisibleSubgraph()           → only what's currently rendered

// What AI can DO to the canvas:
highlightEntities(ids, color)  → visual highlight
startTrace(entityId, direction)→ trigger trace
showIsolation(equipmentId)     → compute and show isolation boundary
clearOverlays()                → reset visual state
focusEntity(entityId)          → pan/zoom to entity
annotateEntity(entityId, text) → add temporary label
```

AI actions go through Zustand store → Canvas re-renders. No direct DOM manipulation.

---

## 10. CONTRACTS (Shared Interfaces)

### SelectionContract
```javascript
// Emitted via SelectionBus when user selects something on canvas
{
  event: 'entity:select',
  payload: {
    entityId: 'uuid',
    entityType: 'equipment' | 'line' | 'instrument' | 'system',
    entityTag: 'PV019-XT',
    source: '2d-canvas',
    context: {
      systemId: 'uuid',
      systemCode: 'PV019',
      lineIds: ['uuid', ...],       // connected lines
      pnidIds: ['uuid', ...],       // P&IDs this appears on
    }
  }
}
```

### CanvasAction (what external modules can trigger)
```javascript
// P&ID Viewer, AI Panel, Miller Sidebar can dispatch these:
{ action: 'FOCUS_ENTITY', payload: { entityId, zoom: true } }
{ action: 'HIGHLIGHT', payload: { entityIds: [], color, duration } }
{ action: 'START_TRACE', payload: { entityId, direction } }
{ action: 'SHOW_OVERLAY', payload: { type: 'isolation', data: {...} } }
{ action: 'CLEAR_OVERLAYS' }
{ action: 'SET_SYSTEM', payload: { systemId } }
```

---

## 11. DEVELOPMENT PHASES

### Phase A: Core Canvas (Week 1-2)
- Zustand store replacing useState scatter
- Refactored SystemCanvas with clean data flow
- Rich mock data loaded standalone
- ELK layout with persistence
- Basic node/edge rendering with existing types

### Phase B: Tracing & Overlays (Week 2-3)
- TracingOverlay (upstream/downstream highlighting)
- IsolationOverlay (boundary valve detection)
- Context menu (right-click → trace/isolate/details)
- Backend: recursive CTE endpoints replacing JS BFS

### Phase C: Cross-System & Zoom (Week 3-4)
- Semantic zoom with level-appropriate filtering
- CollapsedGroupNode at overview level
- Gateway node navigation between systems
- Multi-system trace (across boundaries)

### Phase D: AI & Ecosystem (Week 4-5)
- AIToolInterface implementation
- CanvasAction dispatcher for external modules
- SelectionContract finalization
- Integration test harness with P&ID Viewer stub

---

## 12. WHAT THIS CANVAS IS NOT

1. **Not a P&ID editor** — no drawing tools, no shape creation
2. **Not a document viewer** — that's PnidViewer's job
3. **Not a 3D viewer** — that's the separate Three.js module
4. **Not a data entry tool** — topology comes from database
5. **Not a replacement for AVEVA/SmartPlant** — it's a navigation + analysis tool

The canvas does ONE thing: **visualize system topology and enable spatial reasoning about equipment connections, isolation boundaries, and operational overlays.**
