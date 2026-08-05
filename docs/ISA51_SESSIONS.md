# ISA 5.1 P&ID Canvas Redesign — Session Instructions

> **Controller branch**: `claude/switch-launcher-docs-branch-46kZg`
> After each session: work merges back here → push to GitHub → next session starts from here.

---

## DEPENDENCY MAP

```
Session 6 (Symbol Library)     ← no dependency, START HERE
     ↓
Session 7 (Node Components)    ← needs Session 6
     ↓
Session 8 (Layout Engine)      ← needs Session 7
     ↓
Session 9 (Polish & Testing)   ← needs Session 8
```

**All sessions are SEQUENTIAL** — each builds on the previous.
No parallel sessions for ISA 5.1 work.

---

## SESSION 6: ISA 5.1 SVG Symbol Library

**Goal**: Create standalone, reusable ISA 5.1 symbol library. Pure SVG, no integration.

```
=== START SESSION 6 ===

REPO: This is the AssetView project — oil & gas asset navigation tool.
CONTROLLER BRANCH: claude/switch-launcher-docs-branch-46kZg

== GIT SETUP (do first) ==
git fetch origin claude/switch-launcher-docs-branch-46kZg
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg

== WHAT TO BUILD ==

FILE 1: frontend/src/lib/pid-symbols.js
Create SVG symbol components as pure functions returning SVG JSX.
Each symbol: standard viewBox (80×80 equipment, 40×40 instruments), connection points (left/right for inline, top/bottom for taps), ISA 5.1 line-art only (no filled backgrounds), accepts color/size/strokeWidth props.

Equipment symbols needed (map to DB equipment_type values):
| DB Type         | ISA Symbol              | Shape                                      |
|-----------------|-------------------------|---------------------------------------------|
| Christmas Tree  | Wellhead assembly       | Stack of valves with wing valves             |
| Choke Valve     | Adjustable restriction  | Bow-tie with adjustable arrow on stem        |
| Safety Valve    | PSV/PRV                 | Bow-tie with spring/weight on bonnet         |
| Spectacle Blind | Figure-8 blind          | Two circles connected (open/closed)          |
| Header          | Manifold                | Horizontal pipe with multiple branch nozzles |
| Vessel          | Pressure vessel         | Cylinder with hemispherical heads            |
| Package         | Packaged unit           | Dashed rectangle with label                  |
| Pump            | Centrifugal pump        | Circle with discharge triangle               |
| Separator       | Separator vessel        | Vertical vessel with internal baffles        |
| Heat Exchanger  | Shell & tube            | Circle with S-curve inside                   |
| Tank            | Storage tank            | Cylinder open top                            |
| Filter/Strainer | Y-strainer              | Y-shape or cone                              |
| Compressor      | Compressor              | Circle with crossed diagonals                |

Valve symbols (subset of equipment):
| Type            | Shape                                         |
|-----------------|-----------------------------------------------|
| Gate Valve      | Bow-tie (two triangles point-to-point)         |
| Globe Valve     | Bow-tie with horizontal line through center    |
| Ball Valve      | Bow-tie with filled circle                     |
| Check Valve     | Bow-tie with single triangle filled            |
| Control Valve   | Bow-tie with diaphragm actuator on top         |
| Butterfly Valve | Bow-tie with vertical line                     |
| Needle Valve    | Bow-tie with pointed stem                      |

Instrument symbols (ISA 5.1 bubbles):
| Location      | Shape                                    |
|---------------|------------------------------------------|
| Field-mounted | Circle (plain)                           |
| Panel-mounted | Circle with horizontal line through center|
| DCS/SCADA     | Circle with horizontal dashed line       |
| Safety (SIS)  | Circle with diamond or double border     |

Instrument letter codes: P=Pressure, T=Temperature, F=Flow, L=Level.
Second letter: T=Transmitter, I=Indicator, C=Controller, V=Valve, S=Switch.

FILE 2: frontend/src/lib/pid-symbol-map.js
Maps DB type strings to symbol components:
- getEquipmentSymbol(equipmentType) → returns SVG component
- getInstrumentSymbol(instrumentType, location) → returns SVG component
- getValveSymbol(valveType) → returns SVG component

== SELF-TEST ==
1. cd frontend && npm run build — MUST pass with zero errors
2. Verify both files export correctly: all equipment types have symbols, all instrument types have symbols

== SAVE WORK ==
git add frontend/src/lib/pid-symbols.js frontend/src/lib/pid-symbol-map.js
git commit -m "feat(canvas): session 6 — ISA 5.1 SVG symbol library"
cd frontend && npm run build
git add -f frontend/dist/
git commit -m "build: production bundle for session 6"
git push -u origin claude/switch-launcher-docs-branch-46kZg

=== END SESSION 6 ===
```

