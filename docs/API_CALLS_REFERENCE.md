# AssetView API Calls Reference

**Base URL (local dev):** `http://localhost:3001/api/v1`  
**Frontend proxy:** Vite dev server proxies `/api` → backend (`frontend/vite.config.js`)

All frontend hooks use either:
- `const BASE = '/api/v1'` (relative — goes through Vite proxy), or
- `const API = import.meta.env.VITE_API_URL || '/api/v1'`

Production Docker sets `VITE_API_URL=/api/v1` at build time.

---

## How the app talks to the API

```
Browser (React)
    │
    ├─ useApi.js          → Miller Columns, registers, search (main explorer)
    ├─ useAdminApi.js     → Admin panel CRUD, storage, transmittals
    ├─ useAnnotations.js  → P&ID annotation workspace
    ├─ useOcrPipelineV2.js → OCR pipeline (stages 1–4, review, staging)
    ├─ useAiAnnotate.js   → AI symbol detection on P&IDs
    ├─ useAiAnalysis.js   → AI relationship / entity analysis
    ├─ useTopology.js     → Canvas tracing (upstream/downstream)
    ├─ useCanvasGeneration.js → Auto-generate canvas from OCR
    └─ Direct fetch() in canvas/ocr components for tracing & isolation
```

There is **no authentication** on any endpoint today — all routes are open.

---

## 1. Health & System

| Method | Endpoint | Purpose | Frontend usage |
|--------|----------|---------|----------------|
| `GET` | `/health` | API liveness check (not under `/api/v1`) | Dev/ops only |
| `GET` | `/api/v1/admin/db-status` | Database connection status | Admin diagnostics |
| `POST` | `/api/v1/admin/db-migrate` | Run pending SQL migrations | Admin diagnostics |

---

## 2. Core Explorer (Miller Columns)

These power the main **Systems → P&IDs → Lines → Equipment → Instruments** cascade in `App.jsx` via `useApi.js`.

| Method | Endpoint | Query params | Purpose |
|--------|----------|--------------|---------|
| `GET` | `/platforms` | — | List all platforms (AKK4, etc.) |
| `GET` | `/platforms/:platformId` | — | Single platform detail with counts |
| `GET` | `/platforms/:platformId/systems` | `sys_type` (optional filter) | Systems on a platform — **Miller Column 1** |
| `GET` | `/pnids` | `system_id`, `platform_id`, `include_xref` | P&IDs for a system or platform — **Column 2** |
| `GET` | `/pnids/:pnidId` | — | P&ID detail (title, revision, image path, annotations summary) |
| `GET` | `/pnids/:pnidId/systems` | — | Systems linked to a P&ID (primary + cross-ref) |
| `GET` | `/lines` | `system_id`, `pnid_id`, `platform_id`, `include_xref` | Lines filtered by context — **Column 3** |
| `GET` | `/lines/:lineId` | — | Line detail with P&IDs, equipment, continuation flags |
| `GET` | `/equipment` | `system_id`, `pnid_id`, `line_id`, `platform_id` | Equipment list — **Column 4** |
| `GET` | `/equipment/:equipmentId` | — | Equipment detail (tag, type, criticality, corrosion loop) |
| `GET` | `/instruments` | `system_id`, `pnid_id`, `line_id`, `platform_id` | Instruments list — **Column 5** |
| `GET` | `/instruments/:instrumentId/detail` | — | Instrument detail (range, SCADA tag, line) |

**Cascade flow example:**
1. User picks platform → `GET /platforms`
2. Selects system "Chemical Injection" → `GET /platforms/{id}/systems` then `GET /pnids?system_id=...`
3. Selects a P&ID → `GET /lines?pnid_id=...` and `GET /equipment?pnid_id=...`
4. Selects a line → `GET /equipment?line_id=...` and `GET /instruments?line_id=...`

---

## 3. Registers & Search

| Method | Endpoint | Purpose | Frontend hook |
|--------|----------|---------|---------------|
| `GET` | `/registers/:type` | Paginated register (`pnids`, `lines`, `equipment`, `instruments`) | `useRegister()` |
| `GET` | `/search` | Full-text search across tags | `useSearch()` — needs `platform_id` + `q` (min 2 chars) |
| `GET` | `/tags/search` | Tag autocomplete | `useTagSearch()` |
| `GET` | `/tags/:tag/documents` | Documents linked to a tag | `useTagDocuments()` |

