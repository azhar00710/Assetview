# Session: Register & Annotate Panel Redesign

## Context

The OCR-to-Annotation pipeline is now working end-to-end. Auto-annotation places tags correctly on P&ID drawings. The remaining UX problem is in the **Register & Annotate** section — it's confusing and requires too many steps. The user must currently:

1. Click "Write OCR tags to DB" (unclear what this means)
2. Select batches and entity kinds
3. Click "Queue approved tags"
4. Review a staging inbox with link/add/remove actions they can't easily interact with
5. Apply selected items
6. Click "Repair P&ID links" to backfill coordinates

This needs to become a **single, clear workflow panel**.

## Current Architecture (what exists)

### Backend Services
- `backend/src/services/ocr/reviewSyncToExtractions.js` — "Write OCR tags to DB": syncs reviewed tags from storage JSON → `ocr_extraction` table with bbox coordinates
- `backend/src/services/ocr/registerStagingService.js` — "Queue approved tags": compares `ocr_extraction` against existing line/equipment/instrument registers, creates `register_staging_item` rows with action types:
  - `link_pnid` — tag matches existing entity → create junction table entry
  - `create_entity` — tag is new → create entity + junction entry  
  - `remove_link` — entity was linked to P&ID but OCR didn't find it → suggest removing junction link
- `backend/src/routes/ocrRegisterStaging.js` — Apply/cancel staging items, repair-links endpoint

### Frontend Components
- `frontend/src/components/ocr-pipeline/RegisterStagingCard.jsx` — Current staging inbox UI
- `frontend/src/components/ocr-pipeline/BatchReviewPanel.jsx` — Parent component with "Write OCR tags to DB" button

### Database Tables
- `ocr_extraction` — Middleware/tagging DB: stores every OCR-detected tag with bbox, match status, confidence
- `register_staging_item` — Queue of pending changes before applying to registers
- `pnid_equipment`, `pnid_line`, `pnid_instrument` — Junction tables linking entities to P&IDs with annotation coordinates
- `equipment`, `line`, `instrument` — The actual register tables

### Junction Table Coordinate Flow
When staging items are applied:
1. `applyRegisterStaging()` calls `upsertPnidLink()` to create junction entries
2. `upsertPnidLink()` writes `annotation_x_pct`, `annotation_y_pct`, `annotation_w_pct`, `annotation_h_pct`
3. Coordinates come from `position_pct` in the staging payload (originally from OCR bounding boxes)
4. The `repair-links` endpoint backfills missing coordinates from review/classified JSONs in storage

## What Needs to Change

### 1. Rename "Write OCR tags to DB" → "Sync OCR Tags"
Make it clear this is a **sync/middleware step**, not writing to the final register. Show it as:
- "Sync OCR tags to extraction database" with a subtitle explaining it's a staging area
- Show count: "157 tags synced (57 new, 100 updated)"

### 2. Combine Register Comparison + Register Staging into ONE Panel
Currently these are two separate sections. Merge into a single **"Register Changes"** panel with:

**Left side: OCR Detected Tags (from this batch)**
- Grouped by discipline (Lines | Equipment | Instruments)
- Each tag shows: tag text, type, confidence, bbox position
- Checkbox for bulk select/deselect

**Right side: Register Match Status**
- For each tag: what action will happen
  - ✅ `MATCH` — exists in register, will auto-link to P&ID
  - ➕ `NEW` — not in register, will create + link
  - ⚠️ `REMOVED` — was on P&ID but OCR didn't find it, suggest unlink
- Color-coded: green=match, blue=new, orange=removed

### 3. Single Decision Panel
From this combined view, the user should be able to:
1. **Filter by discipline** (Lines / Equipment / Instruments tabs)
2. **Bulk select/deselect** by action type (all matches, all new, all removed)
3. **Review individual items** — click to see OCR source, register comparison
4. **Approve selections** — single "Apply to Register" button that:
   - Creates new entities for `NEW` items
   - Links ALL approved items to their P&IDs (auto — no separate "Repair P&ID links" step)
   - Writes annotation coordinates automatically
   - Removes junction links for approved `REMOVED` items

### 4. Auto-link to P&ID (no manual step)
Currently the user must click "Repair P&ID links" separately. This must be automatic:
- When staging items are applied, junction table entries are created WITH coordinates in one step
- The `repair-links` logic should be integrated into `applyRegisterStaging()`
- No separate button needed

### 5. Final Step: "Annotate P&ID"
After applying to register, show a confirmation:
- "34 equipment, 26 lines, 13 instruments annotated on 2 P&IDs"
- Link to open each P&ID in the viewer to verify annotations

## UI Design Guidelines
- Dark mode: `bg=#0D1F17`, `panel=#111D14`, `card=#16352B`, `text=#D3DFE2`
- Accent: `#3BE494` (process green), Secondary: `#2D33E0` (blue)
- Font: 11px base, 9px labels, monospace for tag numbers
- Use Material Symbols Outlined icons
- Table rows: compact (py-1.5), hover highlight, checkbox on left

## Files to Modify
- `frontend/src/components/ocr-pipeline/RegisterStagingCard.jsx` — Major redesign
- `frontend/src/components/ocr-pipeline/BatchReviewPanel.jsx` — Simplify Register & Annotate section
- `backend/src/services/ocr/registerStagingService.js` — Integrate repair-links into apply flow
- `backend/src/routes/ocrRegisterStaging.js` — Simplify endpoints, auto-link P&IDs on apply

## Key Constraints
- Must work with existing data — don't break the pipeline
- Coordinates must flow through correctly (the normalizedVertices fix is in place)
- The `ocr_extraction` table is a middleware/tagging DB — make that clear in UI
- Junction table writes must include `annotation_x_pct`, `annotation_y_pct`, `annotation_w_pct`, `annotation_h_pct`
- Keep the CSV coordinate trace endpoint working

## Test Data
- Platform: AKK4
- Batch: "AKK4 — 4/6/2026" (2 files, 132 words, 73 tagged entities)
- P&IDs: AD-28-D-100000-SHT-001, AD-28-D-100001-SHT-001
