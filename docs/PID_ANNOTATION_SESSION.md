# P&ID Annotation Module — Session Instructions

> **Prerequisite**: OCR pipeline complete — lines, equipment, instruments are in the database and linked to P&IDs via junction tables (`pnid_line`, `pnid_equipment`, `pnid_instrument`).
> **Branch from**: `master` (or `origin/main`) — all OCR pipeline work merged.
> **Create new branch**: `claude/<session-name>`

---

## OBJECTIVE

Build the P&ID Annotation Module: take entity data already in the database (from OCR pipeline) and render/manage annotations on P&ID drawings. Single P&ID and bulk P&ID annotation runs. Complete P&ID detail view with all related data.

---

## WHAT THE DATABASE ALREADY HAS

After the OCR pipeline, these junction tables are populated:

| Junction Table | Key Fields | What It Means |
|----------------|-----------|---------------|
| `pnid_line` | `pnid_id`, `line_id`, `annotation_x_pct`, `annotation_y_pct`, `is_continuation` | Lines appearing on P&IDs |
| `pnid_equipment` | `pnid_id`, `equipment_id`, `annotation_x/y/w/h_pct`, `position_verified` | Equipment placed on P&IDs |
| `pnid_instrument` | `pnid_id`, `instrument_id`, `annotation_x/y/w/h_pct`, `position_verified` | Instruments placed on P&IDs |
| `pnid_system` | `pnid_id`, `system_id`, `is_primary` | System ownership of P&IDs |
| `ocr_extraction` | `pnid_id`, `extracted_text`, `tag_type`, `bbox_x/y/w/h_pct`, `matched_entity_id` | Raw OCR bounding boxes |

**Important**: `ocr_extraction.bbox_x/y/w/h_pct` contains the OCR-detected bounding box positions. These should be the **source of truth** for initial annotation placement when `pnid_equipment/instrument.annotation_x/y/w/h_pct` are not yet populated.

---

## RELATIONSHIP MAP

```
Platform
  └── System (platform_id)
        ├── Line (system_id = ownership)
        │     └── pnid_line → appears on P&ID (display)
        ├── Equipment (system_id)
        │     └── pnid_equipment → placed on P&ID
        └── Instrument (system_id)
              └── pnid_instrument → placed on P&ID

P&ID
  ├── pnid_system → linked systems (is_primary marks owner)
  ├── pnid_line → lines shown on this drawing
  ├── pnid_equipment → equipment symbols on this drawing
  ├── pnid_instrument → instrument tags on this drawing
  ├── annotation → Konva annotations (shapes, pins, connections)
  ├── ocr_extraction → raw OCR results with bounding boxes
  ├── pnid_version → revision history
  └── Files: storage_key (PDF/image), ocr_raw_storage_key, ocr_cleaned_storage_key
```

**Key distinction**:
- `line.system_id` = which system **owns** the line
- `pnid_line` = which P&IDs **display** the line (can cross system boundaries via xrefs)
- `pnid_system.is_primary = true` = this system **owns** the P&ID
- `pnid_system.is_primary = false` = cross-reference (xref) appearance

---

## GIT SETUP

```bash
git fetch origin main
git checkout main
git pull origin main
git checkout -b claude/<new-session-branch>
```

---

## CONTEXT FILES TO READ FIRST

### Frontend (Existing P&ID Viewer)
```
frontend/src/components/pnid/PnidViewer.jsx          # Main viewer — 665 lines, zoom/pan/edit modes
frontend/src/components/pnid/konva/KonvaShapeRenderer.jsx  # Konva.js shape rendering engine
frontend/src/components/pnid/AnnotationPanel.jsx      # Right sidebar: placed vs available entities
frontend/src/components/pnid/OverlayLayer.jsx         # Entity position overlay on P&ID
frontend/src/components/pnid/LinkDialog.jsx           # Entity linking when drawing annotations
frontend/src/components/pnid/OcrReviewPanel.jsx       # OCR review (reference for data flow)
```

