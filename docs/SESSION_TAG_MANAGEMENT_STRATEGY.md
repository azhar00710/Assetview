# Session: Tag Management Strategy & Architecture Redesign

## Mission

This session is a **strategic architecture study**, not just a coding task. The goal is to analyze how tag management should work in AssetView as a real-world oil & gas intelligent document management system, then redesign the data flow and system architecture to match industry best practices.

The agent must study the existing codebase, understand the current data flow, compare it against how AVEVA, Hexagon/SmartPlant, and real brownfield digitization projects handle tags, and produce a concrete implementation plan that restructures AssetView's tag management.

## The Core Problem

AssetView currently works **backwards** compared to real oil & gas workflows:

**Current flow (backwards):**
```
Upload P&ID PDFs → OCR Extract → AI Classify → Human Review → Create Entities → Link to P&IDs
```

**Real-world flow (what operators actually do):**
```
Master Tag Register exists (from CMMS, spreadsheets, previous engineering)
     ↕ bidirectional reconciliation
P&ID drawings exist (scanned legacy, or smart P&IDs)
     ↕
Tags are matched, linked, and gaps identified
```

In practice, **both directions coexist**:
- Tags are loaded into the central register from existing lists (CSV, SAP export, Maximo dump)
- P&IDs are scanned and tags extracted via OCR
- The two are reconciled — matched, linked, gaps flagged
- New tags found on P&IDs are added to the register
- Tags in the register not on any P&ID are flagged as orphans

## Industry Reference: How Major Systems Work

### AVEVA / Hexagon / SmartPlant Pattern
```
Central Tag Database (Master Tag Register)
         ↕  bidirectional sync
P&ID Authoring/Viewing Tool
         ↕  publish/consume
Other Disciplines (3D Model, Instrument DB, CMMS)
```

Key principles:
1. **The database is truth, P&IDs are views** — a tag on a drawing is a reference to a database record
2. **Tags have lifecycle status** — Active, Decommissioned, Spare, Planned, Under Construction
3. **Every tag has a "home document"** — the primary P&ID where it appears
4. **Tags can appear on multiple documents** — cross-references are tracked
5. **Reconciliation is a first-class workflow** — not an afterthought

### Brownfield Reality (AssetView's primary scenario)
In brownfield (existing facilities), operators have:
- **Existing tag lists** in spreadsheets, CMMS exports, or legacy databases
- **Existing P&IDs** as scanned PDFs or old CAD files (not smart/intelligent)
- **Inconsistencies everywhere** — register says one thing, P&ID says another, nameplate says a third
- The goal is to establish a single source of truth and link everything

## What Needs to Be Studied and Decided

### Question 1: One Database or Two?

**Option A: Single Central Register (recommended by industry)**
```
[Master Tag Register] ← single source of truth
    ├── equipment (with status, lifecycle, engineering data)
    ├── lines (with piping specs, connections)
    ├── instruments (with I/O, calibration, loops)
    └── systems (functional groupings)
    
[Junction Tables] ← links tags to P&IDs with positions
    ├── pnid_equipment (tag appears on this drawing at x,y)
    ├── pnid_line
    └── pnid_instrument
    
[OCR Extraction] ← middleware/staging only
    └── temporary data that feeds INTO the register
```

**Option B: Dual Databases with Dynamic Linking**
```
[Register Database] ← what we KNOW exists (from lists, CMMS, field surveys)
    ├── May not have P&ID positions
    └── May not know which P&ID a tag appears on

[Drawing Database] ← what we SEE on P&IDs (from OCR, manual annotation)
    ├── May not match register exactly
    └── Has positions but may have unmatched tags

[Reconciliation Layer] ← dynamic matching
    └── Links register tags to drawing tags with confidence scores
```

**The agent should analyze the current schema and recommend which approach fits, considering:**
- What does the current `ocr_extraction` table already do?
- Is `register_staging_item` already acting as a reconciliation layer?
- Should `ocr_extraction` become a permanent "drawing-side" database, not just temporary staging?
- How do junction tables fit — are they the link between the two worlds?