---

## SESSION 7: P&ID-Style Node Components

**Goal**: Replace card-style nodes with ISA 5.1 symbol-based React Flow nodes.

```
=== START SESSION 7 ===

REPO: AssetView — oil & gas asset navigation tool with React Flow canvas.
CONTROLLER BRANCH: claude/switch-launcher-docs-branch-46kZg

== GIT SETUP ==
git fetch origin claude/switch-launcher-docs-branch-46kZg
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg

== CONTEXT (read these files before working) ==
- frontend/src/lib/pid-symbols.js — ISA symbol library (from Session 6)
- frontend/src/lib/pid-symbol-map.js — type-to-symbol mapper
- frontend/src/components/canvas/nodes/ — current card-style nodes to REWRITE
- frontend/src/components/canvas/SystemCanvas.jsx — main canvas (uses INLINE node definitions — must switch to external)

== WHAT TO BUILD ==

TASK A: Rewrite EquipmentNode.jsx
File: frontend/src/components/canvas/nodes/EquipmentNode.jsx
New design — ISA symbol inline on pipe, NOT a card:
- Symbol is ISA 5.1 SVG from pid-symbols.js (use getEquipmentSymbol)
- Tag label above (monospace, e.g., "CV-019S")
- Type label below (smaller, e.g., "Choke Valve")
- Criticality = colored dot (not badge card)
- SIL level = small label
- Handles on left/right edges centered vertically
- Light background — P&IDs are on white
- ~120×100px at 1x zoom
- React.memo with shallow comparison
- Support visual states: highlighted (glow), dimmed (opacity 0.3), selected (accent ring)

TASK B: Rewrite InstrumentNode.jsx
File: frontend/src/components/canvas/nodes/InstrumentNode.jsx
ISA 5.1 bubble design:
- Circle with ISA letter code in top half (e.g., "PT")
- Loop number in bottom half (e.g., "01901")
- Horizontal line dividing the circle
- Field/panel/DCS circle style from getInstrumentSymbol
- Handle: top (connects to pipe via signal line)
- Size: ~44×44 circle
- Same visual states as EquipmentNode

TASK C: Rewrite SystemGatewayNode.jsx → Off-Page Connector
File: frontend/src/components/canvas/nodes/SystemGatewayNode.jsx
ISA 5.1 off-page connector:
- Pentagon/flag shape pointing in flow direction
- Contains target system code
- References P&ID sheet where line continues

TASK D: Update SystemCanvas.jsx
- Import node components from nodes/ directory (STOP using inline definitions)
- Import nodeRegistry.js for NODE_TYPES
- Import edgeRegistry.js for EDGE_TYPES (PipeEdge, SignalEdge, BoundaryEdge, UtilityEdge)
- Remove ALL inline EquipmentNode, InstrumentNode, GatewayNode definitions from SystemCanvas.jsx

== SELF-TEST ==
1. cd frontend && npm run build — MUST pass
2. Verify SystemCanvas.jsx has NO inline node definitions
3. Verify all node files use pid-symbols.js imports
4. Verify nodeRegistry exports: equipment, instrument, collapsedGroup, gateway, tee
5. Verify edgeRegistry exports: pipe, signal, boundary, utility

== SAVE WORK ==
git add frontend/
git commit -m "feat(canvas): session 7 — ISA 5.1 node components replacing card-style"
cd frontend && npm run build
git add -f frontend/dist/
git commit -m "build: production bundle for session 7"
git push -u origin claude/switch-launcher-docs-branch-46kZg

=== END SESSION 7 ===
```