### Backend (Existing API)
```
backend/src/routes/annotations.js     # Annotation CRUD + overlay + place-entity
backend/src/routes/pnids.js           # P&ID list/detail + file serving
backend/src/routes/pidModule.js       # P&ID module management + annotation status
backend/src/routes/ocrPipeline.js     # OCR pipeline (data source reference)
```

### Database
```
backend/prisma/schema.prisma          # All models — focus on pnid, annotation, junction tables
database/schema.sql                   # SQL schema reference
```

### Design System
```
frontend/src/data/constants.js        # M3 color tokens: SC, STC, COL, CC, M3, EC
frontend/src/lib/theme.js             # Dark theme + M3 surface hierarchy
frontend/src/index.css                # CSS custom properties --md-*
```

---

## WHAT TO BUILD

### TASK A: P&ID Detail View (Enhanced)

Each P&ID card in the P&ID Module should show a **complete detail view** with:

1. **Header**: Drawing number, title, revision, status badge (M3 `STC` colors)
2. **File references panel**:
   - Raw P&ID file (via `storage_key`) — View/Download
   - Raw OCR data file (via `ocr_raw_storage_key`) — View JSON
   - Cleaned OCR data (via `ocr_cleaned_storage_key`) — View JSON
   - Current annotation status badge (`annotation_status_col`)
3. **Entity lists** (from junction tables):
   - **Lines** (from `pnid_line`): line number, service, size, continuation info
   - **Equipment** (from `pnid_equipment`): tag, type, criticality, position status
   - **Instruments** (from `pnid_instrument`): tag, type, range, SCADA tag, position status
4. **System associations** (from `pnid_system`): primary system highlighted, xrefs listed
5. **Annotation summary**: Total annotations, approved count, draft count

**API**: Extend `GET /pnids/:pnidId` or create `GET /pid-module/pnids/:pnidId/detail` to return all entity lists + file references.

### TASK B: Annotation Generation Engine

**Purpose**: Take OCR bounding box data and entity links, generate positioned annotations on the P&ID.

**Flow for single P&ID**:
1. Query `ocr_extraction` for this P&ID where `matched_entity_id IS NOT NULL`
2. For each matched extraction:
   - Look up entity type (equipment/instrument/line) from `tag_type`
   - Use `bbox_x/y/w/h_pct` as annotation position
   - Create/update junction table entry (`pnid_equipment/instrument/line`) with coordinates
   - Optionally create `annotation` record (Konva shape) for visual rendering
3. Update `pnid.annotation_status_col` to `'in_progress'` → `'annotated'`

**Backend endpoint**: `POST /pid-module/pnids/:pnidId/generate-annotations`
```json
{
  "mode": "from_ocr",           // Use OCR bounding boxes as position source
  "entityTypes": ["equipment", "instrument", "line"],  // Which types to annotate
  "overwriteExisting": false,   // Skip entities that already have coordinates
  "createKonvaAnnotations": true // Also create annotation records for Konva rendering
}
```

**Response**:
```json
{
  "annotated": 45,
  "skipped": 12,
  "errors": 0,
  "byType": { "equipment": 20, "instrument": 15, "line": 10 }
}
```

### TASK C: Bulk Annotation Run

**Purpose**: Run annotation generation across multiple P&IDs at once.

**UI**: In the P&ID Module table view:
1. Add checkboxes for P&ID selection (select all, select by system, select by status)
2. "Generate Annotations" button — runs Task B for each selected P&ID
3. Progress indicator (X of Y complete)
4. Results summary table after completion

**Backend endpoint**: `POST /pid-module/bulk-generate-annotations`
```json
{
  "pnidIds": ["uuid1", "uuid2", ...],
  "mode": "from_ocr",
  "entityTypes": ["equipment", "instrument", "line"],
  "overwriteExisting": false
}
```

### TASK D: Annotation Viewer Integration

**Purpose**: When viewing a P&ID, show all generated annotations as visual overlays.

The existing `OverlayLayer.jsx` and `KonvaShapeRenderer.jsx` already support rendering:
- Equipment hotspots (rectangular, color-coded by type)
- Instrument tags (pin or bubble shapes)
- Line labels (positioned text)

