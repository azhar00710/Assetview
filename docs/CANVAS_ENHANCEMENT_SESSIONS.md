# Canvas Enhancement Sessions — Instructions

> **Controller branch**: `claude/switch-launcher-docs-branch-46kZg`
> Sessions 10-14 build on the completed ISA 5.1 redesign (Sessions 6-9).
> After each session: work merges back here → push to GitHub → next session starts from here.

---

## DEPENDENCY MAP

```
Session 10 (Interactivity Foundation)   ← START HERE
     ↓
Session 11 (System Relationships)       ← needs Session 10
     ↓
Session 12 (Lines & Drafting)           ← needs Session 11
     ↓
Session 13 (Tracing & Isolation)        ← needs Session 12
     ↓
Session 14 (Polish & Advanced)          ← needs Session 13
```

**All sessions are SEQUENTIAL** — each builds on the previous.

---

## SESSION 10: Canvas Interactivity Foundation

**Goal**: Make every click meaningful — detail panels, search, zoom controls.

```
=== START SESSION 10 ===

REPO: AssetView — oil & gas canvas with ISA 5.1 symbols (Sessions 6-9 complete).
CONTROLLER BRANCH: claude/switch-launcher-docs-branch-46kZg

== GIT SETUP (do first) ==
git fetch origin claude/switch-launcher-docs-branch-46kZg
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg

== CONTEXT (read these files before working) ==
- frontend/src/components/canvas/SystemCanvas.jsx
- frontend/src/components/canvas/CanvasToolbar.jsx
- frontend/src/components/canvas/nodes/EquipmentNode.jsx
- frontend/src/components/canvas/nodes/InstrumentNode.jsx
- frontend/src/canvas/store/useCanvasStore.js

== WHAT TO BUILD ==

TASK A: Node Detail Panel
New file: frontend/src/components/canvas/NodeDetailPanel.jsx
- Slides in from right, 320px wide, dark background (#111D14)
- Close on backdrop click or Escape key
- Equipment fields: Tag, Type, Criticality (badge), SIL Level, Line, System, P&IDs, Corrosion Loop, Inspection Group
- Instrument fields: Tag, Type, Range (rangeMin–rangeMax rangeUnit), Set Point, SCADA Tag, Loop Number, Signal Type, Line, P&IDs
- Action buttons: "Trace Upstream", "Trace Downstream", "Find Isolation", "Show on P&ID", "Highlight Line"
- Data source: node.data fields already on each node (no new API needed for initial render)

New file: frontend/src/hooks/useEntityDetail.js
- Hook: useEntityDetail(entityId, entityType)
- Calls GET /api/v1/equipment/:id/detail OR GET /api/v1/instruments/:id/detail
- Returns { entity, pnids, line } — enriched detail with P&ID appearances

New backend routes (add to existing route files):
- GET /api/v1/equipment/:id/detail → equipment row + joined pnid_equipment + line info
- GET /api/v1/instruments/:id/detail → instrument row + joined pnid_instrument + line info

Wire to canvas: in SystemCanvas.jsx, onNodeClick → setSelectedNode(node) → renders NodeDetailPanel

TASK B: Canvas Search & Filter
New file: frontend/src/components/canvas/CanvasSearch.jsx
- Search box in toolbar (Cmd+K / Ctrl+K shortcut)
- Searches: equipment tags, instrument tags, line numbers, equipment types
- Results dropdown: type icon + tag + system name
- Click result → reactFlowInstance.fitView({ nodes: [matchedNodeId] }) + open detail panel
- Uses existing GET /api/v1/search?q=...&platform_id=... endpoint

Filter chips below search:
- By line (show only nodes on selected line)
- By equipment type (valve/pump/vessel/header/etc.)
- By criticality (high/medium/low)
- "Clear all" button
- Wire filter state to useCanvasStore filterState slice

TASK C: Zoom Level Controls Fix
Modify SystemCanvas.jsx zoom level indicator (bottom-left):
- Click "Overview" → reactFlowInstance.zoomTo(0.3, { duration: 300 })
- Click "System" → reactFlowInstance.zoomTo(0.8, { duration: 300 })
- Click "Detail" → reactFlowInstance.zoomTo(1.5, { duration: 300 })
- Active level: filled dot, others: outline dot
- ~30 lines of changes

== SELF-TEST ==
1. cd frontend && npm run build — MUST pass with zero errors
2. Click an equipment node → NodeDetailPanel slides in from right
3. Click an instrument node → shows instrument fields
4. Escape key closes panel
5. Search box focuses with Ctrl+K
6. Clicking Overview/System/Detail smoothly zooms canvas

== SAVE WORK ==
git add frontend/ backend/
git commit -m "feat(canvas): session 10 — node detail panel, search, zoom controls"
cd frontend && npm run build
git add -f frontend/dist/
git commit -m "build: production bundle for session 10"
git push -u origin claude/switch-launcher-docs-branch-46kZg

=== END SESSION 10 ===
```

