# Multi-Agent Parallel Development: Research Study & Architecture Design

> **Project**: AssetView (GeoSoft)
> **Date**: 2026-03-14
> **Purpose**: Research and design a multi-agent orchestration system where 10-20 AI agents work in parallel on separate branches/features, supervised by a central orchestrator agent, to compress months of development into days.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Vision: Agent-of-Agents Architecture](#2-the-vision-agent-of-agents-architecture)
3. [Claude Code Native Capabilities](#3-claude-code-native-capabilities)
4. [Claude Agent SDK (Programmatic Control)](#4-claude-agent-sdk-programmatic-control)
5. [Git Worktree Isolation Strategy](#5-git-worktree-isolation-strategy)
6. [Branch Orchestration & Merge Strategy](#6-branch-orchestration--merge-strategy)
7. [Conflict Prevention Architecture](#7-conflict-prevention-architecture)
8. [Competitive Landscape: Multi-Agent Tools](#8-competitive-landscape-multi-agent-tools)
9. [AssetView-Specific Multi-Agent Design](#9-assetview-specific-multi-agent-design)
10. [Implementation Blueprint](#10-implementation-blueprint)
11. [Cost Analysis & Rate Limits](#11-cost-analysis--rate-limits)
12. [Risks & Mitigations](#12-risks--mitigations)
13. [Recommended Approach](#13-recommended-approach)
14. [Sources & References](#14-sources--references)

---

## 1. Executive Summary

### The Problem

AssetView has 6+ phases of development (database, backend API, frontend Miller Columns, P&ID viewer, AI chat, real-time annotations) with dozens of sub-features. Sequential single-agent development means months of work. We want to parallelize this across 10-20 AI agents working simultaneously.

### The Solution Space

Three concrete approaches exist today (March 2026):

| Approach | Maturity | Effort | Parallelism |
|----------|----------|--------|-------------|
| **Claude Code Agent Teams** | Experimental (Feb 2026) | Low | 3-16 agents, peer-based |
| **Claude Agent SDK orchestrator** | Production | Medium | Unlimited, programmatic |
| **Hybrid: SDK + GitHub Actions + Worktrees** | Production | High | Unlimited, CI-integrated |

### Key Findings

1. **Claude Code Agent Teams** is exactly what you described — a lead agent supervising teammates on separate worktrees. It exists as an experimental feature since February 2026.
2. **Git worktrees** are the universal isolation mechanism — every tool in the ecosystem uses them.
3. **Directory-level ownership** is the primary conflict prevention strategy — each agent owns specific directories and cannot cross boundaries.
4. **Merge order matters** — database first, backend second, frontend third (respects dependency chain).
5. **Cursor found that 20 parallel agents degrade to 2-3x throughput** — the sweet spot is 5-8 agents with clear ownership boundaries.

---

## 2. The Vision: Agent-of-Agents Architecture

### What You Described

```
                    ┌─────────────────────┐
                    │   ORCHESTRATOR      │
                    │   (Lead Agent)      │
                    │                     │
                    │ • Designs work plan  │
                    │ • Splits into tasks  │
                    │ • Assigns to agents  │
                    │ • Monitors progress  │
                    │ • Merges branches    │
                    │ • Resolves conflicts │
                    │ • Sends updates back │
                    └──────────┬──────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
     ┌──────┴──────┐   ┌──────┴──────┐   ┌──────┴──────┐
     │  Agent Pool │   │  Agent Pool │   │  Agent Pool │
     │  DATABASE   │   │  BACKEND    │   │  FRONTEND   │
     ├─────────────┤   ├─────────────┤   ├─────────────┤
     │ Agent-DB-1  │   │ Agent-API-1 │   │ Agent-UI-1  │
     │ Agent-DB-2  │   │ Agent-API-2 │   │ Agent-UI-2  │
     │             │   │ Agent-API-3 │   │ Agent-UI-3  │
     │             │   │             │   │ Agent-UI-4  │
     └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
            │                  │                  │
     ┌──────┴──────┐   ┌──────┴──────┐   ┌──────┴──────┐
     │ branch:     │   │ branch:     │   │ branch:     │
     │ feat/db-*   │   │ feat/api-*  │   │ feat/ui-*   │
     └─────────────┘   └─────────────┘   └─────────────┘
            │                  │                  │
            └──────────────────┼──────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │    Agent-QA         │
                    │ (Testing Agent)     │
                    │ • Runs tests        │
                    │ • Integration tests │
                    │ • Reports failures  │
                    └─────────────────────┘
```

### The Workflow

1. **Orchestrator** reads the project spec (CLAUDE.md, architecture guide)
2. **Orchestrator** breaks work into independent tasks with clear file ownership
3. **Orchestrator** spawns agents, each in their own git worktree/branch
4. **Agents** work independently, committing to their branches
5. **Orchestrator** periodically:
   - Checks agent progress
   - Merges completed branches into main (dependency order)
   - Rebases remaining branches on updated main
   - Sends accumulated changes back to agents
6. **QA Agent** runs tests after each merge
7. **Orchestrator** handles conflicts and coordinates cross-boundary changes

---

## 3. Claude Code Native Capabilities

### 3.1 Agent Teams (Experimental — February 2026)

**This is the closest to what you want, built directly into Claude Code.**

**Enable:**
```json
// .claude/settings.json or ~/.claude/settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

**Requirements:** Claude Code v2.1.32+

**Architecture:**
- **Peer-based model** (not hierarchical) — teammates can message each other directly
- One session acts as **team lead**, spawns and coordinates teammates
- Shared **task list** in `~/.claude/teams/{team-name}/`
- **Mailbox system** for inter-agent messaging at `~/.claude/teams/{team}/inboxes/`
- File-lock-based task claiming prevents race conditions

**Display modes:**
- `in-process` — all teammates in your terminal, cycle with Shift+Down
- `tmux` / `auto` — each teammate in its own tmux/iTerm2 pane

**Key capabilities:**
- Lead assigns tasks or teammates self-claim from shared task list
- Task dependencies with automatic unblocking
- Plan approval workflow — teammates plan first, lead approves before implementation
- `TeammateIdle` and `TaskCompleted` hooks for quality gates
- Direct messages and broadcasts between agents

**Real-world test:** Anthropic stress-tested Agent Teams with **16 agents building a 100K-line C compiler** across ~2,000 sessions.

**Limitations:**
- No session resumption with in-process teammates
- One team per session, no nested teams
- Lead is fixed once established
- All teammates inherit lead's permissions
- Task status can lag behind actual progress
- Cost: 3-agent team costs ~2.5x more tokens but finishes ~2x faster

**CLI:**
```bash
claude --worktree feature-auth --tmux  # Launch agent in its own worktree + tmux pane
```

### 3.2 Subagents (Production)

Subagents run within a single session with their own context window, system prompt, and tool access.

**Define via files:** `.claude/agents/my-agent.md`

```markdown
---
name: backend-specialist
description: Implements Fastify API routes
tools: ["Read", "Edit", "Bash", "Grep", "Glob"]
model: sonnet
isolation: worktree
---

You are a backend specialist. You implement Fastify routes and Prisma queries.
Only modify files in the backend/ directory.
```

**Key properties:**
- `isolation: worktree` — agent gets its own full copy of the repository
- `background: true` — agent runs in the background, returns when done
- `model` — can use different models (haiku for fast tasks, opus for complex ones)
- `maxTurns` — limit iterations to prevent runaway agents
- `hooks` — lifecycle hooks for quality gates

**Limitation:** Subagents cannot talk to each other — they only report back to the parent.

### 3.3 Headless Mode (`-p` / `--print`)

Run Claude Code non-interactively for scripting and CI/CD:

```bash
# Single query
claude -p "Implement the GET /systems endpoint" \
  --allowedTools "Read,Edit,Bash,Grep,Glob" \
  --output-format json \
  --max-turns 30

# Multi-turn session
session_id=$(claude -p "Start implementing auth" --output-format json | jq -r '.session_id')
claude -p "Now add tests for auth" --resume "$session_id"
```

**Key flags:**

| Flag | Purpose |
|------|---------|
| `-p "prompt"` | Non-interactive query |
| `--output-format json` | Structured output with cost, duration, session_id |
| `--allowedTools "..."` | Pre-approve tools (no permission prompts) |
| `--max-turns N` | Limit agentic iterations |
| `--no-user-prompt` | Prevent confirmation requests (CI mode) |
| `--resume SESSION_ID` | Continue previous session |
| `--worktree NAME` | Run in isolated git worktree |

### 3.4 Hooks for Quality Gates

```json
// .claude/settings.json
{
  "hooks": {
    "TaskCompleted": [
      {
        "command": "bash -c 'cd backend && npm test'",
        "description": "Run tests when agent marks task complete"
      }
    ],
    "TeammateIdle": [
      {
        "command": "bash -c 'echo \"Keep working on your assigned task\" >&2; exit 2'",
        "description": "Redirect idle teammates back to work"
      }
    ]
  }
}
```

Hook exit codes: `0` = allow, `2` = block (stderr message fed back to Claude).

### 3.5 `/batch` Command (Built-in Parallel Execution)

Claude Code's `/batch` command executes migrations using parallel agents with git worktree isolation:

1. You describe the migration task
2. Claude creates a plan (which files/modules to process)
3. After approval, spawns **one background agent per unit**, all running simultaneously
4. Each worker: implements changes, runs tests, undergoes code review, commits, pushes, creates PR
5. Each agent gets its own branch and working copy via git worktrees

---

## 4. Claude Agent SDK (Programmatic Control)

The SDK lets you build a custom orchestrator that programmatically spawns and manages agents.

### 4.1 Installation

```bash
# Python
pip install claude-agent-sdk

# TypeScript
npm install @anthropic-ai/claude-agent-sdk
```

### 4.2 Simple Query

```python
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt="Implement the GET /systems endpoint in backend/src/routes/systems.js",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Edit", "Bash", "Grep", "Glob"],
        permission_mode="acceptEdits",
    ),
):
    if hasattr(message, "result"):
        print(f"Done: {message.result}")
```

### 4.3 Orchestrator with Sub-Agents

```python
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

# Define specialized agents
agents = {
    "backend-dev": AgentDefinition(
        description="Fastify backend developer",
        prompt="You implement Fastify routes and Prisma queries. Only modify files in backend/.",
        tools=["Read", "Edit", "Bash", "Grep", "Glob"],
        model="sonnet",
    ),
    "frontend-dev": AgentDefinition(
        description="React frontend developer",
        prompt="You implement React components with Tailwind CSS. Only modify files in frontend/.",
        tools=["Read", "Edit", "Bash", "Grep", "Glob"],
        model="sonnet",
    ),
    "test-engineer": AgentDefinition(
        description="Test engineer",
        prompt="You write and run tests. You verify implementations work correctly.",
        tools=["Read", "Bash", "Grep", "Glob"],
        model="haiku",
    ),
}

# Orchestrator prompt
orchestrator_prompt = """
You are the lead architect for AssetView. Your job is to:
1. Break down the implementation plan into independent tasks
2. Assign tasks to specialized agents (backend-dev, frontend-dev, test-engineer)
3. Ensure each agent only modifies files in its owned directory
4. After agents complete, verify integration works
"""

async for message in query(
    prompt=orchestrator_prompt,
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Grep", "Glob", "Bash", "Agent"],
        agents=agents,
    ),
):
    print(message)
```

### 4.4 Parallel Agent Execution

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def run_agent(task: str, worktree: str) -> str:
    result = None
    async for msg in query(
        prompt=task,
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Edit", "Bash", "Grep", "Glob"],
            permission_mode="acceptEdits",
        ),
    ):
        if hasattr(msg, "result"):
            result = msg.result
    return result

# Run multiple agents in parallel
results = await asyncio.gather(
    run_agent("Implement systems API endpoint", "backend-systems"),
    run_agent("Implement pnids API endpoint", "backend-pnids"),
    run_agent("Implement lines API endpoint", "backend-lines"),
    run_agent("Build MillerColumns React component", "frontend-columns"),
    run_agent("Build RegisterView React component", "frontend-registers"),
)
```

### 4.5 Key SDK Facts

- **Python**: `pip install claude-agent-sdk` (v0.1.48)
- **TypeScript**: `npm install @anthropic-ai/claude-agent-sdk` (v0.2.71)
- Bundles Claude Code CLI automatically — no separate install
- Subagents cannot spawn other subagents (no nesting)
- Subagents can be resumed to continue with full conversation history
- GitHub: `anthropics/claude-agent-sdk-python`, `anthropics/claude-agent-sdk-typescript`

---

## 5. Git Worktree Isolation Strategy

### 5.1 How Git Worktrees Work

Git worktrees let you check out multiple branches into separate directories simultaneously, sharing a single `.git` database:

```bash
# Create worktrees for each agent
git worktree add ../agent-db feature/database-schema
git worktree add ../agent-api feature/backend-api
git worktree add ../agent-ui feature/frontend-columns
git worktree add ../agent-viewer feature/pid-viewer
git worktree add ../agent-tests feature/testing

# List active worktrees
git worktree list

# Clean up when done
git worktree remove ../agent-db
git worktree prune
```

### 5.2 What's Shared vs. Isolated

| Shared (all worktrees) | Isolated (per worktree) |
|------------------------|------------------------|
| `.git` object database | Working directory |
| Remote configuration | HEAD (current branch) |
| Branch metadata | Index (staging area) |
| Tags | Working files |
| Hooks | Build artifacts |
| Config | `node_modules` |

### 5.3 Hard Limitations

1. **Branch exclusivity** — Two worktrees cannot have the same branch checked out. Git enforces this.
2. **Runtime isolation** — Worktrees share ports, databases, environment. Two agents running `npm run dev` will fight over port 3001 unless configured with different ports.
3. **Dependency duplication** — Each worktree needs its own `node_modules`. 5 worktrees ≈ 5x disk space for dependencies.
4. **No conflict warnings** — Git does not warn when two worktrees edit the same file on different branches. Conflicts discovered at merge time only.
5. **Memory usage** — Each worktree with an active agent + build uses 2-4GB RAM. 5-6 concurrent worktrees comfortable on 32GB; 10+ needs 64GB.

### 5.4 Claude Code's Built-in Worktree Support

```bash
# Launch Claude Code in its own worktree
claude --worktree feature-auth

# Creates .claude/worktrees/feature-auth/ with a new branch
# Launches session scoped to that directory
# Auto-cleans if no changes made

# Combine with tmux for multiple agents
claude --worktree feature-auth --tmux
claude --worktree feature-payments --tmux
claude --worktree feature-search --tmux
```

### 5.5 Worktree Map for AssetView

```bash
# Main repository
/home/user/PID_assetview/               # main branch (orchestrator)

# Agent worktrees
../assetview-agent-db/                   # feature/database-optimization
../assetview-agent-api-systems/          # feature/api-systems
../assetview-agent-api-search/           # feature/api-search
../assetview-agent-ui-columns/           # feature/ui-miller-columns
../assetview-agent-ui-registers/         # feature/ui-register-views
../assetview-agent-ui-topbar/            # feature/ui-topbar
../assetview-agent-pid-viewer/           # feature/pid-viewer
../assetview-agent-chat/                 # feature/ai-chat
../assetview-agent-websocket/            # feature/websocket-annotations
../assetview-agent-tests/                # feature/testing
```

---

## 6. Branch Orchestration & Merge Strategy

### 6.1 Merge Order (Dependency Chain)

Branches must be merged in dependency order:

```
Phase 1: Database (no dependencies)
    └── feature/database-schema
    └── feature/database-seed

Phase 2: Backend API (depends on database)
    └── feature/api-systems
    └── feature/api-pnids
    └── feature/api-lines
    └── feature/api-equipment
    └── feature/api-search

Phase 3: Frontend (depends on backend API)
    └── feature/ui-miller-columns
    └── feature/ui-register-views
    └── feature/ui-topbar
    └── feature/ui-pid-viewer

Phase 4: Integration (depends on frontend + backend)
    └── feature/ai-chat
    └── feature/websocket-annotations
```

### 6.2 Merge Workflow

```bash
# 1. Orchestrator merges database first (no dependencies)
git checkout main
git merge feature/database-schema
git merge feature/database-seed

# 2. Rebase all backend branches on updated main
for branch in feature/api-systems feature/api-pnids feature/api-lines; do
    git checkout $branch
    git rebase main
done

# 3. Merge backend branches
git checkout main
git merge feature/api-systems
git merge feature/api-pnids
git merge feature/api-lines

# 4. Rebase frontend branches on updated main (now has DB + API)
for branch in feature/ui-miller-columns feature/ui-register-views; do
    git checkout $branch
    git rebase main
done

# 5. Merge frontend branches
git checkout main
git merge feature/ui-miller-columns
git merge feature/ui-register-views
```

### 6.3 Non-Destructive Conflict Detection

Before merging, check for conflicts without applying:

```bash
# Git 2.38+ merge-tree (truly non-destructive)
git merge-tree --write-tree main feature/backend-api
# Exit code 0 = clean merge, non-zero = conflicts

# Or traditional dry-run
git merge --no-commit --no-ff feature/backend-api
git diff --name-only --diff-filter=U   # List conflicted files
git merge --abort                       # Back out
```

### 6.4 Rebase vs. Merge for Propagating Main Changes

| Approach | When to Use | For AI Agents? |
|----------|-------------|----------------|
| **Rebase** | Short-lived branches (< 1 day) | **Yes — preferred** |
| **Merge main into branch** | Long-lived shared branches | Only if branch is shared |

**For AI agents, always rebase.** Agent branches are ephemeral (minutes to hours). Linear history makes review easier. Safe because agent branches are not shared with other developers.

### 6.5 Automated Merge with GitHub Merge Queue

```yaml
# .mergify.yml
pull_request_rules:
  - name: Auto-merge agent PRs when CI passes
    conditions:
      - label=agent-pr
      - check-success=integration-tests
      - "#approved-reviews-by>=1"
    actions:
      merge:
        method: squash

  - name: Auto-rebase on main when out of date
    conditions:
      - -merged
      - -closed
      - label=agent-pr
    actions:
      update:
        method: rebase
```

---

## 7. Conflict Prevention Architecture

### 7.1 Directory-Level Ownership (Primary Strategy)

```
# AGENT OWNERSHIP MAP (committed to main before agents start)

Agent-DB:           database/**
Agent-API-Systems:  backend/src/routes/systems.js
Agent-API-PNIDs:    backend/src/routes/pnids.js
Agent-API-Lines:    backend/src/routes/lines.js
Agent-API-Equip:    backend/src/routes/equipment.js
Agent-API-Search:   backend/src/routes/search.js
Agent-UI-Columns:   frontend/src/components/MillerColumns.jsx
                    frontend/src/components/Column.jsx
Agent-UI-Registers: frontend/src/components/RegisterView.jsx
Agent-UI-TopBar:    frontend/src/components/TopBar.jsx
Agent-UI-Viewer:    frontend/src/components/PnidViewer.jsx
Agent-Tests:        backend/src/api.test.js
                    backend/src/__tests__/**

# SHARED FILES (orchestrator only, no agent may modify):
#   package.json (root, backend, frontend)
#   docker-compose.yml
#   backend/src/server.js (route registration)
#   frontend/src/App.jsx (component composition)
#   frontend/src/hooks/useApi.js (API hooks)
#   backend/prisma/schema.prisma
```

### 7.2 Interface Contracts (Define Before Branching)

Before agents start, commit API contracts to main:

```typescript
// contracts/api-types.ts (committed to main)

// Systems API
interface SystemsResponse {
  data: Array<{
    id: string;
    name: string;
    code: string;
    sys_type: 'process' | 'utility' | 'safety' | 'instrument';
    platform_id: string;
    pnid_count: number;
    line_count: number;
    equipment_count: number;
  }>;
}

// P&IDs API
interface PnidsResponse {
  data: Array<{
    id: string;
    drawing_number: string;
    title: string;
    revision: string;
    status: string;
    primary_system: { id: string; name: string; code: string; };
    is_xref: boolean;
  }>;
}

// ... etc for all endpoints
```

### 7.3 Shared File Protocol

For files that must be modified by multiple agents (e.g., `server.js` for route registration):

**Option A: Orchestrator modifies shared files on main before agents start**
```javascript
// backend/src/server.js — orchestrator adds all route imports
import systemsRoute from './routes/systems.js';
import pnidsRoute from './routes/pnids.js';
// ... all imports pre-defined

fastify.register(systemsRoute);
fastify.register(pnidsRoute);
// ... all registrations pre-defined
```

**Option B: Convention-based auto-registration**
```javascript
// backend/src/server.js — auto-discover routes
import { readdirSync } from 'fs';
const routeFiles = readdirSync('./src/routes').filter(f => f.endsWith('.js'));
for (const file of routeFiles) {
  const route = await import(`./routes/${file}`);
  fastify.register(route.default);
}
```

Option B eliminates `server.js` as a shared file entirely.

### 7.4 Google/Meta Patterns Applied

| Pattern | How Google Does It | How We Apply It |
|---------|-------------------|-----------------|
| OWNERS files | Each directory has an OWNERS file | Each agent has an ownership manifest |
| Trunk-based | All commits to trunk, no branches | Agents use short-lived branches (hours) |
| Small CLs | Changes are small and focused | Each agent task is one feature/endpoint |
| Pre-submit checks | Automated tests before merge | QA agent runs tests after each merge |
| Feature flags | Toggle new behavior | Not needed — we control the entire build |

---

## 8. Competitive Landscape: Multi-Agent Tools

### 8.1 Purpose-Built Parallel Coding Tools

| Tool | Agents | Git Isolation | Coordination | Cost | Status |
|------|--------|---------------|--------------|------|--------|
| **Claude Code Agent Teams** | 3-16 | Git worktrees | Peer messaging, shared tasks | API costs | Experimental (Feb 2026) |
| **Composio Agent Orchestrator** | Any | Git worktrees + branches | CI-aware, auto-fix | Free (OSS) | Production |
| **Superset IDE** | 10+ | Git worktrees | Terminal-based | Free (Apache 2.0) | New (Mar 2026) |
| **Overstory** | Any | Git worktrees via tmux | SQLite mail, tiered conflict resolution | Free (OSS) | Production |
| **parallel-code** | 3 | Git worktrees | Side-by-side (Claude + Codex + Gemini) | Free (OSS) | Production |

### 8.2 AI IDEs with Multi-Agent

| Tool | Agents | Isolation | Best For | Cost |
|------|--------|-----------|----------|------|
| **Cursor** | Up to 8 | Subagent isolation | IDE-centric, background agents | $20/mo |
| **Windsurf** | Multi-session | Git worktrees | Large monorepos | $15/mo |
| **Devin** | Unlimited parallel | Cloud IDE per session | Well-defined isolated tasks | $20/mo |

### 8.3 General Multi-Agent Frameworks

| Framework | Git-Aware | Code-Specific | Effort to Adapt | Best For |
|-----------|-----------|---------------|-----------------|----------|
| **CrewAI** | No | No | High | General agent workflows |
| **AutoGen/MS Agent Framework** | No | No | High | Enterprise .NET/Python |
| **LangGraph** | No | No | Very High | Custom complex workflows |
| **OpenHands** | Docker containers | Yes | Medium | Self-hosted at scale |

### 8.4 Critical Finding from Cursor

Cursor's engineering team discovered that **equal-status agents with file locking** caused 20 agents to degrade to the throughput of only 2-3. Their successful architecture uses three roles:

1. **Planners** — explore codebase, create task breakdown
2. **Workers** — execute tasks independently in isolation
3. **Judges** — determine if work is complete, request rework

This is the **Orchestrator → Worker → Validator** pattern that works at scale.

---

## 9. AssetView-Specific Multi-Agent Design

### 9.1 Task Decomposition for AssetView

Based on the current implementation status and remaining work:

#### Wave 1: Foundation (Agents 1-3, run in parallel)

| Agent | Branch | Owns | Task |
|-------|--------|------|------|
| Agent-DB | `feat/db-optimization` | `database/` | Optimize schema, add missing indexes, improve search function |
| Agent-API-Core | `feat/api-core` | `backend/src/routes/{platforms,systems,pnids}.js` | Refine core Miller Column APIs |
| Agent-UI-Design | `feat/ui-design-system` | `frontend/src/data/constants.js`, `frontend/tailwind.config.js` | Finalize M3 design tokens |

#### Wave 2: Features (Agents 4-10, run in parallel after Wave 1 merges)

| Agent | Branch | Owns | Task |
|-------|--------|------|------|
| Agent-API-Lines | `feat/api-lines` | `backend/src/routes/lines.js` | Line API with continuation tracking |
| Agent-API-Equip | `feat/api-equipment` | `backend/src/routes/equipment.js` | Equipment API with criticality |
| Agent-API-Search | `feat/api-search` | `backend/src/routes/search.js` | Global search with pg_trgm |
| Agent-UI-Columns | `feat/ui-columns` | `frontend/src/components/MillerColumns.jsx`, `Column.jsx` | Miller Columns cascade logic |
| Agent-UI-Registers | `feat/ui-registers` | `frontend/src/components/RegisterView.jsx` | Register table views |
| Agent-UI-Viewer | `feat/ui-pid-viewer` | `frontend/src/components/PnidViewer.jsx` | P&ID viewer with hotspots |
| Agent-Tests | `feat/testing` | `backend/src/__tests__/` | Write comprehensive test suite |

#### Wave 3: Integration (Agents 11-14, run in parallel after Wave 2 merges)

| Agent | Branch | Owns | Task |
|-------|--------|------|------|
| Agent-Chat | `feat/ai-chat` | `backend/src/routes/chat.js`, `frontend/src/components/ChatPanel.jsx` | AI chat with Claude function calling |
| Agent-WS | `feat/websocket` | `backend/src/routes/annotations.js`, `frontend/src/components/AnnotationLayer.jsx` | Real-time annotations |
| Agent-Admin | `feat/admin-panel` | `frontend/src/components/admin/` | Admin CRUD interface |
| Agent-Integration | `feat/integration` | None (read-only) | Integration testing, bug fixes |

#### Wave 4: Polish (Agents 15-18, run in parallel after Wave 3 merges)

| Agent | Branch | Owns | Task |
|-------|--------|------|------|
| Agent-3D | `feat/3d-integration` | `frontend/src/components/VTViewer.jsx` | Virtual Tour / 3D integration |
| Agent-CMMS | `feat/cmms` | `backend/src/routes/cmms.js` | CMMS integration |
| Agent-Perf | `feat/performance` | Various (read-only analysis) | Performance optimization |
| Agent-Docs | `feat/documentation` | `docs/` | API docs, user guides |

### 9.2 Dependency Graph

```
Wave 1 (Foundation)
├── Agent-DB ──────────────────────────────────┐
├── Agent-API-Core ────────────────────────────┤ MERGE to main
└── Agent-UI-Design ───────────────────────────┘
                                               │
Wave 2 (Features) ◄────────────────────────────┘
├── Agent-API-Lines ───────────────────────────┐
├── Agent-API-Equip ───────────────────────────┤
├── Agent-API-Search ──────────────────────────┤
├── Agent-UI-Columns ──────────────────────────┤ MERGE to main
├── Agent-UI-Registers ────────────────────────┤
├── Agent-UI-Viewer ───────────────────────────┤
└── Agent-Tests ───────────────────────────────┘
                                               │
Wave 3 (Integration) ◄────────────────────────┘
├── Agent-Chat ────────────────────────────────┐
├── Agent-WS ──────────────────────────────────┤ MERGE to main
├── Agent-Admin ───────────────────────────────┤
└── Agent-Integration ─────────────────────────┘
                                               │
Wave 4 (Polish) ◄──────────────────────────────┘
├── Agent-3D ──────────────────────────────────┐
├── Agent-CMMS ────────────────────────────────┤ FINAL MERGE
├── Agent-Perf ────────────────────────────────┤
└── Agent-Docs ────────────────────────────────┘
```

### 9.3 Shared File Resolution for AssetView

| Shared File | Strategy |
|-------------|----------|
| `backend/src/server.js` | Auto-discover routes (no manual registration needed) |
| `frontend/src/App.jsx` | Orchestrator pre-defines component imports, agents only modify their own components |
| `frontend/src/hooks/useApi.js` | Each agent adds hooks to a separate file (`useSystemsApi.js`, `usePnidsApi.js`), main exports them |
| `backend/prisma/schema.prisma` | Agent-DB owns exclusively; other agents read but never modify |
| `package.json` | Orchestrator manages; agents request dependency additions via message |

---

## 10. Implementation Blueprint

### 10.1 Option A: Claude Code Agent Teams (Simplest)

```bash
# Step 1: Enable Agent Teams
echo '{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"}}' > .claude/settings.json

# Step 2: Launch lead agent
claude

# Step 3: In the lead session, instruct:
# "Create a team with 6 teammates:
#  1. database-agent: optimizes schema in database/
#  2. backend-api-agent: implements routes in backend/src/routes/
#  3. frontend-columns-agent: builds Miller Columns in frontend/src/components/
#  4. frontend-viewer-agent: builds P&ID viewer in frontend/src/components/PnidViewer.jsx
#  5. test-agent: writes tests in backend/src/__tests__/
#  6. Each agent works in its own worktree on its own branch
#  Merge database first, then backend, then frontend."
```

**Pros:** Simplest setup, built-in messaging, built-in task list, Anthropic-maintained
**Cons:** Experimental, limited to one team, no nested teams, max ~16 agents tested

### 10.2 Option B: Claude Agent SDK Orchestrator (Most Control)

```python
#!/usr/bin/env python3
"""AssetView Multi-Agent Orchestrator"""

import asyncio
import subprocess
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

# Define agent specializations
AGENTS = {
    "db-agent": AgentDefinition(
        description="Database schema specialist",
        prompt="""You are a PostgreSQL specialist. Your task is to optimize the AssetView database.
Only modify files in the database/ directory.
Run schema.sql and seed.sql to verify changes work.""",
        tools=["Read", "Edit", "Bash", "Grep", "Glob"],
        model="sonnet",
    ),
    "api-agent": AgentDefinition(
        description="Fastify backend API developer",
        prompt="""You implement Fastify API routes with Prisma ORM.
Only modify files in backend/src/routes/.
Follow the existing route pattern in platforms.js.""",
        tools=["Read", "Edit", "Bash", "Grep", "Glob"],
        model="sonnet",
    ),
    "ui-agent": AgentDefinition(
        description="React frontend developer",
        prompt="""You build React 18 components with Tailwind CSS.
Only modify files in frontend/src/components/.
Use React Query for data fetching (see hooks/useApi.js).""",
        tools=["Read", "Edit", "Bash", "Grep", "Glob"],
        model="sonnet",
    ),
    "test-agent": AgentDefinition(
        description="Test engineer",
        prompt="""You write tests using Node.js built-in test runner.
Verify all API endpoints work correctly.
Run: cd backend && npm test""",
        tools=["Read", "Bash", "Grep", "Glob"],
        model="haiku",
    ),
}

ORCHESTRATOR_PROMPT = """
You are the lead architect for AssetView, an oil & gas asset management platform.

Read CLAUDE.md and docs/ARCHITECTURE_AND_METHODOLOGY_GUIDE.md first.

Your job:
1. Break remaining work into independent tasks (see implementation status in the guide)
2. Assign each task to the appropriate specialist agent
3. Ensure agents only modify files they own
4. After each agent completes, run tests
5. Report progress

Available agents: db-agent, api-agent, ui-agent, test-agent

Work in waves:
- Wave 1: Database optimizations (db-agent)
- Wave 2: Backend API refinements (api-agent) — after Wave 1 merges
- Wave 3: Frontend components (ui-agent) — after Wave 2 merges
- Wave 4: Full test suite (test-agent) — after Wave 3 merges
"""

async def main():
    async for message in query(
        prompt=ORCHESTRATOR_PROMPT,
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Grep", "Glob", "Bash", "Agent"],
            agents=AGENTS,
            permission_mode="acceptEdits",
        ),
    ):
        print(message)

asyncio.run(main())
```

**Pros:** Full programmatic control, can integrate with CI/CD, unlimited agents
**Cons:** More setup, need to manage worktrees yourself, subagents can't nest

### 10.3 Option C: GitHub Actions + Headless Claude Code (CI-Integrated)

```yaml
# .github/workflows/parallel-agents.yml
name: Parallel Agent Development

on:
  workflow_dispatch:
    inputs:
      wave:
        description: 'Wave number (1-4)'
        required: true
        type: choice
        options: ['1', '2', '3', '4']

jobs:
  agent-matrix:
    strategy:
      matrix:
        include:
          # Wave 1
          - agent: db-agent
            branch: feat/database-optimization
            prompt: "Optimize database schema in database/"
            wave: 1
          # Wave 2
          - agent: api-systems
            branch: feat/api-systems
            prompt: "Implement GET /platforms/:id/systems endpoint"
            wave: 2
          - agent: api-pnids
            branch: feat/api-pnids
            prompt: "Implement GET /pnids endpoint with x-ref support"
            wave: 2
          # ... more agents

    if: matrix.wave == inputs.wave
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          ref: main

      - name: Create feature branch
        run: |
          git checkout -b ${{ matrix.branch }}

      - name: Run Claude Code agent
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx claude -p "${{ matrix.prompt }}" \
            --allowedTools "Read,Edit,Bash,Grep,Glob" \
            --max-turns 50 \
            --output-format json \
            --no-user-prompt

      - name: Push and create PR
        run: |
          git add -A
          git commit -m "Agent: ${{ matrix.agent }} completed"
          git push origin ${{ matrix.branch }}
          gh pr create \
            --title "[${{ matrix.agent }}] Automated implementation" \
            --body "Automated by Claude Code agent" \
            --label agent-pr
```

**Pros:** Fully automated, CI-integrated, scalable, audit trail
**Cons:** Highest setup effort, cold start per agent, no inter-agent communication during execution

### 10.4 Option D: Composio Agent Orchestrator (Third-Party)

```bash
# Install
pip install composio-agent-orchestrator

# Configure
composio config set --runtime claude-code
composio config set --tracker github

# Run parallel agents
composio orchestrate \
  --repo /home/user/PID_assetview \
  --agents "db:database/ api:backend/ ui:frontend/" \
  --worktree-isolation \
  --auto-pr \
  --ci-fix
```

**Pros:** Agent-agnostic (Claude, Codex, Gemini), CI-aware auto-fix, production-ready
**Cons:** Third-party dependency, less Claude-specific optimization

---

## 11. Cost Analysis & Rate Limits

### 11.1 Claude Pricing Tiers (2026)

| Plan | Price | Usage | Recommended For |
|------|-------|-------|-----------------|
| Pro | $20/mo | ~45 messages / 5-hour window | Single agent |
| Max 5x | $100/mo | 5x Pro | 2-3 concurrent agents |
| Max 20x | $200/mo | 20x Pro, maximum priority | 5-10 concurrent agents |
| API | Pay-per-token | No rate limits (with scaling) | 10-20 agents via SDK |
| Enterprise | Custom | Custom | Large teams |

### 11.2 Cost Estimates for AssetView

**Single agent (current approach):**
- ~$20-50/day on Max plan
- ~4-8 weeks to complete all phases
- Total: ~$400-800

**Multi-agent (10 agents, 4 waves):**
- API tokens: ~$50-100/day (Opus for orchestrator, Sonnet for workers)
- Duration: 3-5 days for all 4 waves
- Total: ~$200-500
- **Net savings: 80-90% time reduction for similar or lower cost**

**Batch API (50% discount):**
- Using Claude's Message Batches API: 50% cost reduction
- Best for non-interactive work (code generation, testing)

### 11.3 Token Economics

From Anthropic's own research:
- Single agent: ~1x tokens per task
- Multi-agent system: ~4x tokens for chat, ~15x for deep research
- 3-agent team: ~2.5x tokens, ~2x speed
- **The parallelism pays for itself in developer time saved**

---

## 12. Risks & Mitigations

### 12.1 Merge Conflicts

**Risk:** Agents modify the same file, creating conflicts at merge time.
**Mitigation:** Directory-level ownership map, interface contracts committed before branching, non-destructive merge-tree checks before merging.

### 12.2 Semantic Conflicts (No Git Conflict, But Broken Code)

**Risk:** Agent A changes an API response shape, Agent B's frontend expects the old shape. No git conflict, but integration is broken.
**Mitigation:** Define API contracts before branching. QA agent runs integration tests after each merge.

### 12.3 Shared State Problems

**Risk:** Multiple agents running `npm run dev` fight over port 3001.
**Mitigation:** Each worktree uses a different port (via env vars). Or don't run dev servers — agents just edit code and commit.

### 12.4 Agent Quality Variance

**Risk:** Some agents produce low-quality code that requires extensive rework.
**Mitigation:** Use `TaskCompleted` hooks to run linters and tests. Orchestrator reviews before merging. Use Opus for complex tasks, Sonnet for straightforward tasks.

### 12.5 Cost Runaway

**Risk:** Agents loop endlessly, consuming tokens.
**Mitigation:** `--max-turns N` flag limits iterations. Budget alerts on API usage.

### 12.6 Cursor's 20-Agent Degradation Finding

**Risk:** Too many agents on the same codebase degrade to 2-3x throughput.
**Mitigation:** Strict directory ownership (no file locking needed). Wave-based execution (only 3-7 agents per wave). Each agent is truly independent — no shared state during execution.

---

## 13. Recommended Approach

### For AssetView Specifically

**Start with Option A (Agent Teams)** for Wave 1 (3 agents, database/backend/frontend foundations). This is the simplest path with zero custom code.

**Graduate to Option B (SDK Orchestrator)** for Waves 2-4 (7-14 agents), where you need more control over task assignment, merge ordering, and quality gates.

**Add Option C (GitHub Actions)** for ongoing maintenance — automated agent PRs for bug fixes, dependency updates, and small features.

### Step-by-Step Getting Started

```bash
# 1. Ensure Claude Code is v2.1.32+
claude --version

# 2. Enable Agent Teams
mkdir -p .claude
echo '{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"}}' > .claude/settings.json

# 3. Install Agent SDK (for Option B later)
pip install claude-agent-sdk

# 4. Launch your first team
claude

# In Claude Code, say:
# "Create a team of 3 agents:
#  1. db-agent: optimize schema in database/ using its own worktree
#  2. api-agent: refine API routes in backend/src/routes/ using its own worktree
#  3. ui-agent: polish React components in frontend/src/components/ using its own worktree
#  Use the dependency order: db first, then api, then ui.
#  Run tests after each merge."
```

### The 5-Day Plan

| Day | Wave | Agents | Tasks |
|-----|------|--------|-------|
| Day 1 | Wave 1 | 3 | Database optimization, API core, Design system |
| Day 2 | Wave 2 | 7 | All API endpoints + frontend components |
| Day 3 | Wave 3 | 4 | AI chat, WebSocket, Admin panel, Integration tests |
| Day 4 | Wave 4 | 4 | 3D integration, CMMS, Performance, Documentation |
| Day 5 | Polish | 2 | Final integration testing, bug fixes, deployment prep |

**Result: 4-8 weeks of work compressed into 5 days.**

---

## 14. Sources & References

### Claude Code & Agent SDK
- [Claude Code Agent Teams Documentation](https://code.claude.com/docs/en/agent-teams)
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [Create Custom Subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless)
- [Claude Code Common Workflows (Worktrees)](https://code.claude.com/docs/en/common-workflows)
- [Claude Agent SDK Python (GitHub)](https://github.com/anthropics/claude-agent-sdk-python)
- [Claude Agent SDK TypeScript (npm)](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [Claude Agent SDK Demos (GitHub)](https://github.com/anthropics/claude-agent-sdk-demos)
- [Building Agents with Claude Agent SDK (Anthropic Engineering)](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions)
- [anthropics/claude-code-action (GitHub)](https://github.com/anthropics/claude-code-action)

### Anthropic Multi-Agent Research
- [Building Effective AI Agents (Anthropic)](https://resources.anthropic.com/building-effective-ai-agents)
- [How We Built Our Multi-Agent Research System (Anthropic Engineering)](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Building a 100K-Line C Compiler with Agent Teams (Anthropic Engineering)](https://www.anthropic.com/engineering/building-c-compiler)
- [Deploying Multi-Agent Systems Using MCP and A2A (Anthropic Webinar)](https://www.anthropic.com/webinars/deploying-multi-agent-systems-using-mcp-and-a2a-with-claude-on-vertex-ai)

### Multi-Agent Tools
- [Composio Agent Orchestrator (GitHub)](https://github.com/ComposioHQ/agent-orchestrator)
- [Overstory (GitHub)](https://github.com/jayminwest/overstory)
- [parallel-code (GitHub)](https://github.com/johannesjo/parallel-code)
- [Superset IDE (ByteIota)](https://byteiota.com/superset-ide-run-10-parallel-ai-coding-agents-2026/)
- [OpenHands (formerly OpenDevin)](https://openhands.dev/)
- [Devin 2.0 by Cognition](https://cognition.ai/blog/devin-2)
- [SWE-agent (GitHub)](https://github.com/SWE-agent/SWE-agent)
- [CrewAI (GitHub)](https://github.com/crewAIInc/crewAI)
- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/)
- [LangGraph Multi-Agent Guide](https://blog.langchain.com/langgraph-multi-agent-workflows/)

### Git Orchestration
- [Using Git Worktrees for Multi-Feature Development with AI Agents](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/)
- [How We Built True Parallel Agents With Git Worktrees (DEV Community)](https://dev.to/getpochi/how-we-built-true-parallel-agents-with-git-worktrees-2580)
- [Git Worktrees: The Secret Weapon for Parallel AI Agents (Medium)](https://medium.com/@mabd.dev/git-worktrees-the-secret-weapon-for-running-multiple-ai-coding-agents-in-parallel-e9046451eb96)
- [Nx Blog: How Git Worktrees Changed My AI Agent Workflow](https://nx.dev/blog/git-worktrees-ai-agents)
- [Parallel AI Coding with Git Worktrees and Claude Code](https://docs.agentinterviews.com/blog/parallel-ai-coding-with-gitworktrees/)
- [How Google Does Monorepo](https://qeunit.com/blog/how-google-does-monorepo/)
- [Mergify Merge Queue](https://mergify.com/product/merge-queue)
- [GitHub Merge Queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

### AI IDEs
- [Cursor v2.4/v2.5 Subagents & Background Agents](https://www.cursor.com/changelog)
- [Windsurf Wave 13 Parallel Multi-Agent Sessions](https://windsurf.com/changelog)

### Pricing
- [Claude Max Plan Pricing](https://intuitionlabs.ai/articles/claude-max-plan-pricing-usage-limits)
- [Claude API Batch Processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)

---

*This study provides the complete technical foundation for implementing parallel multi-agent development on the AssetView project. The recommended approach starts with Claude Code Agent Teams (simplest) and graduates to the Claude Agent SDK orchestrator (most control) as complexity grows.*