### Question 2: Tag Lifecycle & Status

Currently, entities (equipment, line, instrument) have no lifecycle status — only soft delete via `deleted_at`. Real systems need:

- **Active** — currently in service, should appear on current P&IDs
- **Decommissioned** — removed from service, kept for history
- **Spare** — exists physically but not in active process flow
- **Planned** — proposed for future modification (MOC)
- **Under Construction** — being installed

**The agent should recommend:**
- Add a `status` enum to equipment, line, instrument tables?
- How does status interact with P&ID linking? (decommissioned tags should be shown differently on P&IDs)
- How does OCR handle finding a tag on a P&ID that's marked decommissioned in the register?

### Question 3: Data Entry Flow — Push vs Pull

**Push from Register to P&ID (register-first):**
1. User loads equipment list via CSV import
2. System now has 110 equipment tags with no P&ID positions
3. User opens P&ID in annotation module
4. Tags appear in left panel as "unpositioned"
5. User places them on the drawing (manual or OCR-assisted)

**Pull from P&ID to Register (OCR-first — current approach):**
1. User uploads P&ID PDF
2. OCR extracts tags
3. Tags are compared against register
4. New tags created, existing tags linked

**The agent should analyze:**
- Can both flows coexist cleanly?
- What's the UX for switching between them?
- When a user loads a CSV of 500 equipment tags and then runs OCR on 24 P&IDs, what should happen?
- How do we handle the case where OCR finds `V-28193` but the register has `V-28-193` (format mismatch)?

### Question 4: System Code Extraction from Line Numbers

P&ID line numbers encode system information. Example:
```
6"-PG-1001-AR1-H
 │   │   │    │  └─ Insulation code
 │   │   │    └──── Pipe class
 │   │   └───────── Sequence number
 │   └───────────── Service/System code (PG = Production Gas)
 └────────────────── Nominal size
```

Currently, line numbers are stored as flat strings. The AI infers system codes but there's no deterministic parser.

**The agent should recommend:**
- Add a `parseLineNumber()` function that extracts components?
- Should parsing be configurable per project (different operators use different formats)?
- How to auto-create/match systems from extracted service codes?
- Store parsed components in separate columns or in metadata JSONB?

### Question 5: Orphan Detection & Reconciliation

**Orphan types:**
- **Register orphan**: Tag in register, not on any P&ID (missing junction entry)
- **Drawing orphan**: Tag on P&ID (from OCR), not in register (no matched entity)
- **Stale link**: Junction entry exists but entity was decommissioned
- **Position orphan**: Junction entry exists but no annotation coordinates

**The agent should design:**
- Reconciliation dashboard showing all orphan types with counts
- Automated detection queries (these are straightforward with current schema)
- Workflow for resolving each orphan type
- Periodic reconciliation reports

### Question 6: What Happens to `ocr_extraction`?

Currently `ocr_extraction` is treated as temporary middleware. But it contains valuable data:
- Original OCR text (before normalization)
- Bounding box coordinates (position on drawing)
- Confidence scores
- Match method and match confidence

**Should `ocr_extraction` become permanent?**
- It could serve as the "drawing-side" view — what was actually seen on the P&ID
- Useful for audit: "this tag was extracted from P&ID X at position Y with 95% confidence"
- Useful for re-reconciliation: if the register changes, we can re-match extractions

## Current Architecture to Study

### Database Tables (read from `/database/schema.sql` and migrations)
- `system`, `line`, `equipment`, `instrument` — entity register
- `pnid`, `pnid_system`, `pnid_equipment`, `pnid_instrument`, `pnid_line` — P&ID linking
- `annotation` — visual annotations on P&IDs
- `ocr_extraction` — OCR-detected tags with positions
- `register_staging_item`, `register_apply_run` — staging/apply pipeline
- `change_log` — audit trail
- `pnid_version` — P&ID revision tracking

