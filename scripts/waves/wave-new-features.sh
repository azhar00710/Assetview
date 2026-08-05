#!/bin/bash
# ============================================================
# Wave: New Features (example template for future waves)
# Customize agent prompts for your specific features
# ============================================================
# Format: "agent-name|branch-name|prompt"

AGENTS=(
  "agent-annotations|feature/annotations|Read CLAUDE.md and SESSION_STATE.md. Implement the annotation system: 1) Create backend/src/routes/annotations.js with CRUD endpoints. 2) Create frontend/src/components/pnid/AnnotationCanvas.jsx. 3) Use Yjs for real-time sync. Follow existing patterns in useApi.js for hooks. Build must pass."

  "agent-ai-chat|feature/ai-chat-v2|Read CLAUDE.md and SESSION_STATE.md. Improve the AI chat: 1) Update backend/src/routes/chat.js to support function calling for equipment queries. 2) Add graph traversal functions for topology queries. 3) Frontend chat panel with streaming responses. Build must pass."

  "agent-admin-import|feature/admin-import|Read CLAUDE.md and SESSION_STATE.md. Implement CSV import in admin panel: 1) Backend route for file upload and parsing. 2) Frontend ImportPreview.jsx component showing data before import. 3) Validation of CSV columns against schema. Build must pass."
)
