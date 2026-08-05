# AI-Native P&ID Annotation — Research & Strategy

## The Paradigm Shift

### Old Way (Pre-AI / Current AssetView)
```
Upload P&ID PDF
  → OCR all text (Google Vision / PaddleOCR)
  → AI classifies extracted text into types (equipment/instrument/line)
  → Fuzzy match against tag database
  → Human reviews 100+ OCR results one-by-one
  → Human cleans up misreads, false positives
  → Create annotations with bounding boxes
  → Approve individually or in bulk
```
**Problems:** Slow, tedious, error-prone, requires human review of every single extraction. The OCR step treats the P&ID as a "text document" — it ignores visual structure, symbol shapes, line connectivity.

### New Way (AI-Native / Visual Prompting)
```
User opens P&ID in workspace
  → Annotates 3-5 example tags (draw rectangle around "P-101", "P-102", "V-205")
  → AI sees the visual pattern: "rectangles with text, near process lines, green-bordered"
  → AI finds ALL similar tags on the drawing automatically
  → Returns complete list: { tag: "P-103", bbox: {x, y, w, h}, confidence: 0.94 }
  → User reviews AI results (accept/reject/adjust), not raw OCR
  → Accepted results become annotations + entity records in one step
```
**Advantages:** 10x faster, learns your specific drawing style, handles non-standard symbology, works on poor-quality scans, no OCR cleanup step.

---

## Available Models & Technologies (2024-2025)

### Tier 1: Best Fit for P&ID Few-Shot Annotation

#### 1. T-Rex2 — Visual Prompt Detection (IDEA Research)
**What it does:** You **point to** or **draw a box around** an example object → T-Rex2 finds ALL similar objects in the image.

**Why it's perfect for P&IDs:**
- Click on a pump → finds all pumps
- Draw box around a tag label → finds all tag labels with similar visual pattern
- Supports multiple visual prompts: point to a valve AND a pump → finds all of both
- Combines text + visual prompting: "valve" + [box around example] → higher accuracy

**How the workflow would look:**
```
1. User loads P&ID image
2. User draws box around "P-101" tag label on the drawing
3. User draws box around "TI-301" instrument bubble
4. T-Rex2 API call: { image, visual_prompts: [box1, box2] }
5. Returns: 47 detections with bounding boxes + confidence scores
6. System runs OCR on each detected region to read the tag number
7. User sees: "Found 47 tags. Review?" with overlay on drawing
8. User accepts/adjusts → annotations created in AssetView
```

**Availability:**
- API: `api.deepdataspace.com` (IDEA Research cloud)
- GitHub: `IDEA-Research/T-Rex`
- Can be self-hosted (with GPU server)
- Paper: "T-Rex2: Towards Generic Object Detection via Text-Visual Prompt Synergy"

#### 2. Grounding DINO + SAM 2 (GroundedSAM 2)
**What it does:** Text-prompted detection + precise segmentation.

**Pipeline:**
```
Input: P&ID image + text prompt "valve symbol, pump, instrument circle, tag label"
  → Grounding DINO finds bounding boxes for each prompt
  → SAM 2 creates precise segmentation masks within each box
  → Output: labeled regions with pixel-perfect boundaries
```

**Why it's good for P&IDs:**
- Zero-shot: no training data needed, just text descriptions
- Good at finding geometric shapes ("circle", "rectangle", "diamond")
- SAM 2 gives precise boundaries even for overlapping elements
- Fully open-source and self-hostable

**Availability:**
- GitHub: `IDEA-Research/Grounded-SAM-2` (Apache 2.0)
- Self-hosted: single GPU (RTX 3090 or better)
- Grounding DINO: `IDEA-Research/GroundingDINO`
- SAM 2: `facebookresearch/sam2` (Apache 2.0)

#### 3. Florence-2 (Microsoft) — Unified Vision Foundation
**What it does:** Single model that handles detection, OCR, captioning, and grounding.

**Why it matters for P&IDs:**
- **Built-in OCR** — reads tag numbers directly (no separate OCR step)
- **Object detection** — finds symbols by description
- **Dense region captioning** — describes what's in each area
- Fine-tunable on your specific P&ID style with small datasets (~100-200 images)
- MIT license, self-hostable, runs on consumer GPU

