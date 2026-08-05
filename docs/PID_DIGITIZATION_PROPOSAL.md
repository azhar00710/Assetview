# P&ID Full Digitization — AI Pipeline Proposal

## Executive Summary

Instead of manually annotating P&ID drawings with hyperlinks, **rebuild the entire P&ID as an interactive digital twin** — a pixel-perfect SVG replica where every symbol, line, tag, and connection is a clickable, queryable, connected object. The original drawing appearance is preserved 100% (regulatory compliance), but underneath it's a fully structured, interactive engineering document.

---

## The Problem with Current Approach

| Current (Annotation-based) | Proposed (Full Digitization) |
|---|---|
| Manual bounding-box placement on raster image | AI extracts all objects automatically |
| Hyperlinks overlaid on static image | Native interactive objects (click, hover, trace) |
| Text extracted via small crop OCR (unreliable) | Full-page OCR + spatial matching (already built) |
| Relationships inferred manually | Relationships auto-detected from line connectivity |
| No line tracing on drawing | Pipe paths vectorized — trace flow visually |
| Static image underneath | SVG replica — zoom infinitely, search, filter |

---

## Architecture: 6-Stage Pipeline

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│  STAGE 1    │───>│  STAGE 2     │───>│  STAGE 3     │
│  Rasterize  │    │  Symbol      │    │  Line/Pipe   │
│  & Prepare  │    │  Detection   │    │  Tracing     │
└─────────────┘    └──────────────┘    └──────────────┘
                          │                    │
                          v                    v
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│  STAGE 6    │<───│  STAGE 5     │<───│  STAGE 4     │
│  Interactive │    │  Relationship│    │  Text / Tag  │
│  SVG Output │    │  Building    │    │  Extraction   │
└─────────────┘    └──────────────┘    └──────────────┘
```

---

## STAGE 1: Rasterize & Prepare

**Goal**: Convert PDF/TIFF P&ID into a high-resolution raster image suitable for AI processing.

**Tools**:
| Tool | Type | Purpose |
|------|------|---------|
| **pdf.js / pdf-lib** | Open Source | PDF parsing, page extraction |
| **sharp** | Open Source | Image processing, resize, DPI normalization |
| **ImageMagick** | Open Source | PDF→PNG rasterization at configurable DPI |
| **OpenCV.js** | Open Source | Pre-processing: deskew, denoise, binarization |

**Process**:
1. Rasterize PDF at 300-600 DPI (configurable per drawing quality)
2. Deskew if rotated (OpenCV Hough transform)
3. Binarize (adaptive threshold) for clean line detection
4. Store both color original (for display) and binary (for CV processing)
5. Extract drawing border/title block coordinates (template matching)

**Already Built in AssetView**:
- `toDetectionRaster()` in aiAnnotate.js — PDF rasterization via ImageMagick
- Configurable DPI via `AI_ANNOTATE_PDF_DENSITY` env var (default 420)
- sharp-based image processing pipeline

---

## STAGE 2: Symbol Detection & Classification

**Goal**: Detect and classify every engineering symbol — instruments, equipment, valves, fittings, nozzles.

### 2A: Primary Detection — Visual Few-Shot (T-Rex2)

**Already built** in AssetView. User provides 1-3 example clicks, T-Rex2 finds all similar symbols.

| Tool | Type | Cost | Capability |
|------|------|------|------------|
| **T-Rex2 (DDS Cloud)** | Paid API | ~$0.01/image | Few-shot visual detection, excellent for repeated symbols |
| **GroundingDINO** | Paid API / Open Source | Free self-hosted / API | Text-prompt detection ("valve", "pump") |

**Limitation**: Requires manual examples per symbol type. Not fully automatic.

### 2B: Full Automatic Detection — Object Detection Models

For **zero-shot full-page detection** of all P&ID symbols without manual examples:

| Tool | Type | Cost | Capability |
|------|------|------|------------|
| **YOLOv8/v11** | Open Source | Free (GPU needed) | Train on P&ID symbol dataset, real-time inference |
| **YOLO-World** | Open Source | Free | Open-vocabulary detection — describe symbols in text |
| **Detectron2 (Meta)** | Open Source | Free | Instance segmentation — separate overlapping symbols |
| **Florence-2 (Microsoft)** | Open Source | Free | Vision foundation model, object detection + captioning |
| **SAM 2 (Meta)** | Open Source | Free | Segment Anything — zero-shot symbol segmentation |
| **OWLv2 (Google)** | Open Source | Free | Open-vocabulary detection, no training needed |
| **PaddleOCR + PaddleDetection** | Open Source | Free | Specialized for document/diagram analysis |

**Recommended Primary Pipeline**:
```
SAM 2 (segment all objects)
  → YOLOv8 (classify known P&ID symbol types)
  → Florence-2 (caption unknown symbols)
  → Claude Vision (verify ambiguous detections)
