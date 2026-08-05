# T-Rex2 Few-Shot Detection Recall — Root-Cause Analysis

**Date**: 2026-04-08
**Branch**: `claude/debug-trex2-recall-75ij1`
**Symptom**: 0–1 detections from T-Rex2 despite many visually similar tags on P&ID sheets.

---

## 1. Findings by Severity

### CRITICAL — Image Resolution Mismatch (Confidence: 95%)

**Evidence**:
- Our pipeline rasterizes PDFs at **420 DPI** → produces 13,900–19,600px images (130–270 megapixels).
- The official DDS Python SDK (`dds-cloudapi-sdk`) resizes images to **max 1536px** on the longest edge before sending.
- We send the full-resolution image as a `data:image/png;base64,...` data URL with **no resize**.
- Base64 payloads reach **160–330 MB** for standard P&ID sheet sizes.

**Impact**: The DDS server either:
1. Internally downscales the image (making our pixel-based prompt `rect` coordinates point to wrong locations), or
2. Rejects / silently fails on the oversized payload, or
3. Processes the huge image but the model's feature extraction degrades at non-standard resolutions.

**File**: `backend/src/routes/aiAnnotate.js:199-228` (rasterization), `486-568` (DDS call)

### CRITICAL — Prompt Rect Coordinates Not Rescaled (Confidence: 95%)

**Evidence**:
- Prompt `rect` coordinates are computed from the **full-resolution** pixel dimensions (line 502-506):
  ```js
  const px = toPixelBox(ex.bbox, imageWidth, imageHeight);
  rect: [px.x, px.y, px.x + px.w, px.y + px.h]
  ```
- For a 14,000px wide image, a tag at x=7000 gets `rect[0]=7000`. If DDS resizes to 1536px internally, the coordinate should be ~775.
- Result: **every prompt box points outside the resized image bounds** → model receives zero valid visual prompts → zero detections.

**File**: `backend/src/routes/aiAnnotate.js:500-508`

### HIGH — Duplicate Image in Payload (Confidence: 90%)

**Evidence**:
- Top-level `image` field: full base64 data URL of the raster (line 510).
- `visual_images[0].image`: **same** full base64 data URL again (line 457-459).
- This doubles an already 160MB+ payload to 320MB+.
- The official SDK uses `prompt_image_url` (a URL, not embedded base64) for the prompt image, or sends the same `image` reference.

**File**: `backend/src/routes/aiAnnotate.js:452-483`

### HIGH — Prompt Expansion Dead on Zero Detections (Confidence: 85%)

**Evidence**:
- Recall booster (line 867): `if (visualDetectionsRaw.length > 0 && visualDetectionsRaw.length < expandThreshold)`
- When the first pass returns **0** detections (the most common failure mode), the condition `length > 0` fails and expansion never runs.
- The booster was designed to improve marginal recall, but it can't recover from total failure.

**File**: `backend/src/routes/aiAnnotate.js:865-903`

### HIGH — Variant B Sends Only 1 Example (Confidence: 80%)

**Evidence**:
- Prompt variant B (line 471-473):
  ```js
  visual_interaction: interactions[0] || { ... }
  ```
- If variant A fails and B succeeds, only the **first** user-drawn example box is sent. The other 2–4 examples are discarded.
- Fewer examples = lower recall for the model.

**File**: `backend/src/routes/aiAnnotate.js:471-473`

### MEDIUM — No Score Threshold Sent to T-Rex (Confidence: 75%)

**Evidence**:
- The GroundingDINO path sends `box_threshold: 0.25` and `bbox_threshold: 0.25`.
- The T-Rex path sends **no** score threshold parameter.
- The official demo uses `box_threshold=0.3` as default.
- Without an explicit threshold, the model may use a higher internal default, suppressing borderline detections.

**File**: `backend/src/routes/aiAnnotate.js:492-528` (no threshold for trex mode)

### MEDIUM — Dedup Rounds to Nearest Pixel (Confidence: 60%)

**Evidence**:
- Dedup key: `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.w)}:${Math.round(box.h)}`
- If DDS returns coordinates relative to a 1536px image, nearby tags (e.g., tags in a column) may round to identical keys.
- P&ID drawings often have tags in tight grids.

**File**: `backend/src/routes/aiAnnotate.js:627-639`

### LOW — Frontend Threshold Default 0.7 (Confidence: 70%)

