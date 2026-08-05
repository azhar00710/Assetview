# AssetView — Architecture & Methodology Guide

> **Version**: 2.0.0
> **Owner**: GeoSoft
> **Industry**: Oil & Gas — Upstream / Offshore
> **Last Updated**: 2026-03-13
> **Purpose**: Complete technical reference for rebuilding, debugging, or onboarding. If the chat session is lost, this document contains everything needed to continue.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack & Versions](#2-tech-stack--versions)
3. [Repository Structure](#3-repository-structure)
4. [Database Architecture](#4-database-architecture)
5. [Backend Architecture](#5-backend-architecture)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Design System](#7-design-system)
8. [API Specification](#8-api-specification)
9. [Data Flow & State Management](#9-data-flow--state-management)
10. [P&ID Visualization Architecture](#10-pid-visualization-architecture)
11. [Build, Run & Deploy](#11-build-run--deploy)
12. [Testing Strategy](#12-testing-strategy)
13. [Implementation Status & Roadmap](#13-implementation-status--roadmap)
14. [Troubleshooting Guide](#14-troubleshooting-guide)
15. [Key Design Decisions & Rationale](#15-key-design-decisions--rationale)

---

## 1. Project Overview

AssetView is an **Intelligent Asset Environment** for oil & gas platforms. It provides:

- **Miller Columns navigation** — 5-column cascade: Systems → P&IDs → Lines → Equipment → Instruments
- **P&ID viewer** — Drawing canvas with interactive equipment/instrument hotspots
- **Register views** — Full-width sortable/filterable tables for each entity type
- **Cross-reference (X-Ref) support** — Show assets from other systems at reduced opacity
- **Admin panel** — CRUD for all entities, hierarchy editing, import/export
- **AI Chat** (planned) — Claude-powered equipment queries
- **Real-time annotations** (planned) — WebSocket collaborative markups

### Core Concept: Lines BELONG to Systems but APPEAR on P&IDs

This is the most important architectural concept. A line is **owned** by a system (1:N relationship) but can **appear** on multiple P&ID drawings (M:N via junction table). Example: A Closed Drain line is owned by the Closed Drain system but appears on the Well PV019 P&ID because it's drawn on that sheet.

---

## 2. Tech Stack & Versions

### Runtime

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 22.22.0 | JavaScript runtime |
| npm | 10.9.4 | Package manager |
| PostgreSQL | 15-alpine | Database (Docker) |

### Backend Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `fastify` | ^5.0.0 | HTTP framework (fastest Node.js framework) |
| `@prisma/client` | ^6.0.0 | Type-safe ORM |
| `prisma` (dev) | ^6.0.0 | Schema management, migrations, studio |
| `@fastify/cors` | ^11.2.0 | Cross-origin resource sharing |
| `@fastify/static` | ^9.0.0 | Serve static files (P&ID images) |
| `@fastify/websocket` | ^11.2.0 | WebSocket support for real-time |
| `@anthropic-ai/sdk` | ^0.39.0 | Claude AI integration |
| `dotenv` | ^16.4.0 | Environment variable loading |

### Frontend Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^18.3.0 | UI framework |
| `react-dom` | ^18.3.0 | DOM rendering |
| `vite` | ^6.0.0 | Dev server & production bundler |
| `@vitejs/plugin-react` | ^4.3.0 | React Fast Refresh for Vite |
| `tailwindcss` | ^3.4.0 | Utility-first CSS |
| `postcss` | ^8.4.0 | CSS processing pipeline |
| `autoprefixer` | ^10.4.0 | Vendor prefix automation |
| `@tanstack/react-query` | ^5.0.0 | Server state management & caching |
| `d3` | ^7.9.0 | Data visualization (sunburst, network) |

### Dev Tools

| Package | Version | Purpose |
|---------|---------|---------|
| `concurrently` | ^8.2.0 | Run backend + frontend simultaneously |

### Why These Choices

- **Fastify over Express**: 2-3x faster, built-in JSON schema validation, plugin architecture
- **Prisma over Sequelize/Knex**: Type-safe queries, auto-generated client, visual studio, migration system
- **React Query over Redux**: Server-state focused, automatic caching/refetching, simpler mental model
- **Tailwind over styled-components**: Utility-first matches our design token system, no runtime CSS-in-JS overhead
- **Vite over webpack**: 10-100x faster HMR, native ES modules, minimal config
- **D3 over Chart.js/Recharts**: Full control over custom visualizations (sunburst, network graphs)
- **pg_trgm over Elasticsearch**: No additional infrastructure, good enough for current data size, built into PostgreSQL

---

## 3. Repository Structure

```
PID_assetview/
├── .devcontainer/
│   └── devcontainer.json            # GitHub Codespaces / VS Code config
├── .gitignore
├── CLAUDE.md                        # AI assistant instructions (READ FIRST)
├── PLAN_ADMIN.md                    # Admin feature planning
├── REDESIGN_PLAN.md                 # UI redesign plan
├── docker-compose.yml               # PostgreSQL service
├── start.sh                         # One-click startup script
├── package.json                     # Root workspace (scripts, concurrently)
│
├── backend/
│   ├── package.json
│   ├── .env.example                 # Template for environment variables
│   ├── prisma/
│   │   └── schema.prisma           # ORM schema (14 models, 4 enums)
│   ├── public/
│   │   ├── assets/                  # Static assets
│   │   └── pnid-images/            # P&ID drawing images (served by Fastify)
│   └── src/
│       ├── server.js                # Fastify entry point, plugin registration
│       ├── db.js                    # Prisma client singleton
│       ├── api.test.js              # Test suite (Node.js built-in test runner)
│       └── routes/
│           ├── platforms.js         # GET /platforms, GET /platforms/:id
│           ├── systems.js           # GET /platforms/:id/systems
│           ├── pnids.js             # GET /pnids?system_id=&include_xref=
│           ├── lines.js             # GET /lines?pnid_id=|system_id=
│           ├── equipment.js         # GET /equipment?line_id=|pnid_id=
│           ├── instruments.js       # GET /instruments?line_id=|pnid_id=
│           ├── registers.js         # GET /registers/:type
│           ├── search.js            # GET /search?q=
│           ├── assetTree.js         # GET /asset-tree (hierarchy endpoint)
│           ├── annotations.js       # WebSocket — STUB
│           ├── chat.js              # POST /chat — STUB
│           └── admin/
│               ├── entities.js      # CRUD for platforms/fields/complexes/systems
│               ├── hierarchy.js     # Move entities in hierarchy
│               ├── linkage.js       # Manage junction tables
│               └── importExport.js  # JSON import/export
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js               # Dev server config, API proxy
│   ├── tailwind.config.js           # M3 theme tokens, custom utilities
│   ├── postcss.config.js            # PostCSS plugins
│   ├── index.html                   # SPA entry point
│   ├── public/
│   │   └── pnid-images/            # P&ID images (dev fallback)
│   └── src/
│       ├── main.jsx                 # React root render
│       ├── App.jsx                  # Main app (572 lines) — orchestrator
│       ├── context/
│       │   └── ThemeContext.jsx      # Dark/light mode context
│       ├── hooks/
│       │   ├── useApi.js            # React Query hooks for all entities
│       │   └── useAdminApi.js       # Admin CRUD hooks
│       ├── data/
│       │   ├── constants.js         # M3 design tokens & colors
│       │   └── mockData.js          # Fallback mock data
│       ├── lib/
│       │   └── theme.js             # Theme utilities
│       └── components/
│           ├── AssetExplorer.jsx     # Alternative navigation view
│           ├── Column.jsx           # Single Miller column wrapper
│           ├── ConstellationMap.jsx  # Network visualization
│           ├── DetailBar.jsx        # Selected item details panel
│           ├── HierarchyTree.jsx    # Asset hierarchy tree
│           ├── MillerColumns.jsx    # 5-column cascade navigation
│           ├── PnidViewer.jsx       # P&ID drawing viewer
│           ├── RegisterView.jsx     # Full-width register tables
│           ├── SunburstChart.jsx    # D3 sunburst chart
│           ├── TopBar.jsx           # Header bar
│           ├── XrefNetwork.jsx      # Cross-reference network
│           └── admin/
│               ├── AdminLayout.jsx
│               ├── EntityManager.jsx
│               ├── EquipmentManager.jsx
│               ├── HierarchyManager.jsx
│               ├── InstrumentManager.jsx
│               ├── LineManager.jsx
│               ├── LinkageDashboard.jsx
│               ├── PnidManager.jsx
│               └── SystemManager.jsx
│
├── database/
│   ├── schema.sql                   # Full PostgreSQL schema (579 lines)
│   ├── seed.sql                     # AD219 project seed data (229 lines)
│   ├── setup.sh                     # Database setup script
│   └── reset.sh                     # Database reset script
│
└── docs/
    ├── AssetView_v4_WithRegisters.html   # REFERENCE POC (open in browser!)
    ├── AssetView_Product_Bible.docx
    ├── AssetView_DataModel_Audit.docx
    ├── P2.2_api_specification.md
    ├── VISION_SystemBased_PID_Study.md
    ├── IMPLEMENTATION_PLAN_SystemPID.md
    ├── STUDY_Commercial_PID_Tools_Architecture.md
    └── ARCHITECTURE_AND_METHODOLOGY_GUIDE.md  # THIS FILE
```

---

## 4. Database Architecture

### 4.1 Entity Relationship Diagram (Text)

```
concession (1) ──→ (N) field (1) ──→ (N) complex (1) ──→ (N) platform
                                                              │
                                                    (1) ──→ (N) system
                                                              │
                                            ┌─────────────────┼─────────────────┐
                                            │                 │                 │
                                      (1)→(N) line     (1)→(N) equipment  (1)→(N) instrument
                                            │                 │                 │
                                            └────────┐        │                 │
                                                     │        │                 │
                                              ┌──────┴────────┴─────────────────┘
                                              │
                                         P&ID (pnid)
                                              │
                              ┌───────────────┼───────────────┐───────────────┐
                              │               │               │               │
                        pnid_system     pnid_line      pnid_equipment  pnid_instrument
                        (is_primary)    (is_continuation)   (x,y,w,h)       (x,y,w,h)
```

### 4.2 Table Definitions

#### Hierarchy Tables (strict 1:N chain)

**concession**
```sql
id          UUID PRIMARY KEY
name        VARCHAR(200) NOT NULL
code        VARCHAR(50) UNIQUE NOT NULL
operator    VARCHAR(200)
region      VARCHAR(100)
metadata    JSONB DEFAULT '{}'
created_at  TIMESTAMPTZ DEFAULT NOW()
updated_at  TIMESTAMPTZ DEFAULT NOW()
deleted_at  TIMESTAMPTZ
```

**field**
```sql
id              UUID PRIMARY KEY
concession_id   UUID REFERENCES concession(id)
name            VARCHAR(200) NOT NULL
code            VARCHAR(50) NOT NULL
field_type      VARCHAR(50)
metadata        JSONB DEFAULT '{}'
UNIQUE(concession_id, code)
```

**complex**
```sql
id          UUID PRIMARY KEY
field_id    UUID REFERENCES field(id)
name        VARCHAR(200) NOT NULL
code        VARCHAR(50) NOT NULL
metadata    JSONB DEFAULT '{}'
UNIQUE(field_id, code)
```

**platform**
```sql
id              UUID PRIMARY KEY
complex_id      UUID REFERENCES complex(id)
name            VARCHAR(200) NOT NULL
code            VARCHAR(50) NOT NULL
platform_status platform_status DEFAULT 'operating'
latitude        DECIMAL(10,7)
longitude       DECIMAL(10,7)
metadata        JSONB DEFAULT '{}'
UNIQUE(complex_id, code)
```

#### Core Asset Tables

**system**
```sql
id              UUID PRIMARY KEY
platform_id     UUID REFERENCES platform(id) ON DELETE CASCADE
name            VARCHAR(200) NOT NULL
code            VARCHAR(50) NOT NULL
sys_type        system_type NOT NULL        -- process|utility|safety|instrument
description     TEXT
system_number   VARCHAR(20)
metadata        JSONB DEFAULT '{}'
UNIQUE(platform_id, code)
```

**pnid** (P&ID Drawing)
```sql
id              UUID PRIMARY KEY
drawing_number  VARCHAR(100) NOT NULL
title           VARCHAR(300)
revision        VARCHAR(20) DEFAULT '0'
status          document_status DEFAULT 'draft'
image_path      TEXT
has_image       BOOLEAN DEFAULT false
metadata        JSONB DEFAULT '{}'
```

**line**
```sql
id              UUID PRIMARY KEY
system_id       UUID REFERENCES system(id) ON DELETE CASCADE  -- OWNERSHIP
line_number     VARCHAR(100) NOT NULL
service         VARCHAR(200)
fluid_code      VARCHAR(50)
nominal_size    VARCHAR(20)
pipe_class      VARCHAR(50)
design_pressure VARCHAR(50)
design_temp     VARCHAR(50)
insulation_type VARCHAR(50)
from_equipment  VARCHAR(100)
to_equipment    VARCHAR(100)
metadata        JSONB DEFAULT '{}'
UNIQUE(system_id, line_number)
```

**equipment**
```sql
id              UUID PRIMARY KEY
system_id       UUID REFERENCES system(id) ON DELETE CASCADE
line_id         UUID REFERENCES line(id)    -- NULLABLE (standalone equipment)
tag             VARCHAR(100) NOT NULL
equipment_type  VARCHAR(100)
description     TEXT
criticality     criticality_level DEFAULT 'medium'
sil_level       INTEGER
weight_kg       DECIMAL(12,2)
design_pressure VARCHAR(50)
design_temp     VARCHAR(50)
material        VARCHAR(100)
manufacturer    VARCHAR(200)
model_number    VARCHAR(100)
inspection_group VARCHAR(50)
corrosion_loop  VARCHAR(50)
cmms_asset_id   VARCHAR(100)               -- For CMMS integration
vt_scene_id     VARCHAR(100)               -- Virtual Tour scene
vt_hotspot_id   VARCHAR(100)               -- Virtual Tour hotspot
model_3d_object_id VARCHAR(100)            -- 3D model reference
metadata        JSONB DEFAULT '{}'
```

**instrument**
```sql
id              UUID PRIMARY KEY
system_id       UUID REFERENCES system(id) ON DELETE CASCADE
line_id         UUID REFERENCES line(id)
tag             VARCHAR(100) NOT NULL
instrument_type instrument_type NOT NULL    -- pressure|temperature|flow|level|safety_valve|control_valve|analyzer|other
description     TEXT
range           VARCHAR(100)
set_point       VARCHAR(100)
loop_number     VARCHAR(50)
signal_type     VARCHAR(50)
manufacturer    VARCHAR(200)
model_number    VARCHAR(100)
metadata        JSONB DEFAULT '{}'
```

#### Junction Tables (M:N Relationships)

**pnid_system** — Which systems a P&ID references
```sql
id          UUID PRIMARY KEY
pnid_id     UUID REFERENCES pnid(id) ON DELETE CASCADE
system_id   UUID REFERENCES system(id) ON DELETE CASCADE
is_primary  BOOLEAN DEFAULT false          -- Exactly ONE primary per P&ID
UNIQUE(pnid_id, system_id)
```

**pnid_line** — Which lines appear on which P&IDs
```sql
id              UUID PRIMARY KEY
pnid_id         UUID REFERENCES pnid(id) ON DELETE CASCADE
line_id         UUID REFERENCES line(id) ON DELETE CASCADE
is_continuation BOOLEAN DEFAULT false      -- Line started on another sheet
UNIQUE(pnid_id, line_id)
```

**pnid_equipment** — Equipment positions on P&ID drawings
```sql
id                  UUID PRIMARY KEY
pnid_id             UUID REFERENCES pnid(id) ON DELETE CASCADE
equipment_id        UUID REFERENCES equipment(id) ON DELETE CASCADE
annotation_x_pct    DECIMAL(5,2)           -- Percentage position on drawing
annotation_y_pct    DECIMAL(5,2)
annotation_w_pct    DECIMAL(5,2)
annotation_h_pct    DECIMAL(5,2)
UNIQUE(pnid_id, equipment_id)
```

**pnid_instrument** — Instrument positions on P&ID drawings
```sql
id                  UUID PRIMARY KEY
pnid_id             UUID REFERENCES pnid(id) ON DELETE CASCADE
instrument_id       UUID REFERENCES instrument(id) ON DELETE CASCADE
annotation_x_pct    DECIMAL(5,2)
annotation_y_pct    DECIMAL(5,2)
annotation_w_pct    DECIMAL(5,2)
annotation_h_pct    DECIMAL(5,2)
UNIQUE(pnid_id, instrument_id)
```

#### Annotation Tables (for real-time collaboration)

**annotation**
```sql
id              UUID PRIMARY KEY
pnid_id         UUID REFERENCES pnid(id) ON DELETE CASCADE
x_pct           DECIMAL(5,2)
y_pct           DECIMAL(5,2)
w_pct           DECIMAL(5,2)
h_pct           DECIMAL(5,2)
annotation_type VARCHAR(50) DEFAULT 'comment'
text            TEXT
author          VARCHAR(100)
status          VARCHAR(50) DEFAULT 'open'
resolved_at     TIMESTAMPTZ
metadata        JSONB DEFAULT '{}'
```

**annotation_reply**
```sql
id              UUID PRIMARY KEY
annotation_id   UUID REFERENCES annotation(id) ON DELETE CASCADE
text            TEXT NOT NULL
author_id       VARCHAR(100)
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### 4.3 Enums

```sql
CREATE TYPE system_type AS ENUM ('process', 'utility', 'safety', 'instrument');
CREATE TYPE criticality_level AS ENUM ('high', 'medium', 'low');
CREATE TYPE instrument_type AS ENUM ('pressure', 'temperature', 'flow', 'level', 'safety_valve', 'control_valve', 'analyzer', 'other');
CREATE TYPE document_status AS ENUM ('as_built', 'approved', 'issued_for_construction', 'issued_for_review', 'draft', 'superseded');
CREATE TYPE platform_status AS ENUM ('operating', 'under_construction', 'decommissioned', 'planned');
```

### 4.4 Search Infrastructure

PostgreSQL `pg_trgm` extension provides fuzzy search without Elasticsearch:

```sql
-- Trigram indexes for fuzzy matching
CREATE INDEX idx_equipment_tag_trgm ON equipment USING gin (tag gin_trgm_ops);
CREATE INDEX idx_line_number_trgm ON line USING gin (line_number gin_trgm_ops);
CREATE INDEX idx_instrument_tag_trgm ON instrument USING gin (tag gin_trgm_ops);
CREATE INDEX idx_pnid_drawing_trgm ON pnid USING gin (drawing_number gin_trgm_ops);

-- Global search function
CREATE FUNCTION search_all(search_term TEXT, platform_uuid UUID)
RETURNS TABLE(entity_type TEXT, id UUID, tag TEXT, description TEXT, similarity REAL)
```

### 4.5 Cross-Reference Rules (CRITICAL)

1. Every P&ID has exactly **ONE** primary system (`pnid_system.is_primary = true`)
2. A P&ID can reference **multiple** secondary systems
3. A line can appear on **multiple** P&IDs (continuation lines)
4. When a line appears on a P&ID whose primary system ≠ line's owning system → **cross-reference**
5. When `pnid_line.is_continuation = true` → line started on another sheet

### 4.6 Seed Data (AD219 Project)

| Entity | Count | Details |
|--------|-------|---------|
| Concession | 1 | AD219 |
| Field | 1 | Belbazem |
| Complex | 1 | BBZ-A |
| Platforms | 2 | WHT-5 (main), WHT-6 |
| Systems | 14 | 12 on WHT-5, 2 on WHT-6 |
| P&IDs | 24 | With proper drawing numbers |
| Lines | 13 | With cross-system ownership |
| Equipment | 17 | Standalone and on-line |
| Instruments | 12 | Multiple types |

Key test UUIDs (hardcoded in seed data and tests):
- WHT-5 platform: check `seed.sql` for exact UUIDs
- Systems: Production, Closed Drain, Gas Lift, etc.

---

## 5. Backend Architecture

### 5.1 Server Setup (`backend/src/server.js`)

```
Fastify Instance
├── Plugins
│   ├── @fastify/cors (origin from env)
│   ├── @fastify/static (P&ID images from public/)
│   └── @fastify/websocket (real-time annotations)
├── Routes
│   ├── /api/v1/platforms
│   ├── /api/v1/platforms/:platformId/systems
│   ├── /api/v1/pnids
│   ├── /api/v1/lines
│   ├── /api/v1/equipment
│   ├── /api/v1/instruments
│   ├── /api/v1/registers/:type
│   ├── /api/v1/search
│   ├── /api/v1/asset-tree
│   ├── /api/v1/chat (STUB)
│   ├── /ws/annotations (STUB)
│   └── /api/v1/admin/* (CRUD)
├── Health Check: GET /health
└── SPA Fallback: serves index.html for client-side routing
```

### 5.2 Database Client (`backend/src/db.js`)

```javascript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export default prisma;
```

Single Prisma client instance shared across all routes. Connection pooling handled by Prisma.

### 5.3 Route Pattern

Every route file exports a Fastify plugin function:

```javascript
export default async function(fastify, opts) {
  fastify.get('/api/v1/endpoint', async (request, reply) => {
    const { query_param } = request.query;
    const data = await prisma.model.findMany({ where: { ... } });
    return { data };
  });
}
```

### 5.4 API Response Format

All endpoints return:
```json
{
  "data": [ ... ]          // Array of results (list endpoints)
}
// or
{
  "data": { ... }          // Single object (detail endpoints)
}
// or for registers:
{
  "data": [ ... ],
  "total": 42,
  "page": 1,
  "pageSize": 50
}
```

### 5.5 Environment Variables

```env
DATABASE_URL=postgresql://assetview:assetview@localhost:5432/assetview
PORT=3001
CORS_ORIGIN=http://localhost:5173
ANTHROPIC_API_KEY=sk-ant-...   # For AI chat (P2.5)
```

---

## 6. Frontend Architecture

### 6.1 Component Hierarchy

```
<App>                                    # Main orchestrator (572 lines)
├── <ThemeProvider>                       # Dark/light mode context
│   ├── <TopBar>                         # Search, platform select, toggles
│   │   ├── Search input
│   │   ├── Platform dropdown
│   │   ├── X-Ref toggle
│   │   ├── View mode buttons (Columns/Tree/Explorer/Admin)
│   │   ├── API status indicator
│   │   └── Theme toggle
│   │
│   ├── <MillerColumns>                  # Main navigation (when view=columns)
│   │   ├── <Column type="systems">      # Column 1
│   │   ├── <Column type="pnids">        # Column 2
│   │   ├── <Column type="lines">        # Column 3
│   │   ├── <Column type="equipment">    # Column 4
│   │   └── <Column type="instruments">  # Column 5
│   │
│   ├── <RegisterView>                   # Full-width table (when register open)
│   │
│   ├── <HierarchyTree>                  # Tree view (when view=tree)
│   │   └── <SunburstChart>
│   │
│   ├── <AssetExplorer>                  # Explorer view (when view=explorer)
│   │   ├── <ConstellationMap>
│   │   └── <XrefNetwork>
│   │
│   ├── <AdminLayout>                    # Admin view (when view=admin)
│   │   ├── <EntityManager>
│   │   ├── <SystemManager>
│   │   ├── <PnidManager>
│   │   ├── <LineManager>
│   │   ├── <EquipmentManager>
│   │   ├── <InstrumentManager>
│   │   ├── <HierarchyManager>
│   │   └── <LinkageDashboard>
│   │
│   ├── <PnidViewer>                     # P&ID drawing overlay
│   │
│   └── <DetailBar>                      # Selected item details
│
└── <ReactQueryProvider>                 # TanStack Query client
```

### 6.2 State Management

**No Redux.** State is managed with React hooks:

```javascript
// App.jsx — Core state
const [selectedPlatform, setSelectedPlatform] = useState(null);
const [selectedSystem, setSelectedSystem] = useState(null);
const [selectedPnid, setSelectedPnid] = useState(null);
const [selectedLine, setSelectedLine] = useState(null);
const [selectedEquipment, setSelectedEquipment] = useState(null);
const [selectedInstrument, setSelectedInstrument] = useState(null);
const [showXref, setShowXref] = useState(false);
const [activeRegister, setActiveRegister] = useState(null);
const [viewMode, setViewMode] = useState('columns');  // columns|tree|explorer|admin
```

**React Query** handles server state (caching, refetching, loading/error states):

```javascript
// hooks/useApi.js
export function useSystems(platformId) {
  return useQuery({
    queryKey: ['systems', platformId],
    queryFn: () => fetch(`/api/v1/platforms/${platformId}/systems`).then(r => r.json()),
    enabled: !!platformId,
  });
}
```

### 6.3 Miller Columns Cascade Logic

```
User clicks System X:
  → setSelectedSystem(X)
  → Automatically filters P&IDs query: ?system_id=X
  → Clears selectedPnid, selectedLine, selectedEquipment, selectedInstrument

User clicks P&ID Y:
  → setSelectedPnid(Y)
  → Automatically filters Lines query: ?pnid_id=Y
  → Clears selectedLine, selectedEquipment, selectedInstrument

User clicks Line Z:
  → setSelectedLine(Z)
  → Automatically filters Equipment query: ?line_id=Z
  → Clears selectedEquipment, selectedInstrument

User clicks same item again → DESELECTS (toggle behavior)
  → Expands downstream columns back to show all
```

### 6.4 Cross-Reference Display Rules

When `showXref = true`:
- Lines/equipment from **other** systems appear in the filtered column
- Rendered at **65% opacity**
- Left border uses the **owning system's color** (process=green, utility=blue, safety=red, instrument=yellow)
- Tooltip shows "From: [System Name]"

### 6.5 Register View Behavior

- Click any column **header** → Opens full-width `<RegisterView>` for that entity type
- Register shows sortable columns with per-column text filters
- Click a row → Highlights and selects that entity
- Close button → Returns to Miller Columns

### 6.6 Vite Configuration

```javascript
// vite.config.js
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
```

The proxy means frontend code calls `/api/v1/...` directly — no CORS issues in development.

---

## 7. Design System

### 7.1 Color Palette

```javascript
// Brand Colors
deepGreen:    "#16352B"    // Primary dark background
spaceCadet:   "#171744"    // Secondary dark
aquamarine:   "#3BE494"    // Primary accent (15% usage)
ultramarine:  "#2D33E0"    // Secondary accent (10% usage)

// System Type Colors (semantic)
process:      "#3BE494"    // Green
utility:      "#2D33E0"    // Blue
safety:       "#E74C3C"    // Red
instrument:   "#F39C12"    // Yellow/Orange

// Criticality Colors
high:         "#E74C3C"    // Red
medium:       "#F39C12"    // Yellow
low:          "#3BE494"    // Green

// Document Status Colors
as_built:     "#3BE494"    // Green
approved:     "#2D33E0"    // Blue
draft:        "#E67E22"    // Orange

// UI Surface Colors
background:   "#0D1F17"    // Darkest
panel:        "#111D14"    // Panel background
card:         "#16352B"    // Card/elevated surfaces
text:         "#D3DFE2"    // Primary text
muted:        "#919A9B"    // Secondary/muted text
```

### 7.2 Material Design 3 Theme

The Tailwind config extends with M3-inspired tokens:

- **Typography scale**: display-lg, headline-md, title-sm, body-md, label-sm
- **Border radius**: md-none, md-xs, md-sm, md-md, md-lg, md-xl, md-full
- **Elevation**: md-1 through md-5 (box shadows)
- **Animations**: md-list-enter, md-register-enter, md-detail-enter, md-fade-in, md-ripple

### 7.3 Theme Rules

- **Dark mode is default**
- P&ID canvas area is **always light** (#F5F7F7) regardless of theme
- System type colors are used consistently for left borders on items
- Criticality colors are used for badges/indicators

---

## 8. API Specification

### 8.1 Core Endpoints

#### Platform & Systems

```
GET /api/v1/platforms
  → Returns: { data: [{ id, name, code, status, systems_count, pnids_count, ... }] }

GET /api/v1/platforms/:platformId
  → Returns: { data: { id, name, code, status, systems: [...], counts: {...} } }

GET /api/v1/platforms/:platformId/systems
  → Returns: { data: [{ id, name, code, sys_type, description, system_number, pnid_count, line_count, equipment_count }] }
```

#### P&IDs (Miller Column 2)

```
GET /api/v1/pnids?system_id=UUID&include_xref=true&platform_id=UUID
  Query params:
    - system_id: Filter by system (required for column cascade)
    - include_xref: Include P&IDs that reference this system as secondary (default false)
    - platform_id: Filter by platform
  → Returns: { data: [{ id, drawing_number, title, revision, status, image_path, has_image, primary_system, is_xref }] }
```

#### Lines (Miller Column 3)

```
GET /api/v1/lines?pnid_id=UUID&system_id=UUID&include_xref=true
  Query params:
    - pnid_id: Filter lines appearing on this P&ID
    - system_id: Filter lines owned by this system
    - include_xref: Include lines from other systems (cross-references)
  → Returns: { data: [{ id, line_number, service, fluid_code, nominal_size, pipe_class, system_id, system_name, system_code, is_xref, is_continuation }] }
```

#### Equipment (Miller Column 4)

```
GET /api/v1/equipment?line_id=UUID&pnid_id=UUID&system_id=UUID
  Query params:
    - line_id: Filter by line
    - pnid_id: Filter by P&ID appearance
    - system_id: Filter by system
  → Returns: { data: [{ id, tag, equipment_type, description, criticality, sil_level, system_id, line_id, is_xref }] }
```

#### Instruments (Miller Column 5)

```
GET /api/v1/instruments?line_id=UUID&pnid_id=UUID&system_id=UUID
  → Returns: { data: [{ id, tag, instrument_type, description, range, set_point, loop_number, system_id, line_id }] }
```

#### Registers

```
GET /api/v1/registers/:type?sort=field&order=asc|desc&page=1&pageSize=50&filter_field=value
  Types: systems, pnids, lines, equipment, instruments
  → Returns: { data: [...], total: N, page: 1, pageSize: 50 }
```

#### Search

```
GET /api/v1/search?q=search_term&platform_id=UUID
  → Returns: { data: [{ entity_type, id, tag, description, similarity }] }
```

### 8.2 Admin Endpoints

```
POST   /api/v1/admin/entities/:type           # Create entity
PUT    /api/v1/admin/entities/:type/:id        # Update entity
DELETE /api/v1/admin/entities/:type/:id        # Delete entity (soft)

POST   /api/v1/admin/hierarchy/move            # Move entity in hierarchy
GET    /api/v1/admin/hierarchy/tree            # Get full hierarchy

POST   /api/v1/admin/linkage/:junction_type    # Create junction
DELETE /api/v1/admin/linkage/:junction_type/:id # Remove junction

GET    /api/v1/admin/export?platform_id=UUID   # Export as JSON
POST   /api/v1/admin/import                    # Import from JSON
```

### 8.3 Planned Endpoints

```
POST /api/v1/chat
  Body: { message: "What equipment is on line 1195?", context: { platform_id, system_id } }
  → Returns: { response: "...", sources: [...] }

WS /ws/annotations
  Events: annotation.created, annotation.updated, annotation.resolved
```

---

## 9. Data Flow & State Management

### 9.1 Request Flow

```
User Action (click system)
    │
    ▼
App.jsx (setState)
    │
    ▼
React Query hook (useApi.js)
    │
    ▼
fetch('/api/v1/...')    ← Vite proxy in dev
    │
    ▼
Fastify route handler (routes/*.js)
    │
    ▼
Prisma ORM query (db.js)
    │
    ▼
PostgreSQL
    │
    ▼
JSON response → React Query cache → Component re-render
```

### 9.2 Caching Strategy

React Query provides:
- **Automatic caching** by query key (e.g., `['systems', platformId]`)
- **Stale-while-revalidate** — shows cached data while refetching
- **Automatic refetch** on window focus
- **Dependent queries** — `enabled: !!platformId` prevents queries until parent is selected

### 9.3 Error Handling

- React Query handles loading/error states per query
- TopBar shows API status indicator (green = connected, red = error)
- Mock data fallback if API is unreachable (dev convenience)

---

## 10. P&ID Visualization Architecture

### 10.1 Current Implementation

```
PnidViewer.jsx
├── Image Layer (light background #F5F7F7)
│   └── <img src="/pnid-images/{drawing_number}.png" />
│
├── Annotation Overlay (SVG or div overlay)
│   ├── Equipment hotspots (from pnid_equipment x/y/w/h)
│   └── Instrument hotspots (from pnid_instrument x/y/w/h)
│
└── Controls
    ├── Zoom in/out
    ├── Pan
    └── Annotation tools (planned)
```

### 10.2 Position System

All positions stored as **percentages** (0-100):
- `annotation_x_pct` — X position as % of image width
- `annotation_y_pct` — Y position as % of image height
- `annotation_w_pct` — Width as % of image width
- `annotation_h_pct` — Height as % of image height

This ensures positions scale correctly regardless of zoom level or display size.

### 10.3 P&ID Image Storage

- Images stored in `backend/public/pnid-images/` (served by Fastify static)
- Also in `frontend/public/pnid-images/` (Vite dev fallback)
- `pnid.image_path` stores the relative path
- `pnid.has_image` boolean indicates if image is available

### 10.4 Planned: Commercial P&ID Tool Integration

Based on our research study (`docs/STUDY_Commercial_PID_Tools_Architecture.md`):
- Industry standard is **model-first, sheets-as-views**
- Our junction table architecture mirrors how enterprise tools (SmartPlant, OpenPlant, AVEVA) separate plant model from sheet placement
- Equipment exists once in the model, with position data per P&ID appearance — matches `pnid_equipment` junction pattern

---

## 11. Build, Run & Deploy

### 11.1 Prerequisites

- Node.js 22+ (or 18+ minimum)
- npm 10+
- Docker & Docker Compose (for PostgreSQL)
- Git

### 11.2 First-Time Setup

```bash
# 1. Clone & install
git clone <repo-url>
cd PID_assetview
npm run install:all          # Installs root + backend + frontend

# 2. Start database
docker compose up -d         # PostgreSQL 15 on port 5432

# 3. Database is auto-initialized via docker-compose init scripts
#    If manual setup needed:
cd database
psql postgresql://assetview:assetview@localhost:5432/assetview -f schema.sql
psql postgresql://assetview:assetview@localhost:5432/assetview -f seed.sql

# 4. Configure backend
cd backend
cp .env.example .env         # Edit DATABASE_URL if needed

# 5. Generate Prisma client
cd backend
npx prisma generate

# 6. Run everything
cd ..
npm run dev                  # Runs backend (3001) + frontend (5173) concurrently
```

### 11.3 Quick Start (After Setup)

```bash
docker compose up -d         # Start DB if stopped
npm run dev                  # Start everything
```

### 11.4 Useful Commands

```bash
# Database
docker compose exec postgres psql -U assetview assetview   # SQL shell
cd backend && npx prisma studio                             # Visual DB browser at localhost:5555

# Backend only
cd backend && npm run dev                                   # Hot reload on port 3001
cd backend && npm test                                      # Run test suite

# Frontend only
cd frontend && npm run dev                                  # Dev server on port 5173
cd frontend && npm run build                                # Production build
cd frontend && npm run preview                              # Preview production build

# Full project
npm run dev                    # Both backend + frontend
npm run build                  # Production frontend build
npm test                       # Backend tests

# Database reset
cd database && ./reset.sh      # Drop & recreate all data
```

### 11.5 Port Map

| Service | Port | URL |
|---------|------|-----|
| Frontend (Vite) | 5173 | http://localhost:5173 |
| Backend (Fastify) | 3001 | http://localhost:3001 |
| PostgreSQL | 5432 | postgresql://assetview:assetview@localhost:5432/assetview |
| Prisma Studio | 5555 | http://localhost:5555 (when running) |
| API Endpoints | 3001 | http://localhost:3001/api/v1/* |
| Health Check | 3001 | http://localhost:3001/health |

### 11.6 Docker Compose Configuration

```yaml
services:
  postgres:
    image: postgres:15-alpine
    container_name: assetview-db
    environment:
      POSTGRES_USER: assetview
      POSTGRES_PASSWORD: assetview
      POSTGRES_DB: assetview
    ports:
      - "5432:5432"
    volumes:
      - ./pgdata:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
      - ./database/seed.sql:/docker-entrypoint-initdb.d/02-seed.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U assetview"]
      interval: 5s
      timeout: 5s
      retries: 5
```

---

## 12. Testing Strategy

### 12.1 Current Test Framework

- **Framework**: Node.js built-in `test` module (no Jest/Mocha needed)
- **Location**: `backend/src/api.test.js`
- **Run**: `cd backend && npm test` or `npm test` from root

### 12.2 Test Organization

Tests are organized by phase:

```
P2.1 Database Tests
├── Verify platform count (2)
├── Verify system count on WHT-5 (12)
├── Verify P&ID count (24)
├── Verify line count (13)
├── Verify equipment count (17)
└── Verify instrument count (12)

P2.2 API Tests
├── GET /platforms returns list
├── GET /platforms/:id/systems returns filtered
├── GET /pnids?system_id= returns filtered
├── GET /lines?pnid_id= returns with x-ref info
├── GET /equipment?line_id= returns with criticality
├── GET /instruments?line_id= returns with type
├── GET /registers/:type returns paginated
├── GET /search?q= returns ranked results
└── Error handling (404, invalid UUID, etc.)
```

### 12.3 How to Add Tests

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('New Feature', () => {
  it('should do something', async () => {
    const res = await fetch('http://localhost:3001/api/v1/endpoint');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.length > 0);
  });
});
```

---

## 13. Implementation Status & Roadmap

### 13.1 What's Done

| Phase | Component | Status |
|-------|-----------|--------|
| P2.1 | PostgreSQL schema | DONE |
| P2.1 | Seed data (AD219) | DONE |
| P2.1 | Prisma ORM setup | DONE |
| P2.2 | Platforms API | DONE |
| P2.2 | Systems API | DONE |
| P2.2 | P&IDs API (with x-ref) | DONE |
| P2.2 | Lines API (with continuation) | DONE |
| P2.2 | Equipment API | DONE |
| P2.2 | Instruments API | DONE |
| P2.2 | Registers API | DONE |
| P2.2 | Search API (pg_trgm) | DONE |
| P2.2 | Asset Tree API | DONE |
| P2.2 | Admin CRUD API | DONE |
| P2.2 | Import/Export API | DONE |
| P2.3 | Miller Columns UI | DONE |
| P2.3 | Register Views | DONE |
| P2.3 | TopBar & controls | DONE |
| P2.3 | Hierarchy Tree | DONE |
| P2.3 | Asset Explorer | DONE |
| P2.3 | Admin Panel UI | DONE |
| P2.3 | React Query integration | DONE |
| P2.3 | M3 Design System | DONE |
| P2.4 | PnidViewer (basic) | DONE |

### 13.2 What's In Progress / Remaining

| Phase | Component | Status | Notes |
|-------|-----------|--------|-------|
| P2.4 | P&ID hotspot clicking | IN PROGRESS | Junction data exists, UI wiring partial |
| P2.4 | P&ID zoom/pan controls | IN PROGRESS | Basic controls exist |
| P2.5 | AI Chat endpoint | NOT STARTED | Stub exists, @anthropic-ai/sdk installed |
| P2.5 | Chat UI component | NOT STARTED | Need to build |
| P2.6 | WebSocket annotations | NOT STARTED | Plugin registered, tables exist |
| P2.6 | Collaborative markup | NOT STARTED | Annotation model ready |
| — | CMMS integration | NOT STARTED | DB fields ready (cmms_asset_id) |
| — | 3D/VT integration | NOT STARTED | DB fields ready (vt_scene_id, model_3d_object_id) |

### 13.3 Build Order (Recommended)

1. Finish P&ID viewer hotspot integration
2. Build AI Chat (POST /chat with Claude function calling)
3. Build WebSocket annotation system
4. Add CMMS integration
5. Add 3D/VT viewer integration

---

## 14. Troubleshooting Guide

### 14.1 Database Issues

**Problem**: `docker compose up` fails
```bash
# Check if port 5432 is in use
lsof -i :5432
# Kill existing postgres if needed, or change port in docker-compose.yml
```

**Problem**: Tables don't exist
```bash
# The docker-compose auto-runs init scripts only on FIRST startup
# If pgdata/ already exists, it won't re-run them
# Solution: remove data and restart
docker compose down
rm -rf pgdata
docker compose up -d
```

**Problem**: Prisma client out of sync
```bash
cd backend
npx prisma generate   # Regenerate client from schema
# If schema changed:
npx prisma db pull    # Pull schema from database
npx prisma generate   # Regenerate client
```

### 14.2 Backend Issues

**Problem**: Backend won't start
```bash
# Check .env file exists
cat backend/.env
# Verify DATABASE_URL points to running PostgreSQL
# Check port 3001 is free
lsof -i :3001
```

**Problem**: API returns 500
```bash
# Check backend logs (should be running with --watch)
# Common cause: Prisma client not generated
cd backend && npx prisma generate
```

### 14.3 Frontend Issues

**Problem**: API calls fail with CORS
```
# This shouldn't happen if using Vite proxy
# Check vite.config.js has proxy configured for /api
# Ensure calling /api/v1/... not http://localhost:3001/api/v1/...
```

**Problem**: Blank page
```bash
# Check browser console for errors
# Common cause: backend not running (API status indicator will show red)
# Start backend first, then frontend
```

### 14.4 Common Development Tasks

**Add a new API endpoint**:
1. Create route file in `backend/src/routes/`
2. Register it in `backend/src/server.js`
3. Add React Query hook in `frontend/src/hooks/useApi.js`
4. Add tests in `backend/src/api.test.js`

**Add a new database field**:
1. Update `backend/prisma/schema.prisma`
2. Run `npx prisma migrate dev --name description`
3. Update `database/schema.sql` to match
4. Update seed data if needed

**Add a new frontend component**:
1. Create in `frontend/src/components/`
2. Import and use in `App.jsx` or parent component
3. Use Tailwind classes from existing design system
4. Follow existing patterns for API data fetching

---

## 15. Key Design Decisions & Rationale

### 15.1 Why Junction Tables (Not Embedded Arrays)

**Decision**: Use proper SQL junction tables (`pnid_system`, `pnid_line`, etc.) instead of JSONB arrays.

**Rationale**:
- Proper referential integrity with ON DELETE CASCADE
- Queryable with standard SQL JOINs
- Additional metadata per relationship (is_primary, is_continuation, x/y positions)
- Indexable for performance
- Matches how enterprise P&ID tools (SmartPlant, OpenPlant) model the same relationships

### 15.2 Why Ownership vs. Display Separation

**Decision**: Lines belong to systems (ownership) but appear on P&IDs (display).

**Rationale**: In real plants, a Closed Drain line is part of the Closed Drain system regardless of which P&ID drawing it's sketched on. A single line can span multiple sheets. This matches ISO 15926 and all commercial P&ID tools.

### 15.3 Why pg_trgm Over Elasticsearch

**Decision**: Use PostgreSQL built-in trigram search instead of adding Elasticsearch.

**Rationale**: Current data size (< 100K records) doesn't warrant a separate search infrastructure. pg_trgm provides fuzzy matching with relevance ranking. Can migrate to Elasticsearch later if needed.

### 15.4 Why No Redux

**Decision**: Use React useState + React Query instead of Redux.

**Rationale**: The state is primarily server-derived. React Query handles caching, loading states, and refetching. Local UI state (selections, toggles) is simple enough for useState. Adding Redux would be over-engineering at this stage.

### 15.5 Why Fastify Over Express

**Decision**: Use Fastify 5 instead of Express.

**Rationale**: 2-3x faster than Express, built-in JSON schema validation, plugin architecture, TypeScript-friendly, better error handling. No downside — API is standard REST.

### 15.6 Why Percentage-Based Positions

**Decision**: Store annotation positions as percentages (0-100) not pixels.

**Rationale**: P&ID images may be viewed at different zoom levels and display sizes. Percentage positions scale correctly regardless of viewport. This is the standard approach in commercial annotation tools.

### 15.7 Why Soft Deletes

**Decision**: Use `deleted_at` timestamp instead of hard DELETE.

**Rationale**: In oil & gas, audit trail is critical. Soft deletes allow recovery and historical queries. The Prisma middleware filters out deleted records by default.

---

## Appendix A: Reference POC

The file `docs/AssetView_v4_WithRegisters.html` is the **complete working POC** as a standalone HTML file. Open it in any browser to see the exact UI behavior the production build must match. It contains:

- Mock data matching the seed data structure
- Miller Columns with full cascade logic
- Register views with sorting and filtering
- X-Ref toggle behavior
- System type color coding
- All interaction patterns

**This is the source of truth for UI behavior.**

---

## Appendix B: File Sizes & Line Counts

| File | Lines | Purpose |
|------|-------|---------|
| frontend/src/App.jsx | 572 | Main orchestrator |
| frontend/src/components/MillerColumns.jsx | ~400 | 5-column cascade |
| frontend/src/components/RegisterView.jsx | ~350 | Register tables |
| frontend/src/components/PnidViewer.jsx | ~300 | P&ID viewer |
| frontend/src/components/TopBar.jsx | ~250 | Header controls |
| frontend/tailwind.config.js | ~200 | M3 theme config |
| backend/src/routes/assetTree.js | 308 | Tree hierarchy API |
| backend/src/routes/lines.js | 188 | Lines API with x-ref |
| backend/src/routes/registers.js | 153 | Register tables API |
| backend/src/routes/pnids.js | 141 | P&IDs API with x-ref |
| backend/src/routes/equipment.js | 125 | Equipment API |
| backend/src/routes/admin/entities.js | 620 | Admin CRUD |
| backend/src/routes/admin/importExport.js | 475 | Import/export |
| backend/src/routes/admin/hierarchy.js | 402 | Hierarchy management |
| database/schema.sql | 579 | Full PostgreSQL schema |
| database/seed.sql | 229 | AD219 seed data |

---

## Appendix C: Git Branch Strategy

- **main** — Production-ready code
- **claude/redesign-pid-visualization-ftUrQ** — Current development branch for P&ID visualization redesign
- Always develop on feature branches, merge to main via PR

---

*This document should be sufficient to reconstruct the entire project from scratch or continue development from any interruption point.*
