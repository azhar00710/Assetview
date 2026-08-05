# COMPACT.md — Context Recovery for AssetView
> Auto-generated: 2026-03-15
> Paste this into Claude when it starts forgetting instructions.

## Project
AssetView — Oil & gas P&ID visualization platform (React 18 + Fastify + PostgreSQL)

## Current State
- **Branch**: claude/automate-agent-merging-9oDkg
- **Last commit**: automation scripts for agent wave testing/merging
- **Frontend build**: NEEDS VERIFICATION (run `cd frontend && npm run build`)
- **V1-V9 agents merged**: topology, digital index, canvas, ELK, zoom, 3D, sync, tags, API wiring

## Critical Rules (non-negotiable)
1. All colors from constants.js/theme.js — ZERO hardcoded hex
2. API calls through useApi.js hooks — no direct fetch()
3. Lines BELONG to systems, APPEAR on P&IDs (junction tables)
4. Cross-refs at 65% opacity with system color border
5. Dark mode default. P&ID canvas = light (#F5F7F7 via CANVAS_BG)
6. React Flow (@xyflow/react), Three.js, ELK.js — decisions FINAL
7. Fastify (not Express), Prisma (not raw SQL), Tailwind (not CSS modules)

## Key Files
- frontend/src/data/constants.js — SC, CC, COL, M3, EC, CANVAS_BG
- frontend/src/lib/theme.js — md(), systemColor(), critColor(), alpha()
- frontend/src/hooks/useApi.js — React Query hooks
- frontend/src/App.jsx — main app, view switching
- SESSION_STATE.md — session history & state
- CLAUDE.md — full project instructions

## Available Automation
```
bash scripts/wave-orchestrator.sh health     # Quick health check
bash scripts/wave-orchestrator.sh fix-report # Build errors grouped
bash scripts/auto-diagnose.sh               # Intelligent error classification
bash scripts/contract-check.sh              # API contract validation
bash scripts/deploy-test.sh --dev           # Full build+test
bash scripts/session-manager.sh compact     # Regenerate this file
```

## Decisions (DO NOT re-debate)
React Flow, Three.js, ELK.js, Fastify, Prisma, Tailwind, pg_trgm, wave-based agents

## Subagents Available (.claude/agents/)
fixer, qa, merger, reviewer, briefing