---

## SESSION 8: P&ID-Style Layout Engine

**Goal**: Make layout look like a real P&ID — horizontal pipes, instruments below, orthogonal routing.

```
=== START SESSION 8 ===

REPO: AssetView — oil & gas canvas with ISA 5.1 symbols (from Sessions 6-7).
CONTROLLER BRANCH: claude/switch-launcher-docs-branch-46kZg

== GIT SETUP ==
git fetch origin claude/switch-launcher-docs-branch-46kZg
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg

== CONTEXT (read before working) ==
- frontend/src/hooks/useSystemLayout.js — current layout hook
- frontend/src/components/canvas/SystemCanvas.jsx — main canvas
- frontend/src/components/canvas/edges/PipeEdge.jsx — pipe edge component
- frontend/src/canvas/hooks/useLayout.js — layout hook from session 3

== WHAT TO BUILD ==

TASK A: Update ELK layout config for P&ID style
File: frontend/src/hooks/useSystemLayout.js (or frontend/src/canvas/hooks/useLayout.js)
ELK options for P&ID appearance:
- elk.algorithm: layered
- elk.direction: RIGHT (left-to-right flow — standard P&ID)
- elk.spacing.nodeNode: 60 (tighter — pipe segments)
- elk.layered.spacing.nodeNodeBetweenLayers: 150 (between process stages)
- elk.edgeRouting: ORTHOGONAL (right-angle routing like real pipes)
- elk.layered.nodePlacement.strategy: NETWORK_SIMPLEX
- elk.layered.crossingMinimization.strategy: LAYER_SWEEP

TASK B: Separate instrument placement
Instruments must be BELOW the main pipe run, connected by vertical signal lines.
Approach: assign ELK partition or layer constraints to instrument nodes so they render in a separate row below equipment.

TASK C: Pipe line labels on edges
Update PipeEdge.jsx to show line number labels:
- Format: 2"-JC26-2H-023-B6N-N (size-service-lineNo-class)
- Position: midpoint of pipe segment
- Style: small monospace text on white background pill

TASK D: Canvas background — LIGHT
Change canvas from dark to P&ID standard light:
- Background: #F5F7F7 (per CLAUDE.md spec)
- Grid: light gray dots or lines
- Node text colors: dark (black/dark gray)
- Note: rest of UI stays dark, only the canvas area is light

TASK E: Fix toolbar overlapping
In SystemCanvas.jsx:
- Move React Flow Controls to not overlap other elements
- Style MiniMap to bottom-right with proper margin
- Ensure zoom hint doesn't overlap Controls

== SELF-TEST ==
1. cd frontend && npm run build — MUST pass
2. Verify canvas background is #F5F7F7 (light)
3. Verify ELK config has RIGHT direction + ORTHOGONAL routing
4. Verify pipe edges have line number labels
5. Verify Controls/MiniMap don't overlap

== SAVE WORK ==
git add frontend/
git commit -m "feat(canvas): session 8 — P&ID-style layout engine with light canvas"
cd frontend && npm run build
git add -f frontend/dist/
git commit -m "build: production bundle for session 8"
git push -u origin claude/switch-launcher-docs-branch-46kZg

=== END SESSION 8 ===
```

---

## SESSION 9: Polish, Integration & Testing

**Goal**: Everything works together. Edge cases handled. Visual match to P&ID reference.