---

## SESSION 11: System Relationships & Cross-System Navigation

**Goal**: See the big picture — how systems connect, boundary flows, P&ID sheets.

```
=== START SESSION 11 ===

REPO: AssetView — canvas with detail panel + search (Session 10 complete).
CONTROLLER BRANCH: claude/switch-launcher-docs-branch-46kZg

== GIT SETUP ==
git fetch origin claude/switch-launcher-docs-branch-46kZg
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg

== CONTEXT (read before working) ==
- frontend/src/components/canvas/SystemCanvas.jsx
- frontend/src/canvas/hooks/useTopologyData.js
- frontend/src/components/canvas/edges/BoundaryEdge.jsx
- frontend/src/components/canvas/NodeDetailPanel.jsx (from Session 10)
- backend/src/services/topology/topologyQueries.js
- backend/src/routes/topology.js

== WHAT TO BUILD ==

TASK A: Boundary Edges in Overview Mode
New backend endpoint:
- GET /api/v1/topology/boundaries?platform_id=...
- Query topology_edges WHERE edge_type = 'boundary'
- Group by (from_system_id, to_system_id) → unique system pairs
- Return: [{ fromSystemId, toSystemId, edgeCount, description, edgeType }]

Frontend (useTopologyData.js):
- In overview builder, fetch /api/v1/topology/boundaries?platform_id=...
- Draw BoundaryEdge between CollapsedGroupNodes
- Edge label: "{edgeCount} connections"
- Color: process=accent (#3BE494), utility=secondary (#2D33E0), safety=safety (#E74C3C)
- Click boundary edge → tooltip listing which equipment connects across the boundary

TASK B: P&ID Sheet Relationships Panel
New file: frontend/src/components/canvas/SheetPanel.jsx
- Toggle button in CanvasToolbar: "Sheets" icon
- Panel appears as bottom drawer (200px height) or right sidebar tab
- In system view: list of P&IDs for this system (drawing number, title, revision, status badge)
- Click P&ID item → opens PnidViewer for that sheet
- Equipment/instruments on that sheet highlighted on canvas
- Uses: GET /api/v1/pnids?system_id=...&include_xref=true

TASK C: Cross-System Trace View
Extend frontend/src/canvas/hooks/useTracingOverlay.js:
- Handle cross-system trace results (path nodes from multiple systems)
- When trace crosses system boundary, show gateway nodes as "trace continuation" markers
- Gateway node gets pulsing animation when it's on the trace path
- "Trace Across Systems" action: add to gateway node onClick in SystemCanvas.jsx
- Calls GET /api/v1/topology/downstream/:entityId
- Path nodes: accent green glow, non-path nodes: 20% opacity

== SELF-TEST ==
1. cd frontend && npm run build — MUST pass
2. Overview mode shows edges between system nodes (BoundaryEdge)
3. Sheets panel opens from toolbar, lists P&IDs for current system
4. Click P&ID in panel → PnidViewer opens
5. Cross-system trace dims non-path nodes

== SAVE WORK ==
git add frontend/ backend/
git commit -m "feat(canvas): session 11 — boundary edges, sheet panel, cross-system trace"
cd frontend && npm run build
git add -f frontend/dist/
git commit -m "build: production bundle for session 11"
git push -u origin claude/switch-launcher-docs-branch-46kZg

=== END SESSION 11 ===
```

---

## SESSION 12: Line-Based Navigation & Drafting View

**Goal**: Navigate by line (the natural engineering mental model) and compose custom views.