---

## 4. Asset Tree & Hierarchy

| Method | Endpoint | Purpose | Frontend usage |
|--------|----------|---------|----------------|
| `GET` | `/asset-tree/:platformId` | Flat asset tree for explorer panel | `AssetExplorer.jsx` |
| `GET` | `/asset-tree/:platformId/hierarchy` | Nested hierarchy tree | `useHierarchy()` in `useApi.js`, `HierarchyTree` |
| `GET` | `/asset-tree/:platformId/xref-map` | Cross-system reference map | `AssetExplorer.jsx` |

---

## 5. P&ID Files & Images

| Method | Endpoint | Purpose | Frontend usage |
|--------|----------|---------|----------------|
| `GET` | `/pnids/:id/image` | Serve P&ID raster image | P&ID viewer (via image URL) |
| `GET` | `/pnids/:id/file` | Serve original PDF/file | `usePnidFile()` in `useAnnotations.js` |
| `GET` | `/storage/files/:key` | Proxy file from storage provider | Storage-backed P&ID serving |
| `GET` | `/storage/files/*` | Wildcard storage proxy | Same |

---

## 6. Annotations (P&ID Overlay Workspace)

Used by `AnnotationWorkspace`, `PnidViewer`, Konva canvas — via `useAnnotations.js` and `useAnnotationSearch.js`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/annotations/search` | Search annotations across platform/P&ID |
| `GET` | `/pnids/:pnidId/annotation-summary` | Counts by type/status |
| `GET` | `/pnids/:pnidId/annotations` | All annotations on a drawing |
| `GET` | `/pnids/:pnidId/overlay` | Overlay layer data for viewer |
| `GET` | `/pnids/:pnidId/linkable-entities` | Equipment/instruments available to link |
| `POST` | `/pnids/:pnidId/annotations` | Create new annotation box |
| `PATCH` | `/annotations/:annotationId` | Update position, label, link |
| `PATCH` | `/annotations/bulk-update` | Batch update multiple annotations |
| `PATCH` | `/annotations/:annotationId/approve` | Approve a single annotation |
| `POST` | `/annotations/:annotationId/replies` | Thread reply on annotation |
| `POST` | `/pnids/:pnidId/place-entity` | Place detected entity on drawing |
| `POST` | `/pnids/:pnidId/bulk-link-placed` | Link all placed-but-unlinked entities |
| `POST` | `/pnids/:pnidId/bulk-approve` | Approve all pending on a P&ID |
| `DELETE` | `/annotations/:annotationId` | Delete annotation |
| `POST` | `/annotations/bulk-delete` | Batch delete |
| `POST` | `/annotations/bulk-revert` | Revert bulk changes |
| `GET` | `/annotations/orphaned-entities` | Entities with no annotation link |
| `POST` | `/annotations/cleanup-entities` | Remove orphaned entity records |

---

## 7. Topology & Canvas

Powers **System Canvas** (React Flow), tracing, isolation, and layout persistence.

| Method | Endpoint | Purpose | Frontend usage |
|--------|----------|---------|----------------|
| `GET` | `/topology/system/:systemId` | Full graph (nodes + edges) for canvas | `useTopologyData.js` |
| `GET` | `/topology/boundaries` | Cross-system boundary edges | Overview zoom mode |
| `GET` | `/topology/upstream/:entityId` | Trace upstream (recursive CTE) | `ContextMenu`, `NodeDetailPanel` |
| `GET` | `/topology/downstream/:entityId` | Trace downstream | `SystemCanvas`, `SelectionToolbar` |
| `POST` | `/topology/isolation` | Valve isolation analysis | `NodeDetailPanel`, `EquipmentContextMenu` |
| `GET` | `/topology/layout/:systemId` | Saved node positions | `layoutPersistence.js` |
| `PUT` | `/topology/layout/:systemId` | Persist canvas layout | `layoutPersistence.js` |
| `GET` | `/topology/generation-readiness/:systemId` | Check if auto-generation is possible | `useCanvasGeneration.js` |
| `POST` | `/topology/generate/:systemId` | Auto-build topology graph | `useCanvasGeneration.js` |
| `GET` | `/topology/ocr-suggestions/:pnidId` | OCR-based placement hints | `useCanvasGeneration.js` |
| `GET` | `/topology/ocr-auto-place/:pnidId` | Auto-place from OCR | Backend only |
| `GET` | `/systems/:systemId/topology` | Alternate topology endpoint | `useTopology.js` |
| `GET` | `/systems/:systemId/topology/upstream/:nodeId` | Upstream from node | `useTopology.js` |
| `GET` | `/systems/:systemId/topology/downstream/:nodeId` | Downstream from node | `useTopology.js` |

**Tracing example:** Right-click equipment on canvas → `GET /topology/downstream/{entityId}?maxDepth=50` → highlights affected nodes.

---

## 8. Admin — Hierarchy

Manage client → project → concession → location → complex → platform tree.  
Hook: `useAdminApi.js` → `useHierarchy()`, `useClientMutation()`, etc.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/admin/hierarchy` | Full nested hierarchy tree |
| `GET/POST/PUT/DELETE` | `/admin/clients` | Client CRUD |
| `GET/POST/PUT/DELETE` | `/admin/projects` | Project CRUD |
| `GET/POST/PUT/DELETE` | `/admin/concessions` | Concession CRUD |
| `GET/POST/PUT/DELETE` | `/admin/locations` | Location CRUD |
| `GET/POST/PUT/DELETE` | `/admin/complexes` | Complex CRUD |
| `GET/POST/PUT/DELETE` | `/admin/platforms` | Platform CRUD |
| `GET` | `/admin/next-code/:level` | Auto-generate next entity code |
| `GET` | `/admin/platforms/:id/stats` | Entity counts per platform |
| `GET` | `/admin/platform-templates` | Available platform templates |
| `POST` | `/admin/platforms/:id/apply-template` | Apply template systems |
| `POST` | `/admin/platforms/:id/clone` | Clone platform |
| `POST` | `/admin/import/hierarchy` | Bulk hierarchy import |