**The fine-tuning approach:**
```
1. Annotate 10-15 P&IDs manually (or semi-automatically with GroundedSAM)
2. Fine-tune Florence-2-large on your symbol set
3. Result: model that detects YOUR specific P&ID symbology + reads tags
4. Deploy as API endpoint in your backend
```

**Availability:**
- HuggingFace: `microsoft/Florence-2-large` (MIT license)
- Fine-tuning guides available on HuggingFace
- ~770M parameters (large), runs on RTX 3090

### Tier 2: Supporting Technologies

#### 4. SAM 2 (Meta) — Segment Anything Model 2
- **Role:** Precise segmentation after detection
- Not a detector itself — needs bounding box prompts from another model
- Excellent at segmenting symbols with clear boundaries on clean P&IDs
- Interactive: point-click → segment
- GitHub: `facebookresearch/sam2` (Apache 2.0)

#### 5. Vision Language Models (Claude, GPT-4o, Gemini)
- **Role:** Classification, validation, reasoning — NOT primary detection
- **What they're good at:** "Is this a gate valve or a globe valve?" "What does this P&ID symbol represent?" "Read the tag number in this cropped region"
- **What they're bad at:** Precise bounding box coordinates (off by 20-50+ pixels)
- **Best use:** Post-detection classifier and validator
- **Set-of-Mark (SoM) prompting:** Overlay numbered markers on detected regions → ask VLM to classify each one

#### 6. YOLOv8/v10 Fine-Tuned on P&ID Symbols
- **Role:** Production-grade real-time detection
- Requires training data (500+ annotated P&IDs ideal, 50-100 minimum)
- Extremely fast inference (<50ms per image)
- Multiple P&ID symbol datasets on Roboflow Universe
- Best for production deployment after initial annotation with few-shot models
- GitHub: `ultralytics/ultralytics`

### Tier 3: Emerging / Research

#### 7. SegGPT / Painter (Visual In-Context Learning)
- Paint a mask on one example → model segments all similar objects
- Academic; not production-ready
- Conceptually ideal for P&ID annotation

#### 8. OWL-ViT / OWLv2 (Google) — Open-Vocabulary Detection
- Text-prompted like Grounding DINO, but from Google
- Available on HuggingFace
- Less accurate than Grounding DINO on technical drawings

#### 9. Roboflow Autodistill
- Auto-labeling pipeline: foundation model annotates → you fine-tune a faster model
- Uses GroundedSAM, DINO, or Claude as teacher
- Great for bootstrapping training data
- GitHub: `roboflow/autodistill`

---

## Recommended Architecture for AssetView

### The "Teach by Example" Pipeline

