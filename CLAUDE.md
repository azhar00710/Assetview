# CLAUDE.md — AssetView

## Identity
- **Project**: AssetView — Intelligent Asset Environment for Oil & Gas Platforms
- **Owner**: GeoSoft | **Industry**: Oil & Gas — Upstream / Offshore
- **Stage**: Phase 3 — Canvas Enhancement (Sessions 10-14)

## Repo Structure
```
frontend/    # React 18 + Vite + Tailwind + React Flow + Zustand
backend/     # Fastify + Prisma ORM
database/    # PostgreSQL schema + seeds + migrations
docs/        # Plans, API spec, archived studies
```

## Tech Stack
Frontend: React 18, Vite, Tailwind, @xyflow/react (React Flow), ELK.js, Zustand, immer
Backend: Fastify, Prisma, PostgreSQL 15+, pg_trgm
Canvas state: Zustand (replaces useState scatter)
Layout: ELK.js layered+orthogonal in Web Worker
Graph traversal: PostgreSQL recursive CTEs (not JS BFS)

## Run Commands
```bash
docker compose up -d                          # DB
cd backend && npm install && npm run dev      # :3001
cd frontend && npm install && npm run dev     # :5173
cd frontend && npm run build                  # production bundle
```

## Env Vars
```
DATABASE_URL=postgresql://assetview:assetview@localhost:5432/assetview
PORT=3001
VITE_API_URL=http://localhost:3001/api/v1
```

## Database Model (essential rules)
- Hierarchy: concession → field → complex → platform → system
- Lines BELONG to systems (ownership) but APPEAR on P&IDs (display)
- Junction tables: pnid_system (has is_primary), pnid_line (has is_continuation), pnid_equipment, pnid_instrument
- topology_edges: explicit directed graph for canvas traversal
- canvas_layout: persisted node positions per system

## Frontend UI
- **Miller Columns**: SYSTEMS | P&IDs | LINES | EQUIPMENT | INSTRUMENTS — cascade filtering
- **Canvas**: primary interface — continuous system topology viewer (React Flow)
- **P&ID Viewer**: separate component, light background (#F5F7F7), linked via SelectionBus
- **Cross-refs**: 65% opacity, owning system color left border, X-Ref toggle
- **Dark mode default**. Canvas area always light.

## Canvas Architecture (current state after Sessions 1-5)
```
frontend/src/canvas/
├── contracts/     SelectionContract, CanvasAction, TopologyTypes, AIToolInterface
├── store/         useCanvasStore.js (Zustand — view, selection, tracing, overlays, layout)
├── mock/          mockTopology.js (WHT-5 platform test data)
├── hooks/         useTopologyData, useLayout, useSemanticZoom
├── overlays/      OverlayManager, useTracingOverlay, useIsolationOverlay, useCorrosionOverlay
└── layout/        layoutPersistence.js

frontend/src/components/canvas/
├── SystemCanvas.jsx        # Main React Flow wrapper
├── CanvasToolbar.jsx       # Overlay toggles, zoom controls
├── nodes/                  # EquipmentNode, InstrumentNode, CollapsedGroupNode, SystemGatewayNode, TeeNode + nodeRegistry
├── edges/                  # PipeEdge, SignalEdge, BoundaryEdge, UtilityEdge + edgeRegistry
└── layout/                 # elkLayout.js, layoutWorker.js

backend/src/services/topology/
├── topologyQueries.js      # Recursive CTE queries (getSystemTopology, traceUp/Down, isolation)
├── index.js                # Service wrapper
└── graphUtils.js           # DEPRECATED — old JS BFS
```

## Semantic Zoom Levels
- OVERVIEW (<0.45x): CollapsedGroupNodes only, cross-system edges
- SYSTEM (0.45x–1.2x): Equipment + pipe edges, hide instruments
- DETAIL (>1.2x): Everything — full labels, instruments, signal edges

## API Endpoints
```
GET  /api/v1/platforms/:id/systems
GET  /api/v1/pnids?system_id=&include_xref=
GET  /api/v1/lines?pnid_id=|system_id=
GET  /api/v1/equipment?line_id=|pnid_id=
GET  /api/v1/instruments?line_id=|pnid_id=
GET  /api/v1/topology/system/:systemId
GET  /api/v1/topology/upstream/:entityId
GET  /api/v1/topology/downstream/:entityId
POST /api/v1/topology/isolation
GET  /api/v1/topology/layout/:systemId
PUT  /api/v1/topology/layout/:systemId
```

## Design Colors
```
background=#0D1F17  panel=#111D14  card=#16352B  text=#D3DFE2  muted=#919A9B
accent=#3BE494  secondary=#2D33E0
process=#3BE494  utility=#2D33E0  safety=#E74C3C  instrument=#F39C12
Canvas background=#F5F7F7 (always light)
```

## Test Data
AD219 Abu Dhabi Offshore: 2 platforms (WHT-5/6), 14 systems, 24 P&IDs, 13 lines, 17 equipment, 12 instruments

## Current Phase: Canvas Enhancement (Sessions 10-14)
Goal: Make the canvas a fully interactive engineering workspace (detail panels, tracing, isolation, export).
Sessions 10-14 in docs/CANVAS_ENHANCEMENT_SESSIONS.md — copy-paste into Claude Code.
Sessions 6-9 reference (ISA 5.1 redesign, COMPLETE): docs/ISA51_SESSIONS.md
## Branching Rules
- **All new branches MUST branch from `main`**
- Workflow: `git checkout main && git pull && git checkout -b <new-branch>`
- After each session completes, merge the branch back into `main` via PR