```
=== START SESSION 12 ===

REPO: AssetView — canvas with system relationships (Session 11 complete).
CONTROLLER BRANCH: claude/switch-launcher-docs-branch-46kZg

== GIT SETUP ==
git fetch origin claude/switch-launcher-docs-branch-46kZg
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg

== CONTEXT (read before working) ==
- frontend/src/components/canvas/edges/PipeEdge.jsx
- frontend/src/components/canvas/NodeDetailPanel.jsx
- frontend/src/components/canvas/CanvasToolbar.jsx
- frontend/src/canvas/hooks/useTopologyData.js
- frontend/src/canvas/store/useCanvasStore.js
- backend/src/routes/lines.js

== WHAT TO BUILD ==

TASK A: Line Highlighting
Pipe edge interaction in PipeEdge.jsx:
- onMouseEnter → highlight entire line path (all edges + equipment sharing lineId)
- onClick → select line, open line detail in NodeDetailPanel
- Highlight style: thicker stroke (4px → 6px), accent color glow
- Dimming: all nodes/edges NOT on this line → 30% opacity

Line detail panel (extend NodeDetailPanel.jsx):
- Line number, service, nominal size, pipe class, material
- Design pressure / design temperature
- All equipment on this line (clickable list → select that node)
- All P&IDs this line appears on (clickable → open sheet)
- Continuation info (if line continues to another sheet/system)

New backend endpoint:
- GET /api/v1/lines/:id/detail → line row + equipment array + pnid array + continuation info

Line color mode toggle in CanvasToolbar:
- Toggle: color all edges by line_id (each line gets a unique color from palette)
- Off: edges revert to default pipe color

Add lineId to topology edge data:
- In topologyQueries.js, include line_id in edge SELECT
- Frontend: edge.data.lineId available for hover/click grouping

TASK B: Drafting View
New file: frontend/src/components/canvas/DraftingPanel.jsx (~250 lines)
- Toggle "Draft" button in CanvasToolbar
- Left panel (300px) with three tabs: Lines | Equipment | Instruments
- Lines tab: all lines in this system with checkboxes (data from GET /api/v1/lines?system_id=...)
- Equipment tab: equipment grouped by line (GET /api/v1/equipment?system_id=...)
- Instruments tab: instruments grouped by line (GET /api/v1/instruments?system_id=...)
- Check/uncheck → canvas instantly updates (only selected items shown)
- ELK re-layouts the selected subset
- "Save Draft" → persist selection to localStorage as named view
- "Reset" → show all items (exit draft filter)

New file: frontend/src/hooks/useDraftingMode.js
- Manages selectedEntityIds Set
- Filters topology nodes/edges to only include selected IDs
- Provides: { isDrafting, selectedIds, toggleEntity, saveDraft, resetDraft }

Modify useTopologyData.js:
- Accept optional entityFilter parameter (Set of entity IDs)
- When filter is set, only return nodes/edges matching those IDs

== SELF-TEST ==
1. cd frontend && npm run build — MUST pass
2. Hover a pipe edge → entire line path highlights
3. Click pipe edge → line detail shows in panel with equipment list
4. Click "Draft" button → left panel appears with Lines/Equipment/Instruments tabs
5. Uncheck a line → those nodes disappear from canvas
6. "Save Draft" → persists to localStorage, survives page refresh

== SAVE WORK ==
git add frontend/ backend/
git commit -m "feat(canvas): session 12 — line highlighting and drafting view"
cd frontend && npm run build
git add -f frontend/dist/
git commit -m "build: production bundle for session 12"
git push -u origin claude/switch-launcher-docs-branch-46kZg

=== END SESSION 12 ===
```

---

## SESSION 13: Tracing & Isolation (Wire the Overlays)

**Goal**: Connect the existing overlay visual system to real backend data.