**What needs wiring**:
1. Ensure `GET /pnids/:pnidId/overlay` returns the annotation coordinates from junction tables
2. The overlay should use entity colors: Equipment=#4FE2B0 (M3.primary), Instrument=#8AB4FF (M3.secondary), Line=#FFB068 (M3.tertiary)
3. Clicking an overlay annotation should show entity details (tag, type, line association)
4. Annotation status indicators: verified (green border), unverified (dashed border)

---

## EXISTING API ENDPOINTS (Reference)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/pnids/:pnidId` | P&ID detail with systems/equipment/instruments |
| GET | `/pnids/:pnidId/annotations` | All Konva annotations |
| GET | `/pnids/:pnidId/overlay` | Equipment/instrument/line overlay positions |
| GET | `/pnids/:pnidId/linkable-entities` | Entities available for linking |
| POST | `/pnids/:pnidId/annotations` | Create Konva annotation |
| POST | `/pnids/:pnidId/place-entity` | Atomic entity + junction + annotation |
| PATCH | `/annotations/:annotationId` | Update annotation |
| PATCH | `/annotations/:annotationId/approve` | Approve annotation |
| PATCH | `/pid-module/pnids/:pnidId/annotation-status` | Update annotation workflow status |

---

## COORDINATE SYSTEM

All positions are **percentage-based** (0-100%) relative to the P&ID image dimensions:
- `x_pct` = horizontal position as % of image width
- `y_pct` = vertical position as % of image height
- `w_pct` = width as % of image width (for equipment/instrument bounding boxes)
- `h_pct` = height as % of image height

**Conversion** (in `KonvaShapeRenderer.jsx`):
```javascript
function pct(val, size) { return ((val || 0) / 100) * size; }
// Example: pct(25.5, 1920) = 489.6px from left
```

**Data flow**: OCR bbox → `ocr_extraction.bbox_x/y/w/h_pct` → propagate to `pnid_equipment.annotation_x/y/w/h_pct` → render in `OverlayLayer`/`KonvaShapeRenderer`

---

## ANNOTATION STATUS WORKFLOW

```
not_annotated → in_progress → annotated → verified
```

- `not_annotated`: No annotations exist (fresh P&ID)
- `in_progress`: Annotation generation started, some entities positioned
- `annotated`: All matched entities have coordinates, awaiting review
- `verified`: Human verified all annotations are correctly positioned

Stored in `pnid.annotation_status_col` — update via `PATCH /pid-module/pnids/:pnidId/annotation-status`

---

## DESIGN SYSTEM COMPLIANCE

Follow strict Google Material Design 3 (M3):
- Use color tokens from `frontend/src/data/constants.js`: `M3`, `SC`, `STC`, `COL`, `EC`
- Dark theme surfaces from `frontend/src/lib/theme.js`
- CSS variables `--md-*` from `frontend/src/index.css`
- Tailwind M3 utilities from `frontend/tailwind.config.js`
- Entity colors: Equipment=`M3.primary` (#4FE2B0), Instrument=`M3.secondary` (#8AB4FF), Line=`M3.tertiary` (#FFB068)
- Status colors: `STC.as_built`, `STC.approved`, `STC.draft`
- Pill badges: `${color}20` background + `color` text (see `Pill` component in `MillerColumns.jsx`)
- Canvas/P&ID background always light: `#F5F7F7`

---

## VERIFICATION CHECKLIST

- [ ] P&ID detail view shows all entity lists (lines, equipment, instruments) with counts
- [ ] File references (raw PDF, OCR raw, OCR cleaned) are accessible
- [ ] Single P&ID annotation generation works — creates positioned annotations from OCR bounding boxes
- [ ] Bulk annotation generation works — select multiple P&IDs, run batch
- [ ] P&ID viewer shows annotation overlays at correct positions
- [ ] Annotation status updates through the workflow (not_annotated → annotated → verified)
- [ ] Entity colors match M3 design tokens throughout
- [ ] Clicking annotations shows entity detail
