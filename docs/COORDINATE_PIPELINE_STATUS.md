# Coordinate Pipeline — Final Status Report

**Date:** 2026-04-06  
**Bug:** Annotation tags appear at (0,0) instead of correct positions on P&ID drawings.

---

## Pipeline Overview

```
PDF/Image → [Stage 1] Google Vision OCR → raw words with pixel vertices
          → [Stage 2a] Word Grouper → grouped words with pixel + pct coords
          → [Stage 2b] AI Classify → classified tags with boundingBox + position_pct
          → [Stage 3] Human Review → approved/edited/rejected tags (coords preserved via spread)
          → [Sync] reviewSyncToExtractions → ocr_extraction table (bbox_x/y/w/h_pct)
          → [Stage 5] Register Staging → register_staging_item.payload.position_pct
          → [Stage 6] Apply → junction tables (annotation_x/y/w/h_pct)
          → [Repair] repair-links → re-reads storage JSONs to backfill coordinates
          → [Overlay API] GET /pnids/:id/overlay → { xPct, yPct, wPct, hPct }
          → [Frontend] OverlayLayer.jsx → CSS left/top/width/height as percentages
```

---

## What WORKS (coordinates are correct)

| Stage | File | Status |
|-------|------|--------|
| **Stage 1: Raw OCR** | `VisionOCRProvider.js:239-283` | Google Vision returns valid pixel vertices + `pageWidth`/`pageHeight`. |
| **Stage 2a: Grouping** | `WordGrouper.js:123-137` | `verticesToPct()` correctly converts pixels → percentages. `position_pct` and `position_px` both attached. |
| **Stage 2b: Classification** | `OcrPipeline.js:329-361` | `computeBoundingBox()` reconstructs pixel box from `wordIndices`. `addBoundingBox()` converts to `position_pct` using `pageWidth`/`pageHeight`. Both `boundingBox` (pixels) and `position_pct` are on every classified tag. |
| **Stage 3: Review save** | `ocrPipeline.js:1806-1810` | `...tag` spread preserves `position_pct` and `boundingBox` on approved/edited tags. |
| **Frontend rendering** | `OverlayLayer.jsx:102-107` | CSS `left: X%, top: Y%` inside `absolute inset-0` container. Image and overlay share same container → percentages align correctly. Zoom/pan applies to outer wrapper → positions stay correct. |

---

## What's BROKEN (where coordinates get lost)

### Bug 1 (PRIMARY): `bboxPctFromTag()` falls back to (0,0) — `reviewSyncToExtractions.js:52-74`

```javascript
function bboxPctFromTag(tag) {
  const p = tag.position_pct || tag.positionPct;
  if (p && (p.x_pct != null || p.xPct != null)) {
    return { x: Number(p.x_pct ?? ...), ... };  // ← WORKS if position_pct exists
  }
  // Fallback: boundingBox + pageWidth/Height
  const bb = tag.boundingBox;
  const pageW = tag.pageWidth || tag.page_width || tag._pageW;  // ← NOT ON INDIVIDUAL TAGS!
  const pageH = tag.pageHeight || tag.page_height || tag._pageH;
  if (bb && pageW && pageH && bb.minX != null) { ... }
  return { x: 0, y: 0, w: 0, h: 0 };  // ← LINE 73: DEFAULT (0,0)
}
```

**Why it breaks:** The primary path (lines 53-60) works IF `position_pct` exists on the tag. But the fallback path (lines 62-71) fails because `pageWidth`/`pageHeight` are stored at the **classified JSON root** (`classifiedData.pageWidth`), NOT on individual tags. So if a tag somehow has `boundingBox` but no `position_pct`, the fallback can't compute percentages.

**Impact:** Writes `bbox_x_pct = 0, bbox_y_pct = 0` to `ocr_extraction` table.

### Bug 2: `upsertPnidLink()` defaults missing coords to 0 — `registerStagingService.js:219-222`