```
=== START SESSION 13 ===

REPO: AssetView — canvas with line navigation + drafting (Session 12 complete).
CONTROLLER BRANCH: claude/switch-launcher-docs-branch-46kZg

== GIT SETUP ==
git fetch origin claude/switch-launcher-docs-branch-46kZg
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg

== CONTEXT (read before working) ==
- frontend/src/canvas/overlays/useTracingOverlay.js
- frontend/src/canvas/overlays/useIsolationOverlay.js
- frontend/src/canvas/overlays/useCorrosionOverlay.js
- frontend/src/canvas/store/useCanvasStore.js
- frontend/src/components/canvas/NodeDetailPanel.jsx
- backend/src/services/topology/topologyQueries.js

== WHAT TO BUILD ==

TASK A: Upstream/Downstream Tracing (Wire to Backend)
In NodeDetailPanel.jsx, wire the "Trace Upstream" / "Trace Downstream" buttons:
- Call GET /api/v1/topology/upstream/:entityId or /downstream/:entityId
- Feed response path array into useCanvasStore: setTraceResult(pathNodeIds)
- useTracingOverlay reads traceResult → highlights path, dims everything else
- Depth-based opacity: depth 0 (start) = 100%, depth 1 = 90%, depth 2 = 80%, etc.
- Toolbar shows "Clear Trace" button when trace is active

Add context menu (right-click) to EquipmentNode.jsx:
- "Trace Upstream" → same as detail panel button
- "Trace Downstream" → same as detail panel button
- "Find Isolation" → same as isolation button
- ~60 lines, use a simple absolute-positioned div

Cross-system trace:
- When API response includes nodes from other systems, add those system IDs to
  useCanvasStore: setVisibleCrossSystems([systemId1, systemId2])
- Canvas fetches and renders those systems' topologies at 40% opacity
- Gateway nodes on the path pulse with accent color

TASK B: Isolation Boundary (Wire to Backend)
In NodeDetailPanel.jsx, wire "Find Isolation" button:
- Call POST /api/v1/topology/isolation with { equipmentId: node.data.id }
- Response: { boundaryValves, affectedEquipment, affectedLines, isolationZone }
- Feed into useCanvasStore: setIsolationResult(response)
- useIsolationOverlay reads isolationResult:
  - Boundary valves: RED highlight + "CLOSE" label overlay
  - Affected equipment: ORANGE highlight
  - Non-isolation-zone nodes: 20% opacity

New component: IsolationSummaryPanel.jsx
- Appears below NodeDetailPanel when isolation is active
- Shows: valve lineup list (each valve to close/blind), affected equipment count, affected lines
- "Clear Isolation" button

TASK C: Corrosion Overlay (Data Placeholder)
In frontend/src/canvas/overlays/useCorrosionOverlay.js:
- When corrosion toggle is ON, generate mock data from equipment.corrosion_loop field
- Severity mapping: loops with "H" prefix → high (red), "M" prefix → medium (orange), others → low (yellow)
- Apply color overlay to equipment nodes based on severity
- Add comment: "// TODO: replace mock with GET /api/v1/corrosion/equipment?system_id=..."

Wire corrosion toggle in CanvasToolbar.jsx to call useCorrosionOverlay.activate()

== SELF-TEST ==
1. cd frontend && npm run build — MUST pass
2. Click equipment node → detail panel shows
3. Click "Trace Downstream" → path highlights with depth-based opacity
4. "Clear Trace" button appears in toolbar during active trace
5. Right-click equipment → context menu appears with trace options
6. Click "Find Isolation" → boundary valves turn red, affected equipment orange
7. Corrosion toggle → nodes get color overlay based on corrosion_loop field

== SAVE WORK ==
git add frontend/ backend/
git commit -m "feat(canvas): session 13 — wire tracing, isolation, corrosion overlays to API"
cd frontend && npm run build
git add -f frontend/dist/
git commit -m "build: production bundle for session 13"
git push -u origin claude/switch-launcher-docs-branch-46kZg

=== END SESSION 13 ===
```

---

## SESSION 14: Polish & Advanced Interactions

**Goal**: Professional-grade UX — multi-select, keyboard shortcuts, layout persistence, export.

