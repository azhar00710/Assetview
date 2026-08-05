# Canvas Enhancement Plan — Usability & Interactivity

> **Goal**: Make the canvas a fully interactive engineering workspace before
> building advanced applications (tracing, isolation, corrosion).
> Each session is ~2-3 hours of implementation work.

---

## Current State Assessment

### What Works Well
- ISA 5.1 symbols render correctly (valves, pumps, vessels, instruments)
- ELK layout produces clean left-to-right P&ID-style topology
- Semantic zoom (Overview → System → Detail) filters nodes correctly
- CollapsedGroupNode click → expands into system topology view
- SystemGatewayNode click → navigates to connected system
- SelectionBus exists for cross-component event sync
- Backend has full recursive CTE topology engine (trace up/down, isolation)
- Zustand store has all state shapes ready (traceResult, overlayData, etc.)

### What's Missing (User-Reported + Research-Confirmed)
1. **Zoom level indicator** (bottom-left) — shows text but doesn't allow clicking to switch levels
2. **No overview ↔ system interaction** — can't see how systems connect, no boundary edges
3. **No P&ID sheet relationship** — can't see which sheets an equipment/line appears on
4. **No cross-system relationship view** — can't visualize how System A connects to System B
5. **No search/filter in canvas** — must exit to Miller columns to find anything
6. **No equipment detail panel** — clicking a node only highlights it, shows nothing
7. **Overlay buttons toggle state** but no data flows into them (tracing, isolation, corrosion are visual-only)
8. **No drafting capability** — can't compose a view from system's lines/equipment/instruments
9. **Layout persistence** — save button missing, manual drag positions not persisted

---

## Session Plan

### Session 10: Canvas Interactivity Foundation
**Theme**: Make every click meaningful — detail panels, search, zoom controls

#### 10A. Node Detail Panel (Right Sidebar)
When user clicks any node, slide in a detail panel showing:

**Equipment:**
| Field | Source |
|-------|--------|
| Tag | `node.data.tag` |
| Type | `node.data.equipmentType` (mapped to human name) |
| Criticality | `node.data.criticality` (badge: high/medium/low) |
| SIL Level | `node.data.silLevel` |
| Line | `node.data.lineNumber` (clickable → highlights line path) |
| System | `node.data.systemCode + systemName` |
| P&IDs | List of sheets this equipment appears on (from `pnid_equipment` junction) |
| Corrosion Loop | `node.data.corrosionLoop` |
| Inspection Group | `node.data.inspectionGroup` |

**Instrument:**
| Field | Source |
|-------|--------|
| Tag | `node.data.tag` |
| Type | `node.data.instrumentType` |
| Range | `rangeMin – rangeMax rangeUnit` |
| Set Point | `node.data.setPoint` |
| SCADA Tag | `node.data.scadaTag` |
| Loop Number | `node.data.loopNumber` |
| Signal Type | `node.data.signalType` |
| Line | parent line info |
| P&IDs | sheets this instrument appears on |

**Actions in panel:**
- "Trace Upstream" / "Trace Downstream" buttons → triggers trace overlay
- "Find Isolation" button → triggers isolation overlay
- "Show on P&ID" → opens PnidViewer at annotation position
- "Highlight Line" → highlights all nodes on same line

**Implementation:**
- New component: `NodeDetailPanel.jsx` (~200 lines)
- New API hook: `useEntityDetail(entityId, entityType)` — fetches full detail + P&ID links
- Backend: `GET /api/v1/equipment/:id/detail` and `GET /api/v1/instruments/:id/detail`
  - Returns entity + joined P&ID appearances + line info
- Panel slides in from right, 320px wide, dark background matching app theme
- Close on pane click or Escape key

#### 10B. Canvas Search & Filter
Add a search bar to the canvas toolbar:

- **Search box** in toolbar (Cmd+K / Ctrl+K shortcut to focus)
- Searches across: equipment tags, instrument tags, line numbers, equipment types
- Results dropdown shows matches with type icon + tag + system
- Click result → pan & zoom to node + select it + open detail panel
- Uses existing `GET /api/v1/search?q=...&platform_id=...` endpoint

**Filter chips** (below search):
- By line: show only nodes on selected line(s)
- By equipment type: valve/pump/vessel/header/etc.
- By criticality: high/medium/low
- Clear all filters button

**Implementation:**
- New component: `CanvasSearch.jsx` (~150 lines)
- Integrate with `useCanvasStore` for filter state
- Use React Flow's `fitView({ nodes: [matchedNodeId] })` for pan-to-node