---

## 9. Admin — Entity CRUD

Systems, P&IDs, lines, equipment, instruments management.  
Hook: `useAdminApi.js`

| Resource | Endpoints |
|----------|-----------|
| Systems | `GET/POST /admin/systems`, `PUT/DELETE /admin/systems/:id` |
| P&IDs | `GET/POST /admin/pnids`, `PUT/DELETE /admin/pnids/:id` |
| P&ID ↔ System | `POST /admin/pnids/:id/systems`, `DELETE /admin/pnids/:pnidId/systems/:systemId` |
| Lines | `GET/POST /admin/lines`, `PUT/DELETE /admin/lines/:id` |
| Equipment | `GET/POST /admin/equipment`, `PUT/DELETE /admin/equipment/:id` |
| Instruments | `GET/POST /admin/instruments`, `PUT/DELETE /admin/instruments/:id` |

---

## 10. Admin — Import / Export

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/admin/export/systems` | Export systems CSV |
| `GET` | `/admin/export/lines` | Export lines CSV |
| `GET` | `/admin/export/equipment` | Export equipment CSV |
| `GET` | `/admin/export/instruments` | Export instruments CSV |
| `POST` | `/admin/import/systems` | Import systems CSV |
| `POST` | `/admin/import/lines` | Import lines CSV (legacy) |
| `POST` | `/admin/import/equipment` | Import equipment CSV (legacy) |
| `POST` | `/admin/import/instruments` | Import instruments CSV (legacy) |
| `POST` | `/admin/import/lines/preview` | Preview line import without applying |
| `POST` | `/admin/import/lines/apply` | Apply previewed line import |
| `POST` | `/admin/import/equipment/preview` | Preview equipment import |
| `POST` | `/admin/import/equipment/apply` | Apply equipment import |
| `GET` | `/admin/impact/:entityType/:id` | Impact analysis before delete |

---

## 11. Admin — Storage & File Manager

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/admin/storage/config` | List storage provider configs |
| `POST` | `/admin/storage/config` | Create/update storage config |
| `DELETE` | `/admin/storage/config/:id` | Remove config |
| `POST` | `/admin/storage/test-connection` | Test S3/Azure/GCS/local connection |
| `GET` | `/admin/storage/usage` | Storage usage stats |
| `POST` | `/admin/storage/sync/scan` | Scan storage for unlinked files |
| `POST` | `/admin/storage/sync/import` | Import scanned files as P&IDs |
| `POST` | `/admin/storage/sync/link` | Link storage file to P&ID record |
| `GET` | `/admin/storage/:configId/browse` | Browse bucket/folder |
| `POST` | `/admin/storage/:configId/upload` | Upload via backend proxy |
| `POST` | `/admin/storage/:configId/presigned-upload` | Get presigned URL for direct upload |
| `GET` | `/admin/storage/:configId/download` | Download file |
| `GET` | `/admin/storage/:configId/url` | Get signed view URL |
| `POST` | `/admin/storage/:configId/folder` | Create folder |
| `DELETE` | `/admin/storage/:configId/file` | Delete file |
| `DELETE` | `/admin/storage/:configId/folder` | Delete folder |
| `POST` | `/admin/storage/:configId/copy` | Copy file |
| `POST` | `/admin/storage/:configId/move` | Move file |

