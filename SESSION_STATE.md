# SESSION_STATE.md — Cross-Session Memory for AssetView

> **Purpose**: This file persists between Claude Code sessions. Every session
> MUST read this file first and update it before ending. This solves the
> "amnesia problem" — new sessions know exactly what happened before.

## Current Status

**Last updated**: 2026-03-15
**Current phase**: Fixing broken merges from V4-V9
**Main branch state**: All V4-V9 merged, but with issues
**Blocking issues**: Multiple components broken after merge

## What Works (verified)

- [x] Database schema + seed data loads correctly
- [x] Backend Fastify server starts
- [x] Backend API endpoints (systems, pnids, lines, equipment, instruments)
- [x] Frontend Vite dev server starts
- [x] Miller Columns basic navigation
- [x] Docker Compose production deployment
- [ ] Frontend build (`npm run build`) — NEEDS VERIFICATION
- [ ] 3D viewer (Three.js) — NEEDS VERIFICATION
- [ ] System Canvas (React Flow) — NEEDS VERIFICATION
- [ ] Selection Bus (2D↔3D sync) — NEEDS VERIFICATION
- [ ] ELK layout engine — NEEDS VERIFICATION
- [ ] Semantic zoom — NEEDS VERIFICATION

## What Is Broken (known issues)

<!-- Update this list as you fix or discover issues -->
<!-- Format: - [ ] Description | File | Error message snippet -->

_Needs audit — run `cd frontend && npm run build` to get error list_

## Decisions Already Made (DO NOT re-debate)

1. React Flow (@xyflow/react) for 2D topology canvas
2. Three.js + @react-three/fiber for 3D viewer
3. ELK.js for auto-layout (not dagre, not d3-hierarchy)
4. Fastify (not Express) for backend
5. Prisma ORM (not raw SQL, not Knex)
6. Tailwind CSS with custom theme (not CSS modules, not styled-components)
7. All colors from constants.js/theme.js — ZERO hardcoded hex values
8. PostgreSQL with pg_trgm for search (no Elasticsearch)
9. Wave-based agent development (not all-at-once)

## Dead Ends (DO NOT retry)

<!-- Things that were tried and failed — saves future sessions from repeating -->
<!-- Format: - Approach | Why it failed | Date -->

_None recorded yet_

## Agent/Wave History

| Wave | Agent | Branch | Status | Date | Notes |
|------|-------|--------|--------|------|-------|
| 1 | V1-DB | origin/claude/topology-api-endpoints-JTv1g | Merged | 2026-03 | Topology tables + API |
| 1 | V2-Index | origin/claude/agent-v2-digital-index-BzptT | Merged | 2026-03 | Digital index |
| 2 | V4-Canvas | feature/system-canvas | Merged | 2026-03 | React Flow canvas |
| 2 | V5-ELK | feature/elk-layout | Merged | 2026-03 | ELK layout engine |
| 2 | V6-Zoom | feature/semantic-zoom | Merged | 2026-03 | 3 zoom levels |
| 2 | C3-Wiring | feature/wire-frontend-api | Merged | 2026-03 | API wiring |
| 3 | V7-3D | feature/3d-viewer | Merged | 2026-03 | Three.js viewer |
| 3 | V8-Sync | feature/selection-bus | Merged | 2026-03 | 2D↔3D sync |
| 3 | V9-Index | (digital index frontend) | Merged | 2026-03 | Tag document panel |

## Session Log

<!-- Each session adds an entry here -->

### Session 1 — 2026-03-15
- **Goal**: Build automation strategy for agent merging
- **What happened**: Created automation scripts (test-branch, merge-wave, deploy-test, wave-orchestrator)
- **Result**: Scripts committed to `scripts/` directory
- **Next session should**: Run `cd frontend && npm run build` to audit current breakage, then fix issues one by one

---

## Instructions for Every New Session

1. **READ THIS FILE FIRST** — understand current state before doing anything
2. **Run the health check**: `bash scripts/deploy-test.sh --dev` to see what's broken
3. **Update "What Works" and "What Is Broken"** sections as you go
4. **Before ending**: Add a Session Log entry with what you did
5. **Commit this file** with your changes: `git add SESSION_STATE.md && git commit -m "session: update state"`
