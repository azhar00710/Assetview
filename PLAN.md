# OCR Pipeline AI Analysis Enhancement — Implementation Plan

## Architecture Overview

Adds an **AI Analysis Module** downstream from OCR extraction and upstream from annotation. AI analysis is an async job system with results in dedicated staging tables. All generated entities start in DRAFT status until human approval.

**User-selected options:**
- AI trigger: **Manual** — user clicks "Analyze with AI" after reviewing OCR results
- Annotations: **Full Konva annotations** auto-placed from OCR bounding boxes (draft stage, draggable/deletable)
- New entities: **Auto-create + flag** — high-confidence unmatched tags get auto-created as drafts; low-confidence flagged for review

---

## Phase 1: Database Schema & Backend AI Service

### 1.1 Database Migration: `database/migration_ocr_ai_analysis.sql`

**Table: `ai_analysis_job`** — Tracks each AI analysis run.
```sql
CREATE TABLE ai_analysis_job (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id          UUID NOT NULL REFERENCES ocr_batch(id) ON DELETE CASCADE,
  platform_id       UUID NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
  status            VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  analysis_type     VARCHAR(50) DEFAULT 'full',
  prompt_template   TEXT,
  input_token_count INTEGER,
  output_token_count INTEGER,
  ai_model          VARCHAR(100),
  raw_response      JSONB,
  summary_text      TEXT,
  relationships     JSONB,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  created_by        VARCHAR(100)
);
```