```

### 2C: P&ID-Specific Trained Models

| Dataset / Model | Type | Details |
|-----------------|------|---------|
| **DEXPI / ISO 15926** | Standard | International P&ID data exchange standard with symbol library |
| **P&ID-Net** (academic) | Open Source | CNN trained specifically on P&ID symbol detection |
| **DeepPID** (research) | Academic | End-to-end P&ID digitization model |
| **Custom YOLOv8 fine-tune** | Self-trained | Train on YOUR P&ID drawings (50-100 annotated samples) |

### 2D: ISA 5.1 Symbol Classification

Once detected, classify each symbol using the ISA S5.1 standard:

**Already built in AssetView** (pid-symbol-map.js):
- 60+ symbol types: valves (gate/globe/ball/check/control/butterfly/needle)
- Equipment: vessel, pump, separator, heat exchanger, tank, filter, compressor
- Instruments: field-mounted, panel-mounted, DCS, safety (SIS)
- Piping: tee, elbow, reducer, flange, spectacle blind

**Classification approach**:
```
Detected symbol crop
  → Resize to 64x64
  → CNN classifier (ResNet-18 fine-tuned on ISA symbols)
  → Output: symbol_type + confidence
  → Map to AssetView entity_type (equipment/instrument/valve)
```

---

## STAGE 3: Line & Pipe Path Tracing

**Goal**: Vectorize every pipe line, signal line, and connection path. This is the hardest stage.

### 3A: Line Detection

| Tool | Type | Cost | Capability |
|------|------|------|------------|
| **OpenCV Hough Line Transform** | Open Source | Free | Detect straight line segments |
| **OpenCV findContours** | Open Source | Free | Trace continuous paths |
| **LSD (Line Segment Detector)** | Open Source | Free | Sub-pixel accurate line detection |
| **LCNN (Line-CNN)** | Open Source | Free | Deep learning line detection |
| **DeepLSD** | Open Source | Free | Learned line segment detector |
| **Skeletonization (Zhang-Suen)** | Open Source | Free | Thin lines to 1px paths for tracing |

### 3B: Pipe Path Tracing Algorithm

```
1. Binarize image → extract line pixels
2. Remove detected symbols (mask out bounding boxes)
3. Skeletonize remaining lines to 1px paths
4. Trace connected paths using graph traversal
5. Classify line types:
   - Solid thick (2-3px) → Process pipe
   - Dashed → Signal/instrument line
   - Dotted → Utility/future pipe
   - Double line → Major header
6. Detect flow direction arrows (template matching)
7. Connect paths to detected symbols at endpoints
```

### 3C: Advanced Line Vectorization

| Tool | Type | Capability |
|------|------|------------|
| **Potrace** | Open Source | Bitmap→SVG vectorization (smooth curves) |
| **AutoTrace** | Open Source | Bitmap→vector conversion |
| **Vectorizer.AI** | Paid API | AI-powered vectorization ($0.10/image) |
| **Adobe Illustrator Image Trace** | Paid | Professional vectorization |

### 3D: Line Type Classification with AI

```
Claude Vision API prompt:
"This is a cropped section of a P&ID. Classify the line type:
 - process_pipe (solid thick line)
 - signal_line (dashed line)
 - utility_line (dotted line)
 - boundary_line (chain-dashed)
 Return the line_type and any visible line specification text."
