# Agent Session Template

> Copy and customize this for each agent session. Paste as the FIRST message
> to Claude Code so it has full context without re-reading everything.

---

## Session Context (paste this first)

```
You are working on AssetView — an oil & gas P&ID visualization platform.

CRITICAL FILES TO READ FIRST:
1. /home/user/PID_assetview/SESSION_STATE.md (what works, what's broken, decisions made)
2. /home/user/PID_assetview/CLAUDE.md (project architecture, tech stack, conventions)

CURRENT STATE:
- Waves 1-3 (agents V1-V9) have been merged into main
- Several components are broken after merge
- We are in "fix and stabilize" mode

RULES:
- All colors from constants.js/theme.js — ZERO hardcoded hex values
- All API calls through useApi.js hooks
- Frontend build (npm run build) MUST pass before committing
- Update SESSION_STATE.md before ending session
- Run: bash scripts/wave-orchestrator.sh health — before and after your work

YOUR BRANCH: [fill in]
YOUR TASK: [fill in]
YOUR ALLOWED FILES: [fill in]
```

## Per-Agent Customization

### For Fix/Stabilize Sessions:
```
YOUR TASK: Fix all build errors in the frontend.
APPROACH:
1. Run: cd frontend && npm run build 2>&1
2. Fix errors from bottom up (hooks → lib → components → App.jsx)
3. After each fix, re-run build to verify
4. When build passes, run: bash scripts/wave-orchestrator.sh health
5. Update SESSION_STATE.md with what you fixed
```

### For New Feature Sessions:
```
YOUR TASK: [describe feature]
YOUR BRANCH: feature/[name]
DEPENDENCIES: [what must be merged first]
ALLOWED FILES:
  - [list exact files this agent can create/modify]
COMPLETION CRITERIA:
  - npm run build passes
  - [specific behavior that must work]
```

## Quick Reference for Every Session

| Command | What it does |
|---------|-------------|
| `bash scripts/wave-orchestrator.sh health` | Quick health check |
| `bash scripts/wave-orchestrator.sh status` | Show all wave/branch status |
| `bash scripts/wave-orchestrator.sh fix-report` | Show build errors grouped by file |
| `bash scripts/deploy-test.sh --dev` | Full build + test cycle |
| `bash scripts/deploy-test.sh --local` | Docker compose deploy + smoke test |
| `bash scripts/deploy-test.sh --remote user@host` | Deploy to DO droplet |
| `bash scripts/test-branch.sh <branch>` | Test a branch before merging |
| `bash scripts/merge-wave.sh <branches...>` | Test + merge multiple branches |