**Table: `ai_generated_entity`** — Staging table for AI-suggested entities.
```sql
CREATE TABLE ai_generated_entity (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_job_id   UUID NOT NULL REFERENCES ai_analysis_job(id) ON DELETE CASCADE,
  batch_id          UUID NOT NULL,
  platform_id       UUID NOT NULL REFERENCES platform(id),
  entity_type       VARCHAR(20) NOT NULL CHECK (entity_type IN ('system','line','equipment','instrument')),
  suggested_tag     VARCHAR(200) NOT NULL,
  suggested_data    JSONB DEFAULT '{}',
  source_pnid_ids   UUID[],
  source_extractions UUID[],
  confidence        DECIMAL(4,3) DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','merged')),
  merged_entity_id  UUID,
  reviewed_by       VARCHAR(100),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

**Table: `ai_relationship`** — Discovered relationships between entities.
```sql
CREATE TABLE ai_relationship (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_job_id   UUID NOT NULL REFERENCES ai_analysis_job(id) ON DELETE CASCADE,
  from_entity_type  VARCHAR(20),
  from_entity_tag   VARCHAR(200),
  from_entity_id    UUID,
  to_entity_type    VARCHAR(20),
  to_entity_tag     VARCHAR(200),
  to_entity_id      UUID,
  relationship_type VARCHAR(50),
  pnid_id           UUID,
  confidence        DECIMAL(4,3) DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'draft',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

**New columns on `ocr_batch`:**
```sql
ALTER TABLE ocr_batch ADD COLUMN IF NOT EXISTS ai_analysis_status VARCHAR(20);
ALTER TABLE ocr_batch ADD COLUMN IF NOT EXISTS ai_analysis_job_id UUID;
```

### 1.2 Backend Service: `backend/src/services/ocr/AiAnalysisService.js`

Core functions:
- `runAiAnalysis(prisma, batchId, options)` — Main orchestrator: gathers extractions, builds prompt, calls Claude, parses response, stores results
- `buildAnalysisPrompt(batchData, existingEntities, platformContext)` — Constructs Claude prompt with OCR data + existing entities
- `parseAiResponse(rawResponse)` — Parses structured JSON from Claude
- `storeAnalysisResults(prisma, analysisJobId, parsedResults, platformId, batchId)` — Writes to staging tables; auto-creates drafts for confidence >= 0.7, flags below

Prompt instructs Claude to return:
```json
{
  "summary": "...",
  "suggestedSystems": [{ "code": "...", "name": "...", "type": "...", "reason": "..." }],
  "lineList": [{ "lineNumber": "...", "service": "...", "nominalSize": "...", "systemCode": "...", "foundOnPnids": [...] }],
  "equipmentList": [{ "tag": "...", "type": "...", "description": "...", "lineNumber": "...", "foundOnPnids": [...] }],
  "instrumentList": [{ "tag": "...", "type": "...", "description": "...", "lineNumber": "...", "foundOnPnids": [...] }],
  "relationships": [{ "from": "...", "to": "...", "type": "...", "pnid": "..." }]
}
```

### 1.3 Backend Service: `backend/src/services/ocr/AiPromptTemplates.js`

Exported constants:
- `SYSTEM_PROMPT` — Role definition as P&ID analysis expert
- `ANALYSIS_PROMPT_TEMPLATE` — Structured analysis request with placeholders
- `RELATIONSHIP_PROMPT_TEMPLATE` — Focused relationship extraction

### 1.4 Backend Service: `backend/src/services/ocr/CleanedDataImporter.js`

- `importCleanedData(prisma, batchId, uploadedData, format)` — Parse JSON/CSV, reconcile with existing extractions
- `reconcileExtractions(prisma, batchId, cleanedRecords)` — Merge: update matched_entity_id, tag_type corrections, add missing tags

---

## Phase 2: Backend Routes

### New file: `backend/src/routes/aiAnalysis.js`

Registered in `server.js` under `/api/v1`:

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/ai-analysis/batches/:batchId/analyze` | Trigger AI analysis (returns 202 + jobId) |
| GET | `/ai-analysis/jobs/:jobId` | Job status + summary |
| GET | `/ai-analysis/jobs/:jobId/entities` | List AI-generated entities (filterable) |
| GET | `/ai-analysis/jobs/:jobId/relationships` | Relationship map |
| GET | `/ai-analysis/jobs/:jobId/summary` | Summary with statistics |
| POST | `/ai-analysis/entities/:entityId/approve` | Approve → create real entity in DB |
| POST | `/ai-analysis/entities/bulk-approve` | Bulk approve above confidence threshold |
| POST | `/ai-analysis/entities/:entityId/reject` | Reject entity |
| POST | `/ai-analysis/entities/:entityId/edit` | Edit suggested_data before approval |
| POST | `/ai-analysis/batches/:batchId/import-cleaned` | Upload cleaned JSON/CSV |
| GET | `/ai-analysis/batches/:batchId/export-for-cleaning` | Export for external cleaning |
| GET | `/ai-analysis/batches/:batchId/browse` | Aggregated tag/entity browser |
| POST | `/ai-analysis/pnids/:pnidId/auto-annotate` | Create draft Konva annotations from OCR |
| POST | `/ai-analysis/batches/:batchId/auto-annotate` | Batch auto-annotate all P&IDs |

Entity approval creates actual records in `system`, `line`, `equipment`, or `instrument` tables plus junction records.

---

## Phase 3: Frontend — AI Analysis Module

### 3.1 New hook: `frontend/src/hooks/useAiAnalysis.js`

React Query hooks (following `useOcrPipelineV2.js` patterns):
- `useAiAnalysisJob(jobId)` — Poll job status
- `useAiAnalysisEntities(jobId, filters)` — Fetch entities with filtering
- `useAiAnalysisRelationships(jobId)` — Fetch relationships
- `useAiAnalysisSummary(jobId)` — Fetch summary
- `useRunAiAnalysis()` — Mutation to trigger analysis
- `useApproveEntity()` / `useBulkApproveEntities()` / `useRejectEntity()` / `useEditEntity()`
- `useImportCleanedData()` / `useExportForCleaning()`

### 3.2 New component: `frontend/src/components/ai-analysis/AiAnalysisLayout.jsx`

Added as new tab in `OcrPipelineLayout.jsx` (alongside "Browse Storage" and "Processing History"). Shows when batch is completed.

Sub-tabs: Summary | Entity Browser | Relationships | Import/Export

### 3.3 New component: `frontend/src/components/ai-analysis/AiAnalysisSummary.jsx`

- AI-generated summary text in readable card
- Statistics: entities by type, confidence distribution
- "Run Analysis" / "Re-run Analysis" button
- Job status indicator

### 3.4 New component: `frontend/src/components/ai-analysis/EntityBrowser.jsx`

Four tabs: Lines | Equipment | Instruments | Systems

Each tab: table with tag, AI-suggested details, confidence (color-coded), source P&IDs, status badge, action buttons (Approve/Edit/Reject), bulk approve toolbar.

### 3.5 New component: `frontend/src/components/ai-analysis/RelationshipView.jsx`

- Table view: from → relationship type → to, with P&ID source
- Filter by relationship type, P&ID, entity type

### 3.6 New component: `frontend/src/components/ai-analysis/ImportExportPanel.jsx`

- Export buttons (JSON/CSV)
- Import: drag-and-drop upload area
- Reconciliation report after import
- Conflict resolution UI

### 3.7 New component: `frontend/src/components/ai-analysis/EntityEditDialog.jsx`

Modal for editing AI-suggested entity before approval. Fields vary by entity type (line: line_number, service, fluid_code, size, etc.).

---

## Phase 4: Auto-Annotation (Konva Draft Annotations)

### 4.1 Backend: Extend `backend/src/services/canvasGeneration/aiAssistance.js`

New function `createDraftAnnotationsFromOcr(prisma, pnidId)`:
- Queries `ocr_extraction` with status='pending' and bounding box data
- For matched extractions: creates `annotation` record with `approval_status='draft'`, linked entity, position from bbox
- For unmatched high-confidence (>= 0.8): creates annotation with `annotation_type='ocr_tag'` (no link)
- Metadata: `{ source: 'ocr_auto', extraction_id, confidence, match_confidence }`

### 4.2 Frontend: Modify `KonvaAnnotationStage.jsx`

- Visual distinction for draft annotations from OCR: dashed border, OCR source badge
- Draggable in draft mode — user can reposition
- Right-click context menu: Approve, Reject, Edit, Delete
- Approved draft → solid annotation

---

## Phase 5: Integration with Existing Code

### Modifications:

1. **`OcrPipelineLayout.jsx`** — Add "AI Analysis" tab. State: `activeTab` gets `'analysis'` value. Tab enabled when batch completed.

2. **`ProcessingHistory.jsx`** — Add "Analyze with AI" button in batch action row. Show AI analysis status badge. Add "Auto-Annotate" button.

3. **`ocrPipeline.js` (routes)** — Add `ai_analysis_status` to batch detail responses.

4. **`server.js`** — Register `aiAnalysis` routes:
   ```javascript
   import aiAnalysisRoutes from './routes/aiAnalysis.js';
   await fastify.register(aiAnalysisRoutes, { prefix: '/api/v1' });
   ```

---

## Implementation Order

| Step | Scope | Files | Dependencies |
|------|-------|-------|-------------|
| 1 | DB Schema | `migration_ocr_ai_analysis.sql` | None |
| 2 | Prompt Templates | `AiPromptTemplates.js` | None |
| 3 | AI Service | `AiAnalysisService.js` | Steps 1-2 |
| 4 | Backend Routes | `aiAnalysis.js` + `server.js` registration | Step 3 |
| 5 | Frontend Hooks | `useAiAnalysis.js` | Step 4 |
| 6 | Frontend Summary + Browser | `AiAnalysisLayout.jsx`, `AiAnalysisSummary.jsx`, `EntityBrowser.jsx` | Step 5 |
| 7 | Frontend Relationships + Actions | `RelationshipView.jsx`, `EntityEditDialog.jsx` | Step 6 |
| 8 | Import/Export | `CleanedDataImporter.js`, `ImportExportPanel.jsx` | Step 6 |
| 9 | Auto-Annotation | `aiAssistance.js` extension, Konva modifications | Step 4 |
| 10 | Integration | `OcrPipelineLayout.jsx`, `ProcessingHistory.jsx` modifications | Steps 6-9 |

---

## Testing

1. **Backend**: Test `AiAnalysisService` with mocked Claude responses. Test entity approval flow. Test import/export reconciliation.
2. **Integration**: Full pipeline: upload P&ID → OCR → AI Analysis → approve entities → verify DB state (use mock OCR provider).
3. **Frontend**: Use AD219 test data (2 platforms, 14 systems, 24 P&IDs). Test summary/entities/relationships rendering. Test approval workflow. Test export/import cycle.
4. **Edge cases**: Empty batch, only unmatched tags, duplicate suggestions across P&IDs, concurrent analysis prevention, large batches (token limit chunking), malformed import data.