```
=== START SESSION 9 ===

REPO: AssetView — canvas now has ISA symbols + P&ID layout (Sessions 6-8).
CONTROLLER BRANCH: claude/switch-launcher-docs-branch-46kZg

== GIT SETUP ==
git fetch origin claude/switch-launcher-docs-branch-46kZg
git checkout claude/switch-launcher-docs-branch-46kZg
git pull origin claude/switch-launcher-docs-branch-46kZg

== CONTEXT (read before working) ==
- frontend/src/components/canvas/SystemCanvas.jsx
- frontend/src/components/canvas/nodes/ (all node files)
- frontend/src/components/canvas/edges/ (all edge files)
- frontend/src/canvas/mock/mockTopology.js
- frontend/src/canvas/hooks/useSemanticZoom.js

== WHAT TO BUILD ==

TASK A: Multi-line layout
When viewing a system with multiple lines (e.g., PV019 has 7 lines):
- Main production flowline at center
- Branch lines (drain, hydraulic, gas lift) splitting off at tee junctions
- Use TeeNode.jsx for pipe junctions

TASK B: Cross-system visualization
When X-Ref toggle is ON:
- Equipment/lines from other systems at 65% opacity
- Left border colored with owning system's color
- Off-page connectors link to other systems

TASK C: Semantic zoom polish
- OVERVIEW (<0.45x): Collapsed system blocks (already works)
- SYSTEM (0.45x–1.2x): ISA symbols WITHOUT instrument detail text
- DETAIL (>1.2x): Full ISA symbols with ALL labels, ranges, SCADA tags
- Smooth transitions between levels

TASK D: Edge cases
- Standalone equipment (no line_id — e.g., ESD-PLC, IA-PKG): show in "standalone" area
- Lines with no equipment: show as pipe stubs
- Empty systems: show gateway-only layout

TASK E: Visual verification
Run dev server (npm run dev) and verify:
- All 17 equipment render with correct ISA symbols
- All 12 instruments render as ISA bubbles with letter codes
- Pipe edges have line number labels
- Canvas background is light (#F5F7F7)
- Nodes flow left-to-right
- Instruments sit below pipe runs

== SELF-TEST ==
1. cd frontend && npm run build — MUST pass
2. cd frontend && npm run dev — verify no React errors in console
3. Visual check: canvas looks like a P&ID drawing, not a card diagram

== SAVE WORK ==
git add frontend/
git commit -m "feat(canvas): session 9 — polish, multi-line, cross-ref, edge cases"
cd frontend && npm run build
git add -f frontend/dist/
git commit -m "build: production bundle for session 9"
git push -u origin claude/switch-launcher-docs-branch-46kZg

=== END SESSION 9 ===
```

---

## VISUAL TARGET — What we're building

### Before (Current — Card Style)
```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ DHSV-019S│────▶│ PV019-XT │────▶│ CV-019S  │
│ Safety V │     │ Xmas Tree│     │ Choke V  │
│ high     │     │ high     │     │ high     │
└──────────┘     └──────────┘     └──────────┘
```

### After (ISA 5.1 Style)
```
                     PV019-XT        CV-019S         SPB-019S
                    ┌─┐              ╱╲              ○─○
DHSV-019S  ════════╡XT╞════════════╱CV╲════════════○ ○═══════▶ [PM →]
  ╱╲               └─┘            ╲  ╱              ○─○
 ╱PSV╲              │              ╲╱
 ╲  ╱           ┌──────┐           │
  ╲╱            │ PT   │       ┌──────┐
                │01901 │       │ TT   │
                └──────┘       │01901 │
                               └──────┘
```

Equipment = ISA symbols inline on pipe.
Instruments = circles below, connected by dashed signal lines.
Pipe = thick horizontal line with line number label.

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
find frontend/src -name "pid-symbols*" -o -name "pid-symbol-map*" | sort
find frontend/src/components/canvas -type f | sort
echo "=== Verify ISA symbols exist ==="
grep -l "getEquipmentSymbol\|getInstrumentSymbol" frontend/src/components/canvas/nodes/*.jsx
=== END CHECK ===
```

---

## QUICK REFERENCE

| Session | Focus | Depends On | Files Changed |
|---------|-------|------------|---------------|
| 6 | SVG Symbol Library | nothing | 2 new files in frontend/src/lib/ |
| 7 | Node Components | Session 6 | Rewrite 3 nodes + update SystemCanvas |
| 8 | Layout Engine | Session 7 | Layout config + PipeEdge + canvas bg |
| 9 | Polish & Testing | Session 8 | Multi-line, x-ref, zoom, edge cases |