#### 10C. Zoom Level Controls (Fix Bottom-Left Indicator)
The current zoom level indicator (Overview/System/Detail) should be interactive:

- Click "Overview" → zoom to fit all systems (zoom < 0.45)
- Click "System" → zoom to 0.8x (shows equipment without instrument detail)
- Click "Detail" → zoom to 1.5x (shows everything including ranges/SCADA)
- Active level has filled dot, others have outline dot
- Smooth animated zoom transition using `reactFlowInstance.zoomTo()`

**Implementation:**
- Modify existing zoom level display in `SystemCanvas.jsx`
- Add click handlers that call `reactFlowInstance.zoomTo(targetZoom, { duration: 300 })`
- ~30 lines of changes

---

### Session 11: System Relationships & Cross-System Navigation
**Theme**: See the big picture — how systems connect, boundary flows, P&ID sheets

#### 11A. Boundary Edges in Overview
Currently overview shows systems as isolated cards. Need to show connections:

- **Backend endpoint**: `GET /api/v1/topology/boundaries?platform_id=...`
  - Query `topology_edges WHERE edge_type = 'boundary'`
  - Group by (from_system_id, to_system_id) to get unique system pairs
  - Return: `[{ fromSystemId, toSystemId, edgeCount, description, edgeType }]`
- **Frontend**: Draw BoundaryEdge between CollapsedGroupNodes
  - Animated dashed line with label showing connection count
  - Color: process=green, utility=blue, safety=red
  - Click edge → tooltip showing which equipment connects across the boundary

**Implementation:**
- New backend route handler (~40 lines in topology.js)
- New query in topologyQueries.js (~20 lines SQL)
- Update `useTopologyData.js` overview builder to fetch and render edges
- ~100 lines total

#### 11B. P&ID Sheet Relationships Panel
Add a "Sheets" tab/panel showing which P&IDs relate to current view:

**In System View:**
- Show list of P&IDs that are primary or cross-reference for this system
- Each P&ID item shows: drawing number, title, revision, status badge
- Click → opens PnidViewer for that sheet
- Equipment/instruments on that sheet highlighted on canvas

**In Overview:**
- Show total P&ID count per system (already in CollapsedGroupNode)
- Add "All Sheets" button → opens register view filtered to platform

**Implementation:**
- New component: `SheetPanel.jsx` (~120 lines)
- Uses existing `GET /api/v1/pnids?system_id=...&include_xref=true`
- Toggle button in toolbar: "Sheets" (shows/hides panel)
- Panel appears as bottom drawer (200px height) or right sidebar tab

#### 11C. Cross-System Trace View
When user clicks a boundary edge or gateway node, show a "cross-system trace":

- Highlights the path from source equipment through boundary to target equipment
- Shows both systems' relevant equipment in a simplified two-column layout
- Uses: `GET /api/v1/topology/downstream/:entityId` which already crosses system boundaries
- Path nodes highlighted in accent green, non-path nodes dimmed

**Implementation:**
- Extend `useTracingOverlay.js` to handle cross-system results
- Add "Trace Across Systems" action to gateway node right-click or detail panel
- ~80 lines of changes

---

### Session 12: Line-Based Navigation & Drafting View
**Theme**: Navigate by line (the natural engineering mental model) and compose custom views

#### 12A. Line Highlighting
Engineers think in lines, not individual equipment. Add line-based interaction:

- **Hover a pipe edge** → highlights entire line path (all edges + equipment on that line)
- **Click a pipe edge** → selects the line, shows line detail in panel:
  - Line number, service, nominal size, pipe class, material
  - Design pressure/temperature
  - All equipment on this line (clickable list)
  - All P&IDs this line appears on (clickable list)
  - Continuation info (if line continues to another sheet/system)
- **Line color mode**: toggle to color edges by line_id (each line gets unique color)

**Implementation:**
- Add `lineId` to edge data in topology response
- New line detail API: `GET /api/v1/lines/:id/detail` (with equipment + P&ID joins)
- Highlight logic: filter edges by `lineId`, apply glow style
- ~120 lines frontend + ~30 lines backend

#### 12B. Drafting View — Custom System Composition
This addresses the user's question: "How do I draft using components that are already linked to this system?"

**Concept**: A "Drafting Mode" where the user can compose a custom view by selecting which lines/equipment/instruments to include from the system's inventory.

**UI Flow:**
1. User enters system view → clicks "Draft" button in toolbar
2. Left panel shows system inventory in three tabs:
   - **Lines** tab: all lines belonging to this system (checkboxes)
   - **Equipment** tab: all equipment in this system (grouped by line, checkboxes)
   - **Instruments** tab: all instruments (grouped by line, checkboxes)