```javascript
const x = bbox?.x_pct != null ? Number(bbox.x_pct) : 0;  // ← was 0, NOW FIXED → null
```

**Status: FIXED** in this session. Changed from `0` to `null`.

### Bug 3: `repair-links` coordinate validation — `ocrRegisterStaging.js:600`

```javascript
const hasCoords = pos.x_pct > 0 || pos.y_pct > 0;
```

**Problem:** Uses `> 0` instead of `!= null`. If both coords are exactly 0 (from bug #1), treats them as "no coordinates" and skips the junction table update entirely.

**Also at line 511:**
```javascript
if (!pos || (pos.x_pct === 0 && pos.y_pct === 0)) return;  // skips valid (0,0) entries
```

### Bug 4: `extractPos()` in repair-links — `ocrRegisterStaging.js:486`

```javascript
if (pos && (pos.x_pct || pos.xPct)) {  // ← Falsy check! x_pct=0 is falsy!
```

**Problem:** `pos.x_pct || pos.xPct` — if `x_pct` is `0`, it's falsy, so this check fails even though coordinates exist. Should be `pos.x_pct != null || pos.xPct != null`.

### Bug 5: `Number(null) → 0` in overlay API — `annotations.js:82-85`

```javascript
xPct: Number(ep.annotation_x_pct),  // NULL → 0
yPct: Number(ep.annotation_y_pct),  // NULL → 0
```

**Problem:** Frontend can't distinguish "no position" from "position at origin". Low priority — only matters once we stop writing zeros.

### Bug 6: `pass-to-annotation` filters `bbox_x_pct > 0.5` — `ocrPipeline.js:2034`

```javascript
AND bbox_x_pct IS NOT NULL AND bbox_x_pct > 0.5
```

**Problem:** If `ocr_extraction.bbox_x_pct` is 0 (from bug #1), this query skips the extraction entirely. No junction table entry is created via this path.

---

## The Full Bug Chain

```
1. Classification produces valid position_pct on tags               ✅ WORKS
2. Review spread preserves position_pct                              ✅ WORKS  
3. reviewSyncToExtractions → bboxPctFromTag()
   a. If position_pct exists on tag → extracts correctly             ✅ WORKS
   b. If position_pct missing, tries boundingBox + pageWidth
      → pageWidth NOT on tag → returns {x:0, y:0, w:0, h:0}        ❌ BUG #1
4. ocr_extraction gets bbox_x_pct=0, bbox_y_pct=0                   ❌ from #1
5. pass-to-annotation filters bbox_x_pct > 0.5 → skips zero rows    ❌ BUG #6
6. Register staging payload may have position_pct or not
7. repair-links tries to find coordinates:
   a. extractPos() checks (pos.x_pct || pos.xPct) → 0 is falsy      ❌ BUG #4
   b. hasCoords = x_pct > 0 || y_pct > 0 → 0 fails                  ❌ BUG #3
   c. Falls through to "no coords" → creates junction WITHOUT coords
8. Junction table: annotation_x_pct = NULL or 0                      ❌
9. Overlay API: Number(null) = 0 → returns xPct: 0                   ❌ BUG #5
10. Frontend: left: 0%, top: 0% → TOP-LEFT CORNER                    ❌ visible bug
```

**Key question:** Does `position_pct` actually exist on classified tags in YOUR storage JSONs? If yes, bug #1's fallback path is irrelevant and the problem is elsewhere. The CSV diagnostic endpoint will answer this.

---

## What Needs to Be Fixed

### Priority 1: Verify `position_pct` exists in storage JSONs
Use the new diagnostic endpoint:
```
GET /api/v1/ocr-pipeline/batches/{batchId}/files/{fileId}/coordinate-trace?format=csv
```
This exports CSV at every stage. Check:
- Stage 2b classified: does every tag have non-zero `x_pct`, `y_pct`?
- Stage 3 review: does every approved tag still have `position_pct`?
- Stage 4 ocr_extraction: are `bbox_x_pct`/`bbox_y_pct` non-zero?

### Priority 2: Fix `extractPos()` falsy check (ocrRegisterStaging.js:486)
```javascript
// BEFORE:
if (pos && (pos.x_pct || pos.xPct)) {
// AFTER:
if (pos && (pos.x_pct != null || pos.xPct != null)) {
```

### Priority 3: Fix `hasCoords` check (ocrRegisterStaging.js:600)
```javascript
// BEFORE:
const hasCoords = pos.x_pct > 0 || pos.y_pct > 0;
// AFTER:
const hasCoords = pos.x_pct != null && pos.y_pct != null;
```

### Priority 4: Fix `addTagToMap` skip (ocrRegisterStaging.js:511)
```javascript
// BEFORE:
if (!pos || (pos.x_pct === 0 && pos.y_pct === 0)) return;
// AFTER:
if (!pos) return;
```

### Priority 5: Fix `pass-to-annotation` filter (ocrPipeline.js:2034)
```javascript
// BEFORE:
AND bbox_x_pct IS NOT NULL AND bbox_x_pct > 0.5
// AFTER:
AND bbox_x_pct IS NOT NULL AND (bbox_x_pct > 0 OR bbox_y_pct > 0)
```

### Priority 6 (already done): `upsertPnidLink` → null instead of 0
Already fixed in `registerStagingService.js:219-222`.

### Priority 7: Fix overlay API null handling (annotations.js:82-85)
```javascript
// BEFORE:
xPct: Number(ep.annotation_x_pct),
// AFTER:  
xPct: ep.annotation_x_pct != null ? Number(ep.annotation_x_pct) : null,
```

### After fixes: Re-run repair-links
```
POST /api/v1/ocr-pipeline/platforms/{platformId}/register-staging/repair-links
```
This will re-read the storage JSONs and backfill correct coordinates into junction tables.

---

## Diagnostic CSV Endpoint

**Added in this session:**

```
GET /api/v1/ocr-pipeline/batches/:batchId/files/:fileId/coordinate-trace
```

Query params:
- `format=json` (default) — returns structured JSON with all stages
- `format=csv` — returns downloadable CSV with all stages as sections

### CSV Output Columns by Stage

**Stage 1: Raw OCR Words**
`wordIndex, text, confidence, minX_px, minY_px, maxX_px, maxY_px, width_px, height_px, x_pct, y_pct, w_pct, h_pct, pageWidth, pageHeight`

**Stage 2a: Grouped Words**
`groupId, text, wordCount, confidence, x_px, y_px, w_px, h_px, x_pct, y_pct, w_pct, h_pct, pageWidth, pageHeight`

**Stage 2b: Classified Tags**
`index, text, type, subType, confidence, wordIndices, bb_minX_px, bb_minY_px, bb_maxX_px, bb_maxY_px, bb_w_px, bb_h_px, x_pct, y_pct, w_pct, h_pct, pageWidth, pageHeight, isUncertain`

**Stage 3: Reviewed Tags**
`index, text, type, reviewAction, confidence, has_position_pct, x_pct, y_pct, w_pct, h_pct, has_boundingBox, bb_minX_px, bb_minY_px, bb_maxX_px, bb_maxY_px, has_pageWidth, pageWidth, pageHeight`

**Stage 4: ocr_extraction Table**
`id, text, type, status, bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct, bbox_x_px, bbox_y_px, bbox_w_px, bbox_h_px, matchedEntityId, coords_are_zero`

**Stage 5: Junction Tables**
`entityKind, tagText, annotation_x_pct, annotation_y_pct, annotation_w_pct, annotation_h_pct, positionVerified, coords_are_zero`

### How to Use
1. Find your batch ID and file ID
2. Call the endpoint with `?format=csv`
3. Open in Excel/Google Sheets
4. Check each stage: are coordinates non-zero? Where do they become 0?
5. This tells you exactly which bug is active in your data