---

## 12. Admin — P&ID Upload & Versioning

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/admin/pnids/:id/upload` | Upload new P&ID revision (PDF/image) |
| `GET` | `/admin/pnids/:id/versions` | List all versions |
| `GET` | `/admin/pnids/:id/versions/:versionId/snapshot` | Version snapshot metadata |
| `POST` | `/admin/pnids/:id/versions/:versionId/activate` | Set active version |
| `GET` | `/admin/pnids/:id/versions/compare` | Compare two versions |
| `GET` | `/admin/pnids/:id/versions/:versionId/image` | Version-specific image |
| `PUT` | `/admin/pnids/:id/annotations/verify` | Mark annotations as verified |
| `GET` | `/admin/pnids/:id/annotations/unverified` | List unverified annotations |

---

## 13. Admin — Transmittals

Document control workflow for engineering transmittals.  
Hooks: `useTransmittals()`, `useTransmittalUpload()`, `TransmittalManager.jsx`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/admin/transmittals` | List transmittals for platform |
| `POST` | `/admin/transmittals` | Create transmittal |
| `GET` | `/admin/transmittals/:id` | Transmittal detail with documents |
| `PUT` | `/admin/transmittals/:id` | Update transmittal |
| `DELETE` | `/admin/transmittals/:id` | Delete transmittal |
| `POST` | `/admin/transmittals/:id/upload-pnid` | Upload P&ID to transmittal |
| `POST` | `/admin/transmittals/:id/upload-list` | Upload equipment/line list |
| `PUT` | `/admin/transmittals/:id/documents/:docId/approve` | Approve document |
| `PUT` | `/admin/transmittals/:id/documents/:docId/reject` | Reject document |
| `POST` | `/admin/transmittals/:id/approve-all` | Approve all pending docs |
| `POST` | `/admin/transmittals/:id/close` | Close transmittal |
| `GET` | `/admin/pnids/:pnidId/revision-history` | P&ID revision audit trail |
| `GET` | `/admin/lists/:platformId/revision-history` | List revision history |

---

## 14. Admin — Linkage, Audit, AI/Vision Config

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/admin/linkage` | Annotation ↔ entity linkage dashboard |
| `GET` | `/admin/audit-log` | Paginated audit log |
| `GET` | `/admin/audit-log/export` | Export audit log CSV |
| `GET` | `/admin/ai-config` | Claude API key config (masked) |
| `PUT` | `/admin/ai-config` | Save AI config |
| `POST` | `/admin/ai-test` | Test Claude connection |
| `GET` | `/admin/vision-config` | Google Vision credentials |
| `PUT` | `/admin/vision-config` | Save Vision config |
| `POST` | `/admin/vision-test` | Test Vision API |

---

## 15. OCR Pipeline (v2 — primary)

Multi-stage P&ID OCR: **Stage 1** (OCR extract) → **Stage 2** (AI classify/group) → **Review** → **Register staging** → **Annotation handoff**.  
Hook: `useOcrPipelineV2.js` (main), components in `ocr-pipeline/`

### Platform & batch management

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/ocr-pipeline/platforms` | Platforms with OCR status |
| `GET` | `/ocr-pipeline/platforms/:platformId/batches` | List OCR batches |
| `POST` | `/ocr-pipeline/platforms/:platformId/batches` | Create new batch from files |
| `POST` | `/ocr-pipeline/platforms/:platformId/batches/from-existing` | Batch from existing P&IDs |
| `GET` | `/ocr-pipeline/batches/:batchId` | Batch detail + file statuses |
| `DELETE` | `/ocr-pipeline/batches/:batchId` | Delete batch |
| `POST` | `/ocr-pipeline/batches/:batchId/cancel` | Cancel running batch |
| `POST` | `/ocr-pipeline/batches/:batchId/add-files` | Add files to batch |
| `POST` | `/ocr-pipeline/batches/:batchId/rerun-ocr` | Re-run Stage 1 OCR |
| `POST` | `/ocr-pipeline/platforms/:platformId/clear-failed` | Clear failed file statuses |
| `POST` | `/ocr-pipeline/platforms/:platformId/reset-ocr-status` | Reset platform OCR state |