### Backend Services (read from `/backend/src/services/`)
- `ocr/registerStagingService.js` — The reconciliation engine (buildRegisterStagingFromBatches, applyRegisterStaging)
- `ocr/reviewSyncToExtractions.js` — Syncs review JSON → ocr_extraction table
- `canvasGeneration/annotationPublishService.js` — Pushes annotations → junction tables
- `ocr/TagClassifier.js` — Regex-based tag classification
- `ocr/AiPromptTemplates.js` — AI classification prompts

### Frontend Components (read from `/frontend/src/`)
- `components/admin/` — EntityManager, SystemManager, LineManager, EquipmentManager, InstrumentManager
- `components/ocr-pipeline/` — BatchReviewPanel, RegisterStagingCard, OcrPipelineLayout
- `components/pnid/` — PnidViewer, AnnotationPanel, KonvaAnnotationStage

### Data Entry Points
- CSV Import: `backend/src/routes/admin/importExport.js`
- Manual Entry: `backend/src/routes/admin/entities.js`
- OCR Pipeline: `backend/src/services/ocr/`
- Register Staging: `backend/src/routes/ocrRegisterStaging.js`

## Expected Deliverables

The agent should produce:

### 1. Architecture Decision Document
For each of the 6 questions above, provide:
- Analysis of current state
- Recommended approach with rationale
- Impact on existing code
- Migration plan (if schema changes needed)

### 2. Revised Data Flow Diagram
Show the complete tag lifecycle:
```
Data Entry (CSV/API/Manual) → Master Register → P&ID Linking → Annotation
                                    ↑                              ↑
OCR Pipeline → Extraction → Staging → Reconciliation ──────────────┘
```

### 3. Schema Change Proposals
SQL migration files for:
- Tag lifecycle status on entities (if recommended)
- Any new tables or columns needed
- Index recommendations for search/reconciliation performance

### 4. Reconciliation Dashboard Design
- Wireframe or component spec for the reconciliation view
- Orphan detection queries
- Resolution workflows

### 5. Tag Search Infrastructure
- Backend endpoint design for cross-entity tag search
- pg_trgm fuzzy matching setup
- Search response format (unified across entity types)

### 6. Line Number Parser Specification
- Regex patterns for common oil & gas line number formats
- Configurable format definitions (per project/operator)
- System code extraction and auto-matching logic

## Key Constraints

- Must not break existing data or workflows
- OCR pipeline must continue to work as-is
- Admin import/export must remain functional
- All changes must be backward-compatible (new columns nullable, new tables additive)
- The central register (equipment/line/instrument/system tables) remains the source of truth
- Junction tables remain the link between tags and P&IDs
- Percentage-based coordinate system unchanged

## Files to Read First
```
database/schema.sql                              # Full schema
database/migration_*.sql                         # All migrations
backend/src/services/ocr/registerStagingService.js  # Current reconciliation logic
backend/src/services/ocr/TagClassifier.js        # Tag pattern matching
backend/src/routes/admin/entities.js             # CRUD for entities
backend/src/routes/admin/importExport.js         # CSV import/export
backend/src/routes/ocrRegisterStaging.js         # Staging routes
backend/src/services/canvasGeneration/annotationPublishService.js  # Annotation → junction
frontend/src/components/admin/EntityManager.jsx  # Admin list UI
frontend/src/components/ocr-pipeline/RegisterStagingCard.jsx  # Register changes UI
```

## Test Data Context
- Platform: AKK4 (Abu Dhabi offshore)
- Concession: AD219, Field: ADMA-OPCO
- 2 P&IDs: AD-28-D-100000-SHT-001, AD-28-D-100001-SHT-001
- ~110 equipment, ~18 lines, ~32 instruments from OCR
- Line number format: `SIZE"-SERVICE-SEQNUM` (e.g., `6"-PG-1001`)
- Existing register may have been populated from OCR (source: "ocr_staging" in metadata)
