#!/bin/bash
# ============================================================
# Wave: Fix & Stabilize (run this NOW to fix broken merges)
# 3 parallel agents, each fixing a different layer
# ============================================================

AGENTS=(
  "fix-frontend|fix/frontend-build|Read SESSION_STATE.md and CLAUDE.md first. You are fixing frontend build errors. Run 'cd /home/user/PID_assetview/frontend && npm run build 2>&1' and fix ALL errors. Fix in order: hooks/ first, then lib/, then components/, then App.jsx. All colors must come from constants.js/theme.js. When build passes, commit with message 'fix: resolve frontend build errors'. Do NOT delete any functionality — fix imports, missing exports, and type errors."

  "fix-backend|fix/backend-tests|Read SESSION_STATE.md and CLAUDE.md first. You are fixing backend test failures. Run 'cd /home/user/PID_assetview/backend && npm test 2>&1' and fix all failing tests. Check that all route files in src/routes/ have valid syntax with 'node -c'. Verify Prisma schema with 'npx prisma validate'. When all tests pass, commit with message 'fix: resolve backend test failures'."

  "fix-integration|fix/integration-check|Read SESSION_STATE.md and CLAUDE.md first. You are checking integration between frontend and backend. 1) Verify every useApi.js hook calls an endpoint that exists in backend/src/routes/. 2) Verify API response shapes match what frontend expects. 3) Check that all route registrations in server.js are correct. 4) Fix any mismatches. Commit with message 'fix: align frontend API calls with backend endpoints'."
)