### Storage & file detection

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/ocr-pipeline/platforms/:platformId/storage/browse` | Browse P&ID storage |
| `GET` | `/ocr-pipeline/platforms/:platformId/detect-ocr-files` | Find unprocessed PDFs |
| `POST` | `/ocr-pipeline/platforms/:platformId/import-ocr-files` | Import detected files |
| `GET` | `/ocr-pipeline/platforms/:platformId/storage-configs` | Storage configs for platform |

### Stage 1 & 2 processing

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/ocr-pipeline/batches/:batchId/stages` | Stage status summary |
| `GET` | `/ocr-pipeline/batches/:batchId/files/:fileId/stage/:stage` | Stage output data |
| `GET` | `/ocr-pipeline/batches/:batchId/files/:fileId/stage/:stage/download` | Download stage JSON |
| `POST` | `/ocr-pipeline/batches/:batchId/run-stage2` | Run AI classification (full) |
| `POST` | `/ocr-pipeline/batches/:batchId/run-stage2-grouping-only` | Grouping pass only |
| `POST` | `/ocr-pipeline/run-stage2-multi` | Stage 2 on multiple batches |
| `GET` | `/ocr-pipeline/batches/:batchId/stage2-progress` | Poll Stage 2 progress |
| `POST` | `/ocr-pipeline/batches/:batchId/reset-stage2` | Reset Stage 2 results |
| `POST` | `/ocr-pipeline/batches/:batchId/retry-cleanup` | Retry AI cleanup pass |

### Review workspace

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/ocr-pipeline/batches/:batchId/files/:fileId/candidate-ledger` | Tag candidate ledger |
| `GET` | `/ocr-pipeline/batches/:batchId/files/:fileId/grouping-diagnostic` | Word grouping debug view |
| `POST` | `/ocr-pipeline/batches/:batchId/files/:fileId/grouping-diagnostic/repass` | Re-run grouping diagnostic |
| `GET/PUT/DELETE` | `/ocr-pipeline/batches/:batchId/files/:fileId/labels/:atomIdx` | Manual label edits |
| `DELETE` | `/ocr-pipeline/batches/:batchId/files/:fileId/labels` | Clear all labels |
| `POST` | `/ocr-pipeline/batches/:batchId/files/:fileId/save-review` | Save review decisions |
| `GET` | `/ocr-pipeline/batches/:batchId/review-summary` | Review progress summary |
| `POST` | `/ocr-pipeline/batches/:batchId/sync-review-to-extractions` | Sync review → DB |
| `GET` | `/ocr-pipeline/batches/:batchId/reconciliation` | Reconciliation report |
| `GET` | `/ocr-pipeline/batches/:batchId/files/:fileId/coordinate-trace` | Coordinate pipeline trace |

### Register preview & export

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/ocr-pipeline/batches/:batchId/line-register/preview` | Preview line register |
| `GET` | `/ocr-pipeline/batches/:batchId/equipment-register/preview` | Preview equipment register |
| `GET` | `/ocr-pipeline/batches/:batchId/instrument-register/preview` | Preview instrument register |
| `GET` | `/ocr-pipeline/batches/:batchId/register-preview/:entityType/export-csv` | Export register CSV |
| `POST` | `/ocr-pipeline/batches/:batchId/export` | Export batch results |
| `POST` | `/ocr-pipeline/batches/:batchId/pass-to-annotation` | Hand off to annotation module |