3. User checks/unchecks items → canvas instantly updates to show only selected items
4. ELK re-layouts the selected subset
5. "Save Draft" → persists the selection as a named view (stored in localStorage or backend)
6. "Export" → generates SVG/PNG of the current draft view

**Data Source:**
- Lines: `GET /api/v1/lines?system_id=...` (already exists)
- Equipment: `GET /api/v1/equipment?system_id=...` (already exists)
- Instruments: `GET /api/v1/instruments?system_id=...` (already exists)
- Topology subset: filter `topology_edges` to only include selected entity IDs

**Implementation:**
- New component: `DraftingPanel.jsx` (~250 lines)
- New hook: `useDraftingMode.js` — manages selected entity IDs, filters topology
- Modify `useTopologyData.js` to accept `entityFilter` parameter
- Add "Draft" toggle button to `CanvasToolbar.jsx`
- ~400 lines total, spread across 4-5 files

**Why This Matters:**
- Engineers often need to see "just the production lines" or "just the safety-critical equipment"
- Current view shows everything in the system — can be overwhelming for large systems
- Drafting mode lets them build focused views for specific tasks (maintenance planning, HAZOP review, isolation planning)

---

### Session 13: Tracing & Isolation (Wiring the Overlays)
**Theme**: Connect the existing overlay visual system to real backend data

#### 13A. Upstream/Downstream Tracing
The overlay rendering code already exists. Wire it to the backend:

**User Flow:**
1. Right-click equipment node → "Trace Upstream" or "Trace Downstream"
   (OR click in detail panel → trace buttons)
2. Frontend calls `GET /api/v1/topology/upstream/:entityId` or `/downstream/:entityId`
3. Response contains path array with node IDs and depths
4. Feed path into `useTracingOverlay` → highlights path, dims everything else
5. Path nodes get depth-based opacity (closer = brighter)
6. "Clear Trace" button appears in toolbar

**Trace Across Systems:**
- Backend CTE already crosses system boundaries
- When trace path includes nodes from other systems, show those systems' nodes too
- Gateway nodes become "trace continuation" markers

**Implementation:**
- Add context menu (right-click) to equipment nodes (~60 lines)
- Wire `startTrace()` action in store to API call (~40 lines)
- Feed API response into `setTraceResult()` → overlay auto-activates
- ~120 lines total (mostly wiring, overlay rendering already exists)

#### 13B. Isolation Boundary
**User Flow:**
1. Right-click equipment → "Find Isolation Boundary"
2. Frontend calls `POST /api/v1/topology/isolation` with `{ equipmentId }`
3. Response: `{ boundaryValves, affectedEquipment, affectedLines, isolationZone }`
4. Feed into `useIsolationOverlay`:
   - Boundary valves highlighted in RED with "CLOSE" label
   - Affected equipment highlighted in ORANGE
   - Everything outside boundary dimmed to 20% opacity
5. Isolation summary panel shows:
   - Valve lineup (list of valves to close/blind)
   - Affected equipment count
   - Affected lines

**Implementation:**
- Wire isolation API call from context menu or detail panel (~40 lines)
- Feed response into `setOverlayData({ isolation: ... })` (~20 lines)
- Isolation summary panel component (~80 lines)
- ~140 lines total

#### 13C. Corrosion Overlay (Data Placeholder)
- Currently no corrosion data source exists
- Add mock corrosion data based on `corrosion_loop` field in equipment table
- Map corrosion_loop → severity (placeholder logic: loops with "S" prefix = severe, etc.)
- When real corrosion data API exists, just swap the data source

**Implementation:**
- Mock data generator based on equipment corrosion_loop field (~30 lines)
- Wire to `setOverlayData({ corrosion: ... })` on overlay toggle (~20 lines)

---

### Session 14: Polish & Advanced Interactions
**Theme**: Professional-grade UX refinements

#### 14A. Multi-Select & Batch Actions
- Ctrl+Click to add/remove nodes from selection
- Shift+Drag to box-select
- Selection toolbar appears: "Trace Selected", "Show Common Lines", "Compare Properties"

#### 14B. Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+K` | Focus search |
| `Escape` | Close panel / clear selection / exit draft mode |
| `1` / `2` / `3` | Switch to Overview / System / Detail zoom |
| `T` | Toggle trace mode |
| `I` | Toggle isolation mode |
| `D` | Toggle drafting mode |
| `X` | Toggle cross-references |
| `F` | Fit view |

