# Coordinate Pipeline Investigation Report

**Date:** 2026-04-06
**Bug:** Annotation tags appear at (0,0) top-left corner instead of their correct positions on the P&ID drawing.

---

## Executive Summary

The coordinate pipeline flows through 8 stages: OCR → Grouping → Classification → Review → Extraction Sync → Register Staging → Junction Tables → Overlay Rendering. The primary confirmed bug is in **`upsertPnidLink()`** (`registerStagingService.js:219-222`) which defaults missing bbox coordinates to `0` instead of `NULL`, causing tags to render at the top-left corner. A secondary issue is that `bboxPctFromTag()` (`reviewSyncToExtractions.js:73`) falls back to `{x:0, y:0}` when `pageWidth`/`pageHeight` are not present on individual tags (they're stored at the JSON root).

> **CORRECTION (2026-04-06):** The initial investigation incorrectly stated that `register_staging_item` doesn't exist and `ocr_batch_file` lacks storage key columns. Both are created by migrations (`007_register_staging.sql` and `005_stage_based_pipeline.sql`/`006_stage3_review.sql` respectively). The initial DB queries ran against an uninitialized database state.

---

## Stage 1: Raw OCR Output — Google Vision Coordinates

### Google Vision Provider
**File:** `backend/src/services/ocr/VisionOCRProvider.js` (Lines 239-283)

Google Vision returns pixel-based bounding polygons. The provider parses each word:

```javascript
// Lines 260-275
const text = word.symbols.map(s => s.text).join('');
const vertices = (word.boundingBox?.vertices || []).map(v => ({
  x: v.x || 0,
  y: v.y || 0,
}));

words.push({
  text,
  confidence: word.confidence || 0,
  vertices,        // Array of 4 {x, y} pixel coordinates (bounding polygon)
  pageWidth,       // Image width in pixels
  pageHeight,      // Image height in pixels
});
```

**Raw word structure:**
```json
{
  "text": "V-101",
  "confidence": 0.95,
  "vertices": [
    { "x": 600, "y": 300 },
    { "x": 650, "y": 300 },
    { "x": 650, "y": 320 },
    { "x": 600, "y": 320 }
  ],
  "pageWidth": 2400,
  "pageHeight": 1700
}
```

### Claude Vision Provider
**File:** `backend/src/services/ocr/ClaudeVisionOCRProvider.js` (Lines 177-199)

Claude returns percentage-based bounding boxes (`{ x_pct, y_pct, w_pct, h_pct }`), which are **converted to pixel vertices** for consistency:

```javascript
const x = (bbox.x_pct || 0) / 100 * pageWidth;
const y = (bbox.y_pct || 0) / 100 * pageHeight;
const w = (bbox.w_pct || 5) / 100 * pageWidth;
const h = (bbox.h_pct || 2) / 100 * pageHeight;
// Returns vertices array in same format as Google Vision
```

**Finding:** Both providers output identical format. Coordinates are valid pixel values at this stage.

---

## Stage 2: Word Grouping — `verticesToPct()`

**File:** `backend/src/services/ocr/WordGrouper.js`

### Merging multiple words (Lines 44-59: `mergeVertices()`)
```javascript
function mergeVertices(verticesArrays) {
  const allVertices = verticesArrays.flat();
  const xs = allVertices.map(v => v.x || 0);
  const ys = allVertices.map(v => v.y || 0);
  return [
    { x: Math.min(...xs), y: Math.min(...ys) },  // top-left
    { x: Math.max(...xs), y: Math.min(...ys) },  // top-right
    { x: Math.max(...xs), y: Math.max(...ys) },  // bottom-right
    { x: Math.min(...xs), y: Math.max(...ys) }   // bottom-left
  ];
}
```

### Conversion to percentages (Lines 123-137: `verticesToPct()`)
```javascript
export function verticesToPct(vertices, imageWidth, imageHeight) {
  const xs = vertices.map(v => v.x || 0);
  const ys = vertices.map(v => v.y || 0);
  return {
    x_pct: (Math.min(...xs) / imageWidth) * 100,
    y_pct: (Math.min(...ys) / imageHeight) * 100,
    w_pct: ((Math.max(...xs) - Math.min(...xs)) / imageWidth) * 100,
    h_pct: ((Math.max(...ys) - Math.min(...ys)) / imageHeight) * 100,
  };
}
```

### Stage 2 Group output (Lines 119-162: `runStage2_Group()`)
```javascript
const pct = g.vertices ? verticesToPct(g.vertices, pageWidth, pageHeight) : null;
return {
  text: g.text,
  vertices: g.vertices,
  position_pct: pct,    // ← Percentage bounding box
  position_px: px,      // ← Pixel bounding box
};
```

**`pageWidth`/`pageHeight` source:** From Stage 1 raw OCR output, defaulting to `2400×1700` if missing.

**Worked example:**
- Image: 2400×1700 px
- Word vertices: minX=600, maxX=650, minY=300, maxY=320
- Result: `{ x_pct: 25.0, y_pct: 17.6, w_pct: 2.08, h_pct: 1.18 }`

**Finding:** Coordinates are correct at this stage, assuming `pageWidth`/`pageHeight` are properly propagated.

---

## Stage 3: AI Classification — `addBoundingBox()`

**File:** `backend/src/services/ocr/OcrPipeline.js`

### `computeBoundingBox()` (Lines 329-347)
Reconstructs bounding box from `wordIndices` by looking up each word's vertices in the original raw OCR array:

```javascript
function computeBoundingBox(wordIndices) {
  for (const idx of wordIndices) {
    const w = originalWords[idx];  // ← Lookup by index
    for (const v of w.vertices) {
      if (v.x < minX) minX = v.x;  // ← Pixel coordinates
      // ...
    }
  }
  return { minX, minY, maxX, maxY };  // ← Pixel bounding box
}
```

### `addBoundingBox()` (Lines 349-361)
```javascript
function addBoundingBox(item) {
  const box = computeBoundingBox(item.wordIndices);
  if (box) {
    item.boundingBox = box;
    item.position_pct = {
      x_pct: +(box.minX / pageW * 100).toFixed(1),
      y_pct: +(box.minY / pageH * 100).toFixed(1),
      w_pct: +((box.maxX - box.minX) / pageW * 100).toFixed(1),
      h_pct: +((box.maxY - box.minY) / pageH * 100).toFixed(1),
    };
  }
}
```

Where `pageW` and `pageH` come from (Lines 326-327):
```javascript
const pageW = rawData.pageWidth || 2400;
const pageH = rawData.pageHeight || 2400;  // Note: defaults to 2400, not 1700
```

**Potential issue:** If `rawData.pageWidth` or `rawData.pageHeight` is `0` (falsy), it defaults to 2400. This prevents division-by-zero but may produce incorrect percentages if the actual image dimensions differ significantly from 2400.

**Finding:** `position_pct` is correctly computed at this stage if `pageWidth`/`pageHeight` are present. The `boundingBox` (pixel) is also preserved as a fallback.

---

## Stage 4: Review — Coordinate Preservation

**File:** `backend/src/routes/ocrPipeline.js` (Lines 1753-1886)

### `save-review` endpoint
Approved/edited tags preserve all properties via spread:
```javascript
// Lines 1806-1810
approved.push({
  ...tag,           // ← Spread preserves position_pct and boundingBox
  reviewAction: 'approved',
  reviewNotes: dec.notes || null,
});
```

**Finding:** The spread operator **does preserve** `position_pct` and `boundingBox`. Coordinates are intact after review.

### Sync to `ocr_extraction` table
**File:** `backend/src/services/ocr/reviewSyncToExtractions.js`

#### `bboxPctFromTag()` (Lines 52-74)
```javascript
function bboxPctFromTag(tag) {
  // Try 1: position_pct / positionPct
  const p = tag.position_pct || tag.positionPct;
  if (p && (p.x_pct != null || p.xPct != null)) {
    return { x: Number(p.x_pct ?? p.xPct ?? 0), y: ..., w: ..., h: ... };
  }
  // Try 2: boundingBox + pageWidth/pageHeight
  const bb = tag.boundingBox;
  const pageW = tag.pageWidth || tag.page_width || tag._pageW;
  const pageH = tag.pageHeight || tag.page_height || tag._pageH;
  if (bb && pageW && pageH && bb.minX != null) {
    return { x: +((bb.minX / pageW) * 100).toFixed(2), ... };
  }
  // FALLBACK: returns zeros
  return { x: 0, y: 0, w: 0, h: 0 };  // ← LINE 73: DEFAULT (0,0)
}
```

**⚠️ Bug Point #1:** If a tag has `boundingBox` but **no `pageWidth`/`pageHeight`** attached to it, the function skips the boundingBox fallback and returns `{x:0, y:0}`. The review JSON preserves `tag.boundingBox` but the `pageWidth`/`pageHeight` are top-level properties of the classified JSON, not properties of individual tags.

This writes zeros to `ocr_extraction.bbox_x_pct/bbox_y_pct`.

---

## Stage 5: Register Staging — Payload Construction

**File:** `backend/src/services/ocr/registerStagingService.js`

### `bboxFromPayload()` (Lines 72-82)
```javascript
function bboxFromPayload(source) {
  if (!source || typeof source !== 'object') return {};
  const p = source.position_pct || source.positionPct;
  if (!p || typeof p !== 'object') return {};
  return { x_pct: p.x_pct, y_pct: p.y_pct, w_pct: p.w_pct, h_pct: p.h_pct };
}
```

### Payload construction (~Line 589)
```javascript
const payload = {
  tagText: normText(tag._finalText || tag.text),
  // ...
  position_pct: tag.position_pct || bboxFromPayload(tag),
};
```

**Finding:** If `tag.position_pct` exists and has valid values, it flows through. If missing, `bboxFromPayload()` tries to extract it but may return `{}`.

### Note: `register_staging_item` table
Created by `database/migrations/007_register_staging.sql` (not in the base `schema.sql`). The pipeline runs through this stage successfully.

---

## Stage 6: Apply — Junction Table Writes

**File:** `backend/src/services/ocr/registerStagingService.js`

### `upsertPnidLink()` (Lines 218-285)

```javascript
async function upsertPnidLink(tx, { pnidId, entityKind, matchedEntityId, bbox }) {
  const x = bbox?.x_pct != null ? Number(bbox.x_pct) : 0;  // ← DEFAULT TO 0
  const y = bbox?.y_pct != null ? Number(bbox.y_pct) : 0;  // ← DEFAULT TO 0
  const w = bbox?.w_pct != null ? Number(bbox.w_pct) : 0;
  const h = bbox?.h_pct != null ? Number(bbox.h_pct) : 0;

  // Writes to pnid_equipment / pnid_instrument / pnid_line
  await tx.pnid_equipment.upsert({
    create: { annotation_x_pct: x, annotation_y_pct: y, ... },
    update: { annotation_x_pct: x, annotation_y_pct: y, ... },
  });
}
```

**⚠️ Bug Point #2:** If `bbox` is `{}` (empty object from failed extraction), then `bbox.x_pct` is `undefined`, and `undefined != null` is `false`, so `x = 0`. All coordinates become 0.

### Bbox merge logic (Lines 828-838)
```javascript
let bbox = bboxFromPayload(payload);  // Could be {}
if (item.extraction_id) {
  const [ex] = await tx.$queryRaw`
    SELECT bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
    FROM ocr_extraction WHERE id = ${item.extraction_id}::uuid
  `;
  if (ex) bbox = { ...bboxFromExtraction(ex), ...bbox };
  //                                          ^^^^^^^^
  // BUG: bbox (from payload) OVERWRITES extraction values
  // If bbox is {}, it still spreads as empty, so extraction values survive
  // But if bbox has { x_pct: undefined }, it overwrites extraction x_pct with undefined
}
```

---

## Stage 7: Repair Endpoint

**File:** `backend/src/routes/ocrRegisterStaging.js`

### `repair-links` POST endpoint
Tries three coordinate sources in priority order:

1. **Review JSON** → `tag.position_pct` or `tag.positionPct`
2. **`ocr_extraction`** → `bbox_x_pct, bbox_y_pct` columns
3. **Staging payload** → `payload.position_pct`

### `extractPos()` helper (~Lines 484-507)
```javascript
// Line 511: Skips tags at origin
if (!pos || (pos.x_pct === 0 && pos.y_pct === 0)) return;
```

### Coordinate validation (~Line 600)
```javascript
const hasCoords = pos.x_pct > 0 || pos.y_pct > 0;
```

**⚠️ Bug Point #3:** The `> 0` check rejects any coordinate at exactly 0 on either axis. While rare, a tag at x=0% is valid. More importantly, if all upstream sources returned 0, the repair can't fix anything.

---

## Stage 8: P&ID Overlay Rendering

### Backend: Overlay API
**File:** `backend/src/routes/annotations.js` (Lines 36-117)

```javascript
// Lines 82-85
equipment: equipmentPositions.map(ep => ({
  xPct: Number(ep.annotation_x_pct),    // NULL → 0, Decimal "0.00" → 0
  yPct: Number(ep.annotation_y_pct),
  wPct: Number(ep.annotation_w_pct),
  hPct: Number(ep.annotation_h_pct),
})),
```

**Finding:** `Number(null)` → `0` in JavaScript. No distinction between "coordinates are zero" and "coordinates are missing".

### Frontend: OverlayLayer
**File:** `frontend/src/components/pnid/OverlayLayer.jsx`

```jsx
// Lines 102-107
style={{
  left: `${eq.xPct}%`,     // 0% = top-left corner
  top: `${eq.yPct}%`,
  width: `${eq.wPct}%`,    // 0% = invisible
  height: `${eq.hPct}%`,
}}
```

**Finding:** When coordinates are 0, the annotation renders at top-left with zero dimensions — either invisible or appearing as a dot at (0,0).

---

## Stage 9: Image Size vs Coordinate Space

### PnidViewer container
**File:** `frontend/src/components/pnid/PnidViewer.jsx` (Lines 485-509)

```jsx
<div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
  <div className="relative" style={{ width: drawingSize.width, height: drawingSize.height }}>
    <img className="absolute inset-0 w-full h-full" style={{ objectFit: 'contain' }} />
    <OverlayLayer />  {/* absolute inset-0 inside same container */}
  </div>
</div>
```

**Architecture:**
- The overlay `<div>` is `position: absolute; inset: 0` — same size as the image container
- The image container is sized to `drawingSize` (image natural dimensions)
- Percentage CSS (`left: X%`, `top: Y%`) positions relative to the container
- Zoom/pan is applied to the outer wrapper, so overlay scales with the image

**Finding:** The coordinate space is correct — percentages are relative to the image dimensions, and zoom preserves the relationship. The rendering layer is not the problem.

---

## Database State

> **CORRECTION:** Initial queries ran against an uninitialized database. Actual state after running the full pipeline + repair-links:
> - Junction tables have ~123 lines, ~129 equipment, ~133 instruments — all with `annotation_x_pct = 0, annotation_y_pct = 0`
> - `register_staging_item` exists via `database/migrations/007_register_staging.sql`
> - `ocr_batch_file` has storage key columns via `migrations/005_stage_based_pipeline.sql` and `006_stage3_review.sql`

---

## End-to-End Trace: Why Coordinates Are (0,0)

The full pipeline has run end-to-end, but coordinates end up as zeros. Tracing the code path:

### The Bug Chain

```
Stage 1: Raw OCR
  ✅ Vertices are valid pixel coordinates with pageWidth/pageHeight

Stage 2: Word Grouping
  ✅ verticesToPct() correctly converts to percentages
  ✅ position_pct is computed and attached to grouped words

Stage 3: AI Classification
  ✅ addBoundingBox() recomputes position_pct from wordIndices
  ⚠️ pageWidth/pageHeight defaults to 2400 if missing — may be inaccurate

Stage 4: Review
  ✅ Spread operator preserves position_pct and boundingBox
  ⚠️ bboxPctFromTag() falls back to (0,0) if tag lacks pageWidth/pageHeight
     alongside boundingBox (reviewSyncToExtractions.js:73)

Stage 5: Register Staging
  ✅ Table exists (migration 007). Pipeline runs.
  ⚠️ bboxFromPayload() returns {} if position_pct missing from payload

Stage 6: Apply to Junction Tables
  ❌ upsertPnidLink() defaults all missing coords to 0 (line 219-222) — FIXED → null
  ⚠️ Staging items initially had pnid_id=NULL → upsertPnidLink was skipped entirely

Stage 7: Repair
  ✅ Runs and creates junction entries (~123 lines, ~129 equipment, ~133 instruments)
  ⚠️ hasCoords check rejects x_pct=0 || y_pct=0 (line 600)

Stage 8: Overlay API
  ⚠️ Number(null) → 0 loses the distinction between "zero" and "missing"

Stage 9: Frontend Rendering
  ✅ Coordinate space is correct (percentage of image container)
  ⚠️ Renders at (0,0) with 0×0 dimensions if coordinates are zero
```

---

## Root Causes (Prioritized)

### 1. HIGH: `upsertPnidLink()` silently defaults missing coordinates to 0
- **File:** `backend/src/services/ocr/registerStagingService.js:219-222`
- Empty bbox `{}` becomes `{x: 0, y: 0, w: 0, h: 0}` instead of `NULL`
- **Action:** Use `NULL` instead of `0` for missing coordinates, so the overlay API can distinguish "no coordinates" from "at origin"
- **Status: FIXED** — changed defaults from `0` to `null`

### 2. MEDIUM: `bboxPctFromTag()` fallback loses coordinates when `pageWidth`/`pageHeight` missing from tags
- **File:** `backend/src/services/ocr/reviewSyncToExtractions.js:52-74`
- The primary path (lines 53-60) works fine when `position_pct` is set on tags by `addBoundingBox()`
- The secondary fallback path (lines 62-71) using `boundingBox` + `pageWidth`/`pageHeight` fails because those dimensions are stored at the JSON root level, not per-tag
- **Action:** When iterating tags, pass `pageWidth`/`pageHeight` from the root JSON object to `bboxPctFromTag()`

### 3. LOW: Repair endpoint rejects valid zero-axis coordinates
- **File:** `backend/src/routes/ocrRegisterStaging.js:600`
- `pos.x_pct > 0 || pos.y_pct > 0` should be `pos.x_pct != null || pos.y_pct != null`
- Unlikely to affect real P&IDs (tags rarely sit at exactly x=0% or y=0%)

### 4. LOW: `Number(null) → 0` in overlay API
- **File:** `backend/src/routes/annotations.js:82-85`
- Only matters once `upsertPnidLink` writes `NULL` (fix #1), then the API should pass `null` through to frontend

---

## Recommendations

1. **~~DONE~~** Change `upsertPnidLink()` to write `NULL` instead of `0` for missing coordinates
2. **Fix `bboxPctFromTag()`** to receive `pageWidth`/`pageHeight` from the classified JSON root, not from individual tags
3. **Fix the overlay API** to return `null` instead of `0` for missing coordinates
4. **Add a frontend guard** in OverlayLayer to skip rendering annotations where `xPct === null || yPct === null`
5. **Re-run repair-links** after fixes to backfill correct coordinates from classified JSONs