### Register staging (write to DB)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/ocr-pipeline/platforms/:platformId/register-staging/from-batches` | Stage register items from batches |
| `GET` | `/ocr-pipeline/platforms/:platformId/register-staging/items` | List staged items |
| `POST` | `/ocr-pipeline/platforms/:platformId/register-staging/apply` | Commit staged items to registers |
| `POST` | `/ocr-pipeline/platforms/:platformId/register-staging/cancel` | Cancel staging |
| `GET` | `/ocr-pipeline/platforms/:platformId/register-staging/traceability/:itemId` | Trace item to source OCR |
| `POST` | `/ocr-pipeline/platforms/:platformId/register-staging/repair-links` | Repair broken staging links |

### OCR pipeline configuration (per platform)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET/PUT` | `/ocr-pipeline/platforms/:platformId/vision-config` | Google Vision settings |
| `POST` | `/ocr-pipeline/platforms/:platformId/vision-test` | Test Vision |
| `GET/PUT` | `/ocr-pipeline/platforms/:platformId/ai-config` | Claude AI settings |
| `POST` | `/ocr-pipeline/platforms/:platformId/ai-test` | Test Claude |
| `GET` | `/ocr-pipeline/platforms/:platformId/prompt-preview` | Preview AI prompt |
| `GET` | `/ocr-pipeline/platforms/:platformId/learning-history` | OCR feedback learning log |
| `GET/PUT` | `/ocr-pipeline/platforms/:platformId/visual-config` | T-Rex2 visual detection config |
| `POST` | `/ocr-pipeline/platforms/:platformId/visual-test` | Test visual detection |
| `GET/PUT` | `/ocr-pipeline/platforms/:platformId/grounding-config` | GroundingDINO config |
| `GET/PUT` | `/ocr-pipeline/platforms/:platformId/ocr-provider` | Paddle vs Florence OCR provider |

---

## 16. OCR (v1 — legacy)

Simpler single-P&ID OCR flow. Hook: `useOcr.js`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/ocr/extract/:pnidId` | Start OCR on one P&ID |
| `GET` | `/ocr/jobs/:jobId` | Job status |
| `GET` | `/ocr/jobs/pnid/:pnidId` | Jobs for a P&ID |
| `GET` | `/ocr/results/:pnidId` | Extraction results |
| `POST` | `/ocr/results/:pnidId/approve` | Approve selected extractions |
| `POST` | `/ocr/results/:pnidId/approve-all` | Approve all |
| `PATCH` | `/ocr/extractions/:extractionId` | Edit single extraction |
| `GET` | `/ocr/dashboard` | OCR dashboard stats |
| `POST` | `/ocr/batch-extract` | Batch OCR multiple P&IDs |
| `GET` | `/ocr/notifications` | OCR job notifications |

---

## 17. AI Annotate (Symbol Detection)

Detects equipment/instrument symbols on P&IDs using T-Rex2 / GroundingDINO.  
Hook: `useAiAnnotate.js`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/ai/models` | List available AI detection models |
| `POST` | `/ai/annotate` | Run detection on one P&ID |
| `POST` | `/ai/annotate/accept` | Accept detection results |
| `POST` | `/ai/annotate/batch` | Start batch detection |
| `GET` | `/ai/annotate/batch/:batchId/progress` | Poll batch progress |
| `GET` | `/ai/annotate/batch/:batchId/results/:pnidId` | Results for one P&ID in batch |
| `POST` | `/ai/annotate/batch/:batchId/accept` | Accept batch results for P&ID |
| `POST` | `/ai/annotate/batch/:batchId/accept-all` | Accept all in batch |
| `POST` | `/ai/annotate/repair-text` | Repair OCR text on detections |
| `POST` | `/ai/annotate/cleanup` | Clean up false positives |
| `GET` | `/ai/annotate/profiles` | Detection profiles |
| `GET` | `/ai/annotate/profiles/:name` | Single profile |
| `POST` | `/ai/annotate/profiles` | Save detection profile |
| `POST` | `/ai/debug/pipeline` | Debug detection pipeline |

---

## 18. AI Analysis (Relationship Explorer)