```
┌────────────────────────────────────────────────────────────────────┐
│                    USER WORKFLOW                                    │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1. User opens P&ID in AnnotationWorkspace                        │
│  2. Clicks "AI Annotate" mode                                     │
│  3. Draws 3-5 example annotations:                                │
│     - Rectangle around "P-101" → labels it "equipment"            │
│     - Circle around "TI-301" → labels it "instrument"             │
│     - Rectangle around "8-HC-001" → labels it "line"              │
│  4. Clicks "Find Similar" button                                  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    AI PIPELINE                                │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │                                                              │  │
│  │  Step 1: T-Rex2 / GroundedSAM Detection                    │  │
│  │  ─────────────────────────────────────────                  │  │
│  │  Input: Full P&ID image + user's example boxes              │  │
│  │  Output: 50-200 candidate detections with bboxes            │  │
│  │                                                              │  │
│  │  Step 2: Region OCR (Florence-2 or PaddleOCR)              │  │
│  │  ──────────────────────────────────────────                 │  │
│  │  For each detection, crop region + OCR to read tag text     │  │
│  │  Output: { bbox, text: "P-103", type: "equipment" }        │  │
│  │                                                              │  │
│  │  Step 3: VLM Classification (Claude API)                    │  │
│  │  ─────────────────────────────────                          │  │
│  │  Send grid of cropped detections to Claude:                 │  │
│  │  "Classify each: equipment/instrument/line/noise/unknown"   │  │
│  │  Filter out false positives (title block text, notes, etc.) │  │
│  │                                                              │  │
│  │  Step 4: Database Matching                                  │  │
│  │  ────────────────────                                       │  │
│  │  Fuzzy match OCR text against equipment/instrument/line     │  │
│  │  tables. Flag new tags not in database.                     │  │
│  │                                                              │  │
│  │  Step 5: Return Results                                     │  │
│  │  ──────────────                                             │  │
│  │  { detections: [                                            │  │
│  │    { tag: "P-103", type: "equipment", confidence: 0.94,     │  │
│  │      bbox: { x_pct: 35.2, y_pct: 42.1, w_pct: 4.5, ... }, │  │
│  │      matched_entity_id: "uuid-...",                         │  │
│  │      is_new: false },                                       │  │
│  │    { tag: "XV-109", type: "instrument", confidence: 0.87,   │  │
│  │      bbox: { ... }, matched_entity_id: null,                │  │
│  │      is_new: true },                                        │  │
│  │    ...                                                      │  │
│  │  ]}                                                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  5. User sees overlay: 47 found, 3 new tags, 2 uncertain          │
│  6. User reviews (accept/reject/adjust) — much faster than OCR    │
│  7. Accepted results → annotations + junction table entries        │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Implementation Options (by complexity)

#### Option A: Cloud API Pipeline (Fastest to implement)
```
Frontend → Backend API → T-Rex2 API (deepdataspace.com) → OCR → Claude API → Response
```
- **Pros:** No GPU needed, fastest to build, production-quality models
- **Cons:** Latency (5-15s per P&ID), API costs, data leaves your network
- **Cost:** ~$0.10-0.50 per P&ID (T-Rex2 API + Claude API)
- **Implementation time:** 2-3 weeks

#### Option B: Self-Hosted GroundedSAM + Florence-2 (Best balance)
```
Frontend → Backend API → GPU Server (GroundedSAM + Florence-2) → Claude API (classify) → Response
```
- **Pros:** Data stays in-house, lower per-image cost, customizable
- **Cons:** Needs GPU server (RTX 3090 or T4), more setup
- **Cost:** GPU server ($200-500/mo) + Claude API for classification
- **Implementation time:** 4-6 weeks

#### Option C: Fine-Tuned YOLOv8 (Production grade)
```
Step 1: Bootstrap training data with Option A or B
Step 2: Fine-tune YOLOv8 on your P&ID symbol set
Step 3: Deploy fast inference model
```
- **Pros:** Fastest inference (<50ms), most accurate after fine-tuning, runs on CPU
- **Cons:** Needs training data (bootstrap with few-shot first), more engineering
- **Cost:** One-time training + cheap inference
- **Implementation time:** 6-10 weeks (including data collection)

---

## Comparison: Old Pipeline vs AI-Native

| Aspect | Current (OCR-First) | AI-Native (Few-Shot) |
|--------|---------------------|---------------------|
| **User effort per P&ID** | Review 100+ OCR results | Annotate 3-5 examples, review 50 results |
| **Time per P&ID** | 30-60 minutes | 5-10 minutes |
| **Handles non-standard symbols** | No (OCR reads text only) | Yes (visual pattern matching) |
| **Works on poor scans** | Poorly (OCR fails) | Better (visual models more robust) |
| **Line connectivity extraction** | No | Possible with graph extraction |
| **Learning over time** | No | Yes (fine-tune on approved results) |
| **Cold start** | Works immediately (just OCR) | Needs 3-5 examples per type |
| **Setup complexity** | Low (OCR API) | Medium-High (GPU, model hosting) |
| **New tag discovery** | Good (OCR reads everything) | Good (detection + OCR on regions) |

---

## Key P&ID AI Papers & Projects (2023-2025)

1. **"Symbol Detection in P&IDs Using YOLOv5"** — Common approach, datasets on Roboflow
2. **"Automated P&ID Digitization using Graph Neural Networks"** — Extracts connectivity
3. **"T-Rex2: Towards Generic Object Detection via Text-Visual Prompt Synergy"** — IDEA Research 2024
4. **"Segment Anything Model 2"** — Meta 2024, interactive segmentation
5. **"Florence-2: Advancing a Unified Representation for Vision Tasks"** — Microsoft 2024
6. **"Grounding DINO: Marrying DINO with Grounded Pre-Training"** — IDEA Research 2023
7. **"Set-of-Mark Visual Prompting for GPT-4V"** — Microsoft 2023
8. **"GroundedSAM: Grounding DINO + Segment Anything"** — Pipeline combining detection + segmentation

---

## Commercial P&ID AI Tools (for reference)

| Tool | Company | Approach | Availability |
|------|---------|----------|-------------|
| **Cognite Data Fusion** | Cognite | ML extraction + rules | Enterprise SaaS |
| **AVEVA Diagrams** | Schneider Electric | AI-assisted digitization | Enterprise license |
| **Intelligent Plant** | Intelligent Plant | AI + human review | Service-based |
| **Videa (by Yokogawa)** | Yokogawa | Deep learning P&ID parsing | Enterprise |
| **Roboflow** (DIY) | Roboflow | Platform for custom models | Free tier available |

---

## What This Means for AssetView

The recommended path forward:

### Phase 1: Keep existing OCR pipeline but add AI annotation mode
- Add "AI Annotate" button to AnnotationWorkspace
- Integrate T-Rex2 API (cloud, fastest to ship)
- User draws 3-5 examples → T-Rex2 finds similar → OCR reads tags → Claude classifies
- Results appear as "AI suggestions" overlay (reuse existing KonvaOcrGhosts pattern)
- User reviews and accepts → creates annotations + entities

### Phase 2: Fine-tune Florence-2 on your P&ID style
- Collect approved annotations from Phase 1 as training data
- Fine-tune Florence-2 for combined detection + OCR
- Self-host for faster inference and lower cost
- Replace T-Rex2 API calls with Florence-2 inference

### Phase 3: Self-improving loop
- Every accepted annotation becomes training data
- Periodically re-fine-tune model on accumulated data
- Accuracy improves over time as more P&IDs are processed
- Eventually: single-click "Auto-annotate entire P&ID"

---

## AssetView Backend Integration Design

### New API Endpoints

```
POST /api/v1/ai/annotate
Body: {
  pnidId: "uuid",
  examples: [
    { bbox: { x_pct, y_pct, w_pct, h_pct }, label: "equipment", tag: "P-101" },
    { bbox: { x_pct, y_pct, w_pct, h_pct }, label: "instrument", tag: "TI-301" },
    ...
  ],
  mode: "few_shot" | "full_auto"
}
Response: {
  detections: [
    {
      bbox: { x_pct, y_pct, w_pct, h_pct },
      tag_text: "P-103",
      entity_type: "equipment",
      confidence: 0.94,
      matched_entity_id: "uuid" | null,
      is_new_tag: false,
      detection_source: "t-rex2" | "grounded-sam" | "florence-2"
    },
    ...
  ],
  stats: { total: 47, equipment: 18, instruments: 15, lines: 12, uncertain: 2 }
}