#### 14C. Right-Click Context Menu
Context-sensitive menu on nodes:
- **Equipment**: Trace Up, Trace Down, Find Isolation, Show on P&ID, Highlight Line, Properties
- **Instrument**: Show Loop, Show on P&ID, Properties
- **Gateway**: Navigate to System, Trace Across Boundary
- **CollapsedGroup**: Expand System, Show System P&IDs, Compare With...

#### 14D. Layout Persistence & Manual Arrangement
- "Save Layout" button → calls `PUT /api/v1/topology/layout/:systemId`
- Drag nodes to rearrange → positions saved on drop
- "Reset Layout" → re-runs ELK from scratch
- "Pin Node" → prevents ELK from moving a manually positioned node

#### 14E. Canvas Export
- "Export as SVG" button in toolbar
- "Export as PNG" button (uses html-to-image library)
- Includes title block with: system name, platform, date, revision
- Respects current zoom level and filter state

---

## Session Dependency Graph

```
Session 10 (Foundation)
├── 10A: Node Detail Panel          ← prerequisite for trace/isolation UI
├── 10B: Canvas Search & Filter     ← standalone
└── 10C: Zoom Controls Fix          ← standalone (quick win)
         │
Session 11 (Relationships)
├── 11A: Boundary Edges             ← needs backend endpoint
├── 11B: Sheet Panel                ← uses existing API
└── 11C: Cross-System Trace         ← extends 10A detail panel
         │
Session 12 (Lines & Drafting)
├── 12A: Line Highlighting          ← extends 10A (line detail)
└── 12B: Drafting View              ← major new feature
         │
Session 13 (Overlays → Real Data)
├── 13A: Tracing (wired)            ← depends on 10A (detail panel has trace buttons)
├── 13B: Isolation (wired)          ← depends on 10A
└── 13C: Corrosion (placeholder)    ← standalone
         │
Session 14 (Polish)
├── 14A: Multi-Select               ← extends 10A
├── 14B: Keyboard Shortcuts          ← standalone
├── 14C: Context Menus               ← extends 10A + 13A/B
├── 14D: Layout Persistence          ← uses existing backend
└── 14E: Canvas Export               ← standalone
```

**Critical Path**: Session 10 (especially 10A: Detail Panel) is the foundation.
Everything else builds on having a detail panel where actions can be triggered.

---

## Priority Recommendations

### Must-Have (Sessions 10-11)
These fix the core usability gaps the user identified:
1. Node Detail Panel — makes clicking meaningful
2. Canvas Search — find anything without leaving canvas
3. Zoom Controls — fix the broken indicator
4. Boundary Edges — see system connections in overview
5. Sheet Panel — see P&ID relationships

### Should-Have (Sessions 12-13)
These enable real engineering workflows:
6. Line Highlighting — the natural navigation model
7. Drafting View — custom compositions from system inventory
8. Tracing (wired to API) — production upstream/downstream analysis
9. Isolation (wired to API) — safety-critical maintenance planning

### Nice-to-Have (Session 14)
Polish that makes it professional:
10. Multi-Select & Batch Actions
11. Keyboard Shortcuts
12. Context Menus
13. Layout Persistence
14. Canvas Export

---

## Answering: "How Do I Draft Using Components Already Linked to This System?"

The **Drafting View** (Session 12B) is the answer. Here's the concept:

### Current Problem
When you open a system, you see ALL equipment, lines, and instruments in that system.
For a complex system like PV019 (8 equipment, 5 lines, 7 instruments), that's manageable.
But for larger systems (20+ equipment, 10+ lines), the view becomes cluttered.

### Solution: Drafting Mode
1. **Toggle "Draft" mode** in toolbar
2. **Left panel shows system inventory** — all lines, equipment, instruments belonging to this system
3. **Check/uncheck items** to include/exclude from canvas
4. **Canvas updates in real-time** — only shows selected items with proper ELK layout
5. **Save as named view** — "PV019 — Main Production" vs "PV019 — Safety Systems Only"

### Key Principle
You're NOT creating new components. You're **selecting from the existing system inventory**
to compose a focused view. The database already knows:
- Which lines belong to this system (`lines.system_id`)
- Which equipment is on each line (`equipment.line_id`)
- Which instruments monitor each line (`instruments.line_id`)
- How they connect (`topology_edges`)

The drafting view just lets you pick which subset to display.

### Future Extension
Once drafting is solid, it becomes the foundation for:
- **P&ID Sheet Generation**: draft a view → export as a traditional P&ID drawing
- **HAZOP Scope Definition**: draft shows exactly which equipment is in scope
- **Isolation Planning**: draft shows the specific equipment to be isolated
- **Maintenance Window**: draft shows equipment affected by a planned shutdown