Analyzes OCR output to build entity relationships. Hook: `useAiAnalysis.js`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/ai-analysis/batches/:batchId/analyze` | Start analysis job |
| `GET` | `/ai-analysis/jobs/:jobId` | Job status |
| `GET` | `/ai-analysis/jobs/:jobId/entities` | Extracted entities |
| `GET` | `/ai-analysis/jobs/:jobId/relationships` | Entity relationships |
| `GET` | `/ai-analysis/jobs/:jobId/summary` | Analysis summary |
| `POST` | `/ai-analysis/entities/:entityId/approve` | Approve entity |
| `POST` | `/ai-analysis/entities/bulk-approve` | Bulk approve |
| `POST` | `/ai-analysis/entities/:entityId/reject` | Reject entity |
| `POST` | `/ai-analysis/entities/:entityId/edit` | Edit entity fields |
| `POST` | `/ai-analysis/batches/:batchId/import-cleaned` | Import cleaned data |
| `GET` | `/ai-analysis/batches/:batchId/export-for-cleaning` | Export for external cleaning |
| `GET` | `/ai-analysis/batches/:batchId/browse` | Browse batch entities |
| `GET` | `/ai-analysis/batches/:batchId/data-check` | Data readiness check |
| `POST` | `/ai-analysis/batches/:batchId/reprocess` | Reprocess batch |
| `POST` | `/ai-analysis/pnids/:pnidId/auto-annotate` | Auto-annotate from analysis |
| `POST` | `/ai-analysis/batches/:batchId/auto-annotate` | Batch auto-annotate |

---

## 19. Tag Dictionary

Platform-scoped tag naming patterns (e.g. `PT-28XXXX`, `V-28XXX`).  
Hook: `useTagDictionary.js`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/tag-dictionary/:platformId` | List dictionary entries |
| `POST` | `/tag-dictionary/:platformId` | Add entry |
| `PUT` | `/tag-dictionary/entries/:entryId` | Update entry |
| `DELETE` | `/tag-dictionary/entries/:entryId` | Delete entry |
| `POST` | `/tag-dictionary/:platformId/import-csv` | Import from CSV |
| `POST` | `/tag-dictionary/:platformId/import-json` | Import from JSON |
| `POST` | `/tag-dictionary/:platformId/ai-detect` | AI-detect patterns from data |
| `POST` | `/tag-dictionary/:platformId/ai-detect/apply` | Apply AI suggestions |
| `GET` | `/tag-dictionary/:platformId/analyses` | Past AI analyses |
| `GET` | `/tag-dictionary/analyses/:analysisId` | Single analysis detail |
| `POST` | `/tag-dictionary/:platformId/detect-from-data` | Detect from register data |
| `GET` | `/tag-dictionary/templates` | Global templates |
| `POST` | `/tag-dictionary/:platformId/apply-template` | Apply template |
| `GET` | `/tag-dictionary/:platformId/stats` | Dictionary stats |
| `GET` | `/tag-dictionary/:platformId/csv-template` | Download CSV template |

---

## 20. P&ID Module

Legacy annotation generation workflow. Hook: `usePidModule.js`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/pid-module/pnids` | P&IDs with annotation status |
| `GET` | `/pid-module/stats` | Module statistics |
| `PATCH` | `/pid-module/pnids/:pnidId/annotation-status` | Update status |
| `POST` | `/pid-module/pnids/:pnidId/ocr` | Run OCR for module |
| `GET` | `/pid-module/pnids/:pnidId/ocr-data` | OCR data for P&ID |
| `GET` | `/pid-module/pnids/:pnidId/detail` | P&ID detail for module |
| `POST` | `/pid-module/pnids/:pnidId/generate-annotations` | Generate annotations |
| `POST` | `/pid-module/bulk-generate-annotations` | Bulk generate |

---

## 21. 3D Models

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/models/:platformId` | 3D model metadata for platform |
| `GET` | `/models/:platformId/tag-map` | Tag → 3D position mapping |

---

## 22. Central Hub (Enterprise Integration)