POST /api/v1/ai/annotate/accept
Body: {
  pnidId: "uuid",
  accepted: [
    { detection_index: 0, adjusted_bbox: { ... } | null },  // null = accept as-is
    { detection_index: 2, rejected: true },
    ...
  ]
}
→ Creates annotations + junction table entries + entities for new tags

GET /api/v1/ai/models
→ Returns available AI models and their status (t-rex2 API, florence-2 local, etc.)
```

### Frontend Additions

```
frontend/src/components/annotations/
├── AIAnnotateMode.jsx         # "Teach by example" UI
│   ├── ExampleDrawer           # User draws example boxes, labels them
│   ├── FindSimilarButton       # Triggers AI pipeline
│   ├── DetectionReviewOverlay  # Shows AI results on canvas
│   └── AcceptRejectControls    # Batch accept/reject/adjust
├── AIConfidenceSlider.jsx     # Filter detections by confidence threshold
└── AIModelSelector.jsx        # Choose which AI backend to use
```

---

## Summary

**You're right — the old OCR-first approach is pre-AI era thinking.** The AI-native approach of "show a few examples, AI finds the rest" is now technically feasible with models like T-Rex2, GroundedSAM, and Florence-2. The key insight:

> **Don't treat a P&ID as a text document (OCR). Treat it as a visual scene (object detection).**

The recommended first step for AssetView: integrate the T-Rex2 API as an "AI Annotate" mode alongside the existing OCR pipeline. Users who want quick, AI-assisted annotation use the new mode. The old OCR pipeline remains available for text-heavy extraction tasks.