**Evidence**:
- Frontend `useState(0.7)` default for confidence slider.
- Backend assigns `confidence: 0.5` as fallback when score is missing.
- Detections with valid boxes but low model confidence get hidden by default.
- Not a root cause for 0 detections, but suppresses marginal recall.

**File**: `frontend/src/components/annotations/AIAnnotateMode.jsx:39`

---

## 2. Most Likely Root Cause (3 bullets)

1. **Oversized image**: 420 DPI raster (14,000–20,000px) sent to an API expecting max ~1536px. The DDS server likely internally downscales, but our pixel-coordinate prompts remain at original scale — pointing outside image bounds.

2. **Prompt coordinates become invalid after server-side resize**: A tag at pixel (7000, 5000) in a 14,000px image maps to (769, 549) at 1536px. Our prompt says `rect: [7000, 5000, 7200, 5100]` — the model sees empty space or out-of-bounds regions.

3. **No client-side resize + coordinate rescaling**: The official Python SDK handles this transparently via `resize_image(max_size=1536)` before submission. Our JS backend skips this entirely.

---

## 3. Experiment Plan

| ID | Hypothesis | Change | Metric | Pass/Fail |
|----|-----------|--------|--------|-----------|
| E1 | Image resize to 1536px fixes 0-detection issue | Add `sharp().resize(1536)` before DDS call + rescale prompt rects | Detections > 0 on ≥90% of sheets | ≥5 detections avg |
| E2 | Removing duplicate image in payload fixes timeout/size errors | Use same `image` ref, don't embed in `visual_images` | Request succeeds in <10s | No timeout errors |
| E3 | Lower score threshold increases recall | Add `box_threshold: 0.15` to T-Rex payload | Mean detections per sheet | ≥2x current baseline |
| E4 | Prompt expansion on 0 detections recovers recall | Change condition to `length >= 0 && length < threshold` with text-prompt fallback | Recovery rate from 0→N detections | ≥50% recovery |
| E5 | Tiled inference for large sheets improves small-tag recall | Split 1536px image into 4 overlapping tiles, merge results | Recall@IoU=0.5 for tags <20px | ≥30% improvement |
| E6 | Frontend threshold 0.5 shows more valid detections | Lower default from 0.7 to 0.5 | User-visible detection count | ≥20% more visible |

---

## 4. Implementation Roadmap

### Quick Wins (1 day) — This PR

1. **Resize image to 1536px max** before DDS API call, preserving aspect ratio.
2. **Rescale prompt `rect` coordinates** proportionally after resize.
3. **Remove duplicate image** from `visual_images` prompt — use top-level `image` field reference.
4. **Fix prompt expansion** to fire on 0 detections (fallback to text-prompt mode).
5. **Add `box_threshold: 0.2`** parameter to T-Rex payload.
6. **Add diagnostic logging** for image dimensions, payload size, detection count.

### Near-Term (3–5 days)

7. Higher-DPI crop for OCR: rasterize at 420 DPI separately for OCR crops, use 1536px version only for detection.
8. Tiled inference: split large drawings into overlapping quadrants, merge detections with NMS.
9. Session-based embedding reuse: cache T-Rex embeddings per drawing for iterative refinement.

### Structural (1–2 weeks)

10. Adaptive DPI: analyze drawing content density to choose optimal rasterization DPI.
11. GroundingDINO hybrid: use text prompts for broad sweep, T-Rex visual prompts for precision refinement.
12. Feedback loop: use accepted/rejected detections to tune per-drawing thresholds.

---

## 5. Target Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Detection recall@IoU=0.5 (line tags) | ~0% (0–1 det) | ≥60% |
| Mean detections per sheet | 0.5 | ≥15 |
| Review precision at threshold 0.5 | N/A | ≥70% |
| Time-to-acceptable coverage (per sheet) | Manual only | <5 min with AI assist |

---

## References

- [DDS Cloud API SDK — image_resizer.py](https://github.com/deepdataspace/dds-cloudapi-sdk) — `max_size=1536` default
- [T-Rex2 interactive_inference.py](https://github.com/IDEA-Research/T-Rex/blob/trex2/demo_examples/interactive_inference.py) — pixel coords, `box_threshold=0.3`
- [IVP Task docs](https://cloudapi-sdk.deepdataspace.com/dds_cloudapi_sdk/tasks/ivp.html) — rect format `[x1,y1,x2,y2]`