```

---

## STAGE 4: Text & Tag Extraction

**Goal**: Extract every text element and link it to the nearest symbol/line.

### 4A: Full-Page OCR (Already Built)

**AssetView OCR Pipeline** — 4-stage process already implemented:
1. **Stage 1**: Google Vision / Claude Vision raw word extraction with vertices
2. **Stage 2a**: Word grouping (spatial adjacency) with position_pct
3. **Stage 2b**: AI classification — tag type detection (equipment/instrument/line/noise)
4. **Stage 3**: Human review & cleanup
5. **Stage 4**: Database import → `ocr_extraction` table

### 4B: Spatial Tag-to-Symbol Matching

**Already built** (this session): `lookupTagFromOcrExtractions()` matches OCR text to detection bounding boxes by proximity.

Enhanced approach for full digitization:
```
For each OCR text entry:
  1. Find nearest symbol (centroid distance)
  2. Check tag pattern against entity type:
     - PT-281010 → instrument (pressure transmitter)
     - V-28195 → equipment (vessel)
     - 8"-H-28-12-0104 → line number
  3. Assign text to symbol with confidence score
  4. Handle multi-part tags:
     - Function letters inside circle (FT, LI, PSV)
     - Tag number below circle (1001, 281010)
     - Line spec along pipe path (8"-DHS-28-31-0203)
```

### 4C: Title Block Extraction

| Field | Detection Method |
|-------|-----------------|
| Drawing number | Template zone (bottom-right corner) |
| Revision | Template zone + regex pattern |
| Date | Template zone + date regex |
| Sheet number | Template zone |
| Scale | Template zone + "SCALE" keyword proximity |
| Project name | Template zone (top) |

---

## STAGE 5: Relationship Building

**Goal**: Build the full topology graph — which equipment connects to which via which pipes.

### 5A: Connection Detection

```
For each detected pipe path:
  1. Find symbol at start endpoint → from_entity
  2. Find symbol at end endpoint → to_entity
  3. Create topology_edge:
     - from_entity_type: equipment/instrument
     - from_entity_id: matched entity UUID
     - to_entity_type: equipment/instrument
     - to_entity_id: matched entity UUID
     - edge_type: process/signal/utility
     - line_id: matched line entity
```

### 5B: Cross-Sheet Continuation

```
Detect off-page connectors (arrows at drawing edges):
  1. Find arrow symbols at page boundaries
  2. Read continuation text ("TO SHT-002", "FROM DWG-100001")
  3. Match to other P&ID in database
  4. Create pnid_line junction with is_continuation = true
  5. Build cross-drawing topology edges
```

### 5C: AI-Assisted Relationship Verification

```
Claude Vision prompt:
"Analyze this P&ID section. List all connections:
 - Which equipment/instruments are connected by pipes
 - Direction of flow (follow arrows)
 - Valve positions in each pipe run
 - Instrument tap-off points
 Return as JSON: { connections: [{ from, to, via_line, valves: [], instruments: [] }] }"
```

### 5D: Topology Storage (Already Built)

AssetView already has:
- `topology_edges` table for directed entity-to-entity graph
- Recursive CTE queries for upstream/downstream tracing
- Isolation path finding (valve-bounded segments)
- Canvas layout persistence

---

## STAGE 6: Interactive SVG Output

**Goal**: Render a pixel-perfect interactive replica of the original P&ID.

### 6A: SVG Generation

```
For each detected element:
  Equipment → <g class="equipment" data-tag="V-28195">
                <use href="#symbol-vessel" x="..." y="..." />
                <text>V-28195</text>
              </g>

  Instrument → <g class="instrument" data-tag="PT-281010">
                 <circle cx="..." cy="..." r="..." />
                 <text>PT</text>
                 <text dy="20">281010</text>
               </g>

  Pipe → <path class="pipe process" d="M... L... L..."
           data-line="8-H-28-12-0104" stroke-width="2" />

  Text → <text class="label" x="..." y="...">NOTES: ...</text>
```

### 6B: Interactive Layer (React)

```jsx
// Rendered over original raster P&ID image
<div className="pid-interactive-layer">
  {/* Original drawing as background (100% fidelity) */}
  <img src={originalPid} style={{ position: 'absolute' }} />

  {/* SVG overlay with all detected objects */}
  <svg className="interactive-overlay" style={{ position: 'absolute' }}>
    {symbols.map(s => <InteractiveSymbol key={s.id} {...s} />)}
    {pipes.map(p => <InteractivePipe key={p.id} {...p} />)}
    {tags.map(t => <InteractiveTag key={t.id} {...t} />)}
  </svg>
</div>
```

**Interaction Features**:
- **Click** any symbol → show entity detail panel (tag, specs, linked P&IDs)
- **Hover** pipe → highlight full flow path
- **Right-click** → trace upstream/downstream
- **Toggle** overlay visibility (symbols only, pipes only, text only)
- **Search** by tag → zoom to location and highlight
- **Filter** by type (show only valves, only instruments, etc.)

### 6C: Maintaining 100% Drawing Fidelity

**Critical for Oil & Gas regulatory compliance**:

```
Approach: DUAL-LAYER rendering
├── Layer 0: Original raster image (untouched, pixel-perfect)
├── Layer 1: Transparent interactive SVG overlay (invisible by default)
└── Toggle: "Engineering Mode" shows interactive objects
            "Document Mode" shows pure original drawing
```

This satisfies:
- **Regulatory**: Original drawing preserved exactly as-is
- **Engineering**: Full interactivity when needed
- **Audit**: Can always verify digital model against source drawing

---

## Complete AI Tool Matrix

### Detection & Segmentation

| Tool | Type | License | Best For | Cost |
|------|------|---------|----------|------|
| **T-Rex2** | Paid API | DDS Cloud | Few-shot symbol detection | ~$0.01/call |
| **GroundingDINO** | Open Source + API | Apache 2.0 | Text-prompt detection | Free / API |
| **YOLOv8/v11 (Ultralytics)** | Open Source | AGPL-3.0 | Trained symbol detection | Free (GPU) |
| **YOLO-World** | Open Source | GPL-3.0 | Open-vocabulary detection | Free (GPU) |
| **SAM 2 (Meta)** | Open Source | Apache 2.0 | Zero-shot segmentation | Free (GPU) |
| **Florence-2 (Microsoft)** | Open Source | MIT | Multi-task vision | Free (GPU) |
| **OWLv2 (Google)** | Open Source | Apache 2.0 | Open-vocabulary detection | Free (GPU) |
| **Detectron2 (Meta)** | Open Source | Apache 2.0 | Instance segmentation | Free (GPU) |
| **PaddleDetection** | Open Source | Apache 2.0 | Document analysis | Free (GPU) |

### OCR & Text

| Tool | Type | License | Best For | Cost |
|------|------|---------|----------|------|
| **Google Vision API** | Paid API | Cloud | High-accuracy OCR | $1.50/1K pages |
| **Claude Vision** | Paid API | Anthropic | Context-aware text extraction | $3-15/M tokens |
| **Tesseract 5** | Open Source | Apache 2.0 | Free OCR baseline | Free |
| **PaddleOCR** | Open Source | Apache 2.0 | Multi-language OCR | Free |
| **EasyOCR** | Open Source | Apache 2.0 | Simple integration | Free |
| **DocTR** | Open Source | Apache 2.0 | Document OCR | Free |
| **TrOCR (Microsoft)** | Open Source | MIT | Transformer-based OCR | Free |
| **Surya OCR** | Open Source | GPL-3.0 | Layout-aware OCR | Free |

### Line Detection & Vectorization

| Tool | Type | License | Best For | Cost |
|------|------|---------|----------|------|
| **OpenCV** | Open Source | Apache 2.0 | Hough lines, contours, skeleton | Free |
| **Potrace** | Open Source | GPL-2.0 | Bitmap→SVG vectorization | Free |
| **DeepLSD** | Open Source | Apache 2.0 | Deep learning line detection | Free (GPU) |
| **Vectorizer.AI** | Paid API | Commercial | AI vectorization | $0.10/image |
| **scikit-image** | Open Source | BSD | Skeletonization, morphology | Free |

### AI Reasoning & Verification

| Tool | Type | License | Best For | Cost |
|------|------|---------|----------|------|
| **Claude Opus 4** | Paid API | Anthropic | Complex reasoning, verification | $15/$75 per M tokens |
| **Claude Sonnet 4** | Paid API | Anthropic | Fast classification, captioning | $3/$15 per M tokens |
| **GPT-4o** | Paid API | OpenAI | Vision analysis | $2.50/$10 per M tokens |
| **Gemini 2.5 Pro** | Paid API | Google | Long-context document analysis | $1.25/$10 per M tokens |
| **Llama 3.2 Vision** | Open Source | Meta | Self-hosted vision analysis | Free (GPU) |
| **Qwen2.5-VL** | Open Source | Apache 2.0 | Self-hosted vision analysis | Free (GPU) |

---

## Recommended Implementation Pipeline

### Phase 1: Foundation (Weeks 1-2)
```
1. High-res rasterization (already built)
2. Full-page OCR with spatial coordinates (already built)
3. AI text classification (already built)
4. Symbol detection via T-Rex2 + SAM 2
```

### Phase 2: Symbol Intelligence (Weeks 3-4)
```
5. Fine-tune YOLOv8 on P&ID symbols (50-100 training images)
6. ISA S5.1 symbol classifier (ResNet-18 fine-tune)
7. Auto-match symbols to OCR tags by proximity
8. Equipment/instrument entity creation from detections
```

### Phase 3: Line Tracing (Weeks 5-6)
```
9. OpenCV line detection + skeletonization
10. Pipe path tracing (graph-based)
11. Line type classification (solid/dashed/dotted)
12. Connect pipes to symbols at endpoints
13. Build topology_edges automatically
```

### Phase 4: Interactive SVG (Weeks 7-8)
```
14. Generate SVG overlay from all detected objects
15. Dual-layer renderer (original + interactive)
16. Click/hover/search interactions
17. Flow tracing on drawing
18. Cross-sheet continuation detection
```

### Phase 5: AI Verification & Polish (Weeks 9-10)
```
19. Claude Vision verification pass (check all detections)
20. Human review UI for corrections
21. Feedback loop — corrections improve future detection
22. Export to DEXPI/ISO 15926 format
```

---

## Cost Estimate (per P&ID drawing)

| Stage | Tool | Cost/Drawing |
|-------|------|-------------|
| Rasterization | ImageMagick (local) | $0.00 |
| Symbol Detection | T-Rex2 + SAM 2 | $0.02-0.05 |
| OCR | Google Vision | $0.0015 |
| AI Classification | Claude Sonnet | $0.01-0.03 |
| Line Detection | OpenCV (local) | $0.00 |
| Verification | Claude Vision | $0.05-0.10 |
| **TOTAL** | | **$0.08-0.18/drawing** |

At 24 P&IDs in the current dataset: **~$2-5 total**.
At 1000 P&IDs (typical platform): **~$80-180 total**.

---

## Integration with Existing AssetView

**What's already built and reusable**:
- Database model (equipment, instrument, line, topology_edges) ✅
- OCR pipeline (4 stages, Google Vision + Claude) ✅
- T-Rex2 detection (DDS Cloud API) ✅
- Canvas/topology viewer (React Flow) ✅
- Annotation system (position_pct, shapes, entity linking) ✅
- Tag dictionary & pattern matching ✅
- ISA S5.1 symbol library ✅

**What needs to be built**:
- Line vectorization (OpenCV pipeline) — NEW
- SVG overlay generator — NEW
- Dual-layer renderer (original + interactive) — NEW
- Auto-topology builder (pipe→symbol connection) — NEW
- Symbol classifier (YOLOv8 fine-tune) — NEW
- Cross-sheet continuation detector — NEW

---

## Summary

The approach is:

> **Keep the original drawing as-is** (100% regulatory compliance) +
> **Build a transparent interactive layer on top** (full digital twin) =
> **Best of both worlds**

Every symbol becomes clickable. Every pipe becomes traceable. Every tag becomes searchable. But the drawing looks identical to the paper original.