Change management, writeback, and satellite sync. **No frontend UI yet** — used by smoke tests and external integrations.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/central-hub/health` | Central hub health |
| `GET/POST` | `/tenants` | Tenant management |
| `GET/PATCH` | `/tenants/:tenantId/modules` | Module config |
| `POST` | `/tenants/:tenantId/module-clients` | Register module client |
| `GET/POST` | `/change-packages` | Change package CRUD |
| `POST` | `/change-packages/:packageId/submit` | Submit for review |
| `POST` | `/change-packages/:packageId/validate` | Validate package |
| `POST` | `/change-packages/:packageId/map` | Map to master data |
| `POST` | `/change-packages/:packageId/approvals` | Record approval |
| `POST` | `/change-packages/:packageId/inject` | Inject changes |
| `POST` | `/change-packages/:packageId/publish` | Publish to satellites |
| `GET` | `/master/tags` | Master tag registry |
| `GET` | `/master/relationships` | Master relationships |
| `GET/POST` | `/integrations/enterprise/writeback` | Enterprise writeback commands |
| `GET` | `/integrations/enterprise/writeback/:commandId` | Writeback status |
| `POST` | `/integrations/enterprise/writeback/:commandId/ack` | Acknowledge writeback |
| `POST` | `/sync/satellites/:satelliteId/pull-token` | Satellite pull token |
| `GET/POST` | `/sync/satellites/:satelliteId/checkpoints` | Sync checkpoints |
| `POST` | `/events/subscriptions` | Event subscriptions |
| `PATCH` | `/events/subscriptions/:subscriptionId` | Update subscription |

---

## 23. Chat (Stub)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/chat` | **Not implemented** — returns placeholder (TODO in `chat.js`) |

---

## Frontend hook → API map (quick reference)

| Hook / file | APIs used |
|-------------|-----------|
| `useApi.js` | platforms, systems, pnids, lines, equipment, instruments, registers, search, asset-tree, tags |
| `useAdminApi.js` | All `/admin/*` endpoints |
| `useAnnotations.js` | `/pnids/*/annotations`, `/annotations/*`, place-entity, bulk ops |
| `useAnnotationSearch.js` | `/annotations/search`, `/pnids/*/annotation-summary` |
| `useTopology.js` | `/systems/*/topology/*` |
| `useTopologyData.js` | `/topology/system/*`, `/topology/boundaries`, `/platforms/*/systems` |
| `layoutPersistence.js` | `/topology/layout/*` |
| `useCanvasGeneration.js` | `/topology/generate/*`, `/topology/ocr-suggestions/*` |
| `useOcrPipelineV2.js` | All `/ocr-pipeline/*` |
| `useOcr.js` | All `/ocr/*` (legacy) |
| `useAiAnnotate.js` | All `/ai/*` |
| `useAiAnalysis.js` | All `/ai-analysis/*` |
| `useTagDictionary.js` | All `/tag-dictionary/*` |
| `usePidModule.js` | All `/pid-module/*` |
| `useEntityDetail.js` | `/equipment/:id`, `/instruments/:id/detail` |
| `SystemCanvas.jsx` | `/topology/downstream/*` |
| `NodeDetailPanel.jsx` | `/topology/upstream|downstream/*`, `/topology/isolation`, `/lines/:id` |
| `AssetExplorer.jsx` | `/asset-tree/*` |

---

## Typical user journey — API sequence

### Browse a platform
```
GET /platforms
GET /platforms/{platformId}/systems
GET /pnids?system_id={systemId}&include_xref=true
GET /lines?pnid_id={pnidId}
GET /equipment?line_id={lineId}
```

### View a P&ID drawing
```
GET /pnids/{pnidId}
GET /pnids/{pnidId}/annotations
GET /pnids/{pnidId}/file          ← PDF stream
```

### Open system canvas
```
GET /topology/system/{systemId}   ← nodes + edges
GET /topology/layout/{systemId}   ← saved positions
PUT /topology/layout/{systemId}   ← on drag-end save
```

### Run OCR pipeline
```
POST /ocr-pipeline/platforms/{id}/batches
  → (Stage 1 runs automatically)
POST /ocr-pipeline/batches/{batchId}/run-stage2
GET  /ocr-pipeline/batches/{batchId}/stage2-progress  (poll)
POST /ocr-pipeline/batches/{batchId}/files/{fileId}/save-review
POST /ocr-pipeline/platforms/{id}/register-staging/from-batches
POST /ocr-pipeline/platforms/{id}/register-staging/apply
POST /ocr-pipeline/batches/{batchId}/pass-to-annotation
```

---

*Generated for AssetView v2.0.0 — branch `Shakir-initial`*