```
=== START SESSION 14 ===

REPO: AssetView — canvas with wired tracing/isolation overlays (Session 13 complete).
CONTROLLER BRANCH: claude/switch-launcher-docs-branch-46kZg

== GIT SETUP ==
git fetch origin claude/switch-launcher-docs-branch-46kZg
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg

== CONTEXT (read before working) ==
- frontend/src/components/canvas/SystemCanvas.jsx
- frontend/src/components/canvas/CanvasToolbar.jsx
- frontend/src/canvas/store/useCanvasStore.js
- frontend/src/components/canvas/nodes/ (all node files)

== WHAT TO BUILD ==

TASK A: Multi-Select & Batch Actions
In SystemCanvas.jsx:
- Ctrl+Click → add/remove node from selection set
- Shift+Drag → React Flow box-select (already supported, just enable selectionOnDrag)
- When 2+ nodes selected → show SelectionToolbar above canvas:
  "Trace Selected" | "Show Common Lines" | "Compare Properties" | "Clear Selection"
- "Trace Selected" → trace from first selected to last selected (show path between them)
- "Show Common Lines" → highlight edges shared by all selected nodes

TASK B: Keyboard Shortcuts
Add global keydown listener in SystemCanvas.jsx (useEffect on mount):

| Key          | Action                                              |
|--------------|-----------------------------------------------------|
| Ctrl/Cmd+K   | Focus canvas search box                             |
| Escape       | Close panel / clear selection / exit draft mode     |
| 1            | Zoom to Overview (< 0.45)                           |
| 2            | Zoom to System (0.8)                                |
| 3            | Zoom to Detail (1.5)                                |
| T            | Toggle trace mode                                   |
| I            | Toggle isolation mode                               |
| D            | Toggle drafting mode                                |
| X            | Toggle cross-references                             |
| F            | Fit view (reactFlowInstance.fitView)                |

Show keyboard shortcut hint tooltip on each toolbar button (title attribute).

TASK C: Right-Click Context Menu (Full)
Extend context menu from Session 13 with full per-node-type options:

Equipment node context menu:
- Trace Upstream | Trace Downstream | Find Isolation | Show on P&ID | Highlight Line | Properties

Instrument node context menu:
- Show Loop | Show on P&ID | Properties

Gateway node context menu:
- Navigate to System | Trace Across Boundary

CollapsedGroup node context menu:
- Expand System | Show System P&IDs | Compare With...

Use a shared ContextMenu.jsx component (portal-rendered, closes on outside click).

TASK D: Layout Persistence & Manual Arrangement
Wire the existing layout persistence API:
- Drag node to new position → onNodeDragStop → call PUT /api/v1/topology/layout/:systemId
  with updated { nodeId: { x, y } } positions
- "Save Layout" button in toolbar → force-saves current positions
- "Reset Layout" button → re-runs ELK, clears saved positions
- "Pin Node" in context menu → marks node as manually positioned, ELK won't move it
  (store pinned node IDs in layoutPersistence.js, send as ELK nodeConstraints)

Load persisted positions on canvas init:
- GET /api/v1/topology/layout/:systemId → apply saved x,y to matching nodes
- If a node has no saved position, let ELK place it normally

TASK E: Canvas Export
Add to CanvasToolbar.jsx:
- "Export SVG" button → uses React Flow's getNodes/getEdges + SVG serialization
- "Export PNG" button → uses html-to-image library (npm install html-to-image)
  target: the React Flow viewport DOM element
- Both exports include title block (top-left corner):
  System Name | Platform | Date (today) | Revision: A
- Export respects current zoom/filter/draft state

Install dependency:
cd frontend && npm install html-to-image

== SELF-TEST ==
1. cd frontend && npm run build — MUST pass
2. Ctrl+Click two nodes → selection toolbar appears
3. Press "1" key → canvas zooms to overview
4. Press "Escape" → closes any open panel
5. Right-click equipment node → full context menu appears
6. Drag node → position auto-saves (check network tab for PUT request)
7. "Export PNG" → downloads PNG of current canvas view with title block

== SAVE WORK ==
git add frontend/ backend/
git commit -m "feat(canvas): session 14 — multi-select, keyboard shortcuts, context menu, layout persistence, export"
cd frontend && npm run build
git add -f frontend/dist/
git commit -m "build: production bundle for session 14"
git push -u origin claude/switch-launcher-docs-branch-46kZg

=== END SESSION 14 ===
```

---

## RECOVERY — If a session fails

```
=== RECOVERY ===
git fetch origin claude/switch-launcher-docs-branch-46kZg
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg
git log --oneline -10
git status

Then re-paste the failed session block above.
=== END RECOVERY ===
```

---

## AFTER ALL SESSIONS — Final Validation

```
=== FINAL CHECK ===
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg
cd frontend && npm run build && echo "BUILD: PASS" || echo "BUILD: FAIL"
echo "=== Canvas Files ==="
find frontend/src/components/canvas -type f | sort
echo "=== Verify overlays wired ==="
grep -l "setTraceResult\|setIsolationResult" frontend/src/components/canvas/**/*.jsx
echo "=== Verify export ==="
grep -l "html-to-image" frontend/src/components/canvas/**/*.jsx
=== END CHECK ===
```

---

## QUICK REFERENCE

| Session | Focus | Depends On | Key Files |
|---------|-------|------------|-----------|
| 10 | Interactivity Foundation | Sessions 6-9 | NodeDetailPanel.jsx, CanvasSearch.jsx, zoom controls |
| 11 | System Relationships | Session 10 | BoundaryEdge wiring, SheetPanel.jsx, cross-system trace |
| 12 | Lines & Drafting | Session 11 | PipeEdge line highlight, DraftingPanel.jsx |
| 13 | Overlays → Real Data | Session 12 | useTracingOverlay wired, useIsolationOverlay wired |
| 14 | Polish & Advanced | Session 13 | Multi-select, keyboard shortcuts, export |
