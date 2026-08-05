# OCR P&ID Tag Extraction & Auto-Annotation Plan

## Overview

Build a pipeline that:
1. Runs OCR on P&ID drawings stored in GCP
2. Extracts equipment tags, line tags, and instrument tags with bounding box coordinates
3. Compares OCR results against the existing database (equipment, line, instrument tables)
4. Auto-populates annotation coordinates in `pnid_equipment`, `pnid_instrument`, `pnid_line` junction tables
5. Presents an approval screen so engineers can verify/correct the automated linking before it goes live

**Key principle**: The same P&ID file is used for both canvas display AND OCR extraction — no duplicate uploads.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        P&ID Upload Flow                             │
│                                                                      │
│  ┌─────────┐    ┌──────────┐    ┌──────────────┐    ┌────────────┐  │
│  │  Upload  │───>│   GCS    │───>│  OCR Service │───>│  Tag Match │  │
│  │  Module  │    │  Bucket  │    │ (Vision API) │    │   Engine   │  │
│  └─────────┘    └──────────┘    └──────────────┘    └─────┬──────┘  │
│                                                           │          │
│                                         ┌─────────────────┘          │
│                                         ▼                            │
│  ┌─────────────────┐    ┌──────────────────────────┐                │
│  │  Approval UI     │<───│  ocr_extraction Table    │                │
│  │  (Review Screen) │    │  (staging area)          │                │
│  └────────┬────────┘    └──────────────────────────┘                │
│           │                                                          │
│           ▼ (on approve)                                            │
│  ┌──────────────────────────────────────┐                           │
│  │  pnid_equipment / pnid_instrument   │                           │
│  │  pnid_line (annotation coordinates) │                           │
│  └──────────────────────────────────────┘                           │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────┐                                               │
│  │  P&ID Canvas      │  ← Tags auto-appear as overlay hotspots     │
│  │  (OverlayLayer)   │                                               │
│  └──────────────────┘                                               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Recommended OCR Engine: Google Cloud Vision API

### Why Vision API?

| Criteria | Vision API | Document AI | Tesseract | Azure Doc Intel |
|----------|-----------|-------------|-----------|-----------------|
| P&ID text accuracy | Good | Good (custom) | Fair (needs preprocessing) | Good |
| Bounding boxes | Yes (pixel + normalized) | Yes | Yes (rect only) | Yes |
| Node.js SDK | `@google-cloud/vision` | `@google-cloud/documentai` | N/A (Python) | `@azure/ai-form-recognizer` |
| Setup complexity | Low (1 API call) | Medium (create processor) | High (CRAFT + rotation) | Medium |
| Cost | $1.50/1000 images | $10-65/1000 pages | Free | $1/1000 pages |
| Already in GCP | Yes (same auth) | Yes (same auth) | N/A | Separate cloud |
| PDF support | Yes (async batch) | Yes (native) | No (convert first) | Yes |

**Decision**: Use `DOCUMENT_TEXT_DETECTION` from Cloud Vision. It returns word-level bounding boxes with confidence scores. Same GCP credentials already configured in the app for GCS storage.

### Bounding Box Format

Vision API returns per-word:
```json
{
  "text": "V-1001",
  "confidence": 0.98,
  "boundingBox": {
    "vertices": [
      {"x": 1245, "y": 892},   // top-left
      {"x": 1312, "y": 892},   // top-right
      {"x": 1312, "y": 918},   // bottom-right
      {"x": 1245, "y": 918}    // bottom-left
    ]
  }
}
```

We normalize to percentages (0-100) to match the existing `annotation_x_pct`, `annotation_y_pct`, `annotation_w_pct`, `annotation_h_pct` columns:

```javascript
function verticesToPct(vertices, imageWidth, imageHeight) {
  const xs = vertices.map(v => v.x || 0);
  const ys = vertices.map(v => v.y || 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x_pct: (minX / imageWidth) * 100,
    y_pct: (minY / imageHeight) * 100,
    w_pct: ((maxX - minX) / imageWidth) * 100,
    h_pct: ((maxY - minY) / imageHeight) * 100,
  };
}
```

---

## Tag Classification (Regex Patterns)

Oil & gas P&ID tags follow standard patterns:

```javascript
// Equipment: V-1001, P-1001A, E-1001, TK-101, C-1001, HE-2001
const EQUIPMENT_PREFIXES = new Set([
  'V', 'P', 'E', 'C', 'TK', 'AG', 'HE', 'R', 'D', 'F', 'K', 'T', 'S', 'B', 'H'
]);
const EQUIPMENT_REGEX = /^([A-Z]{1,3})-(\d{1,5}[A-Z]?)$/;

// Instruments (ISA S5.1): PT-1001, FIC-101, PSV-1001A, LT-2001
const ISA_FIRST_LETTERS = new Set(['F','L','P','T','A','S','H','Z','I','D','W','M','N','O','R','U','X','Y']);
const INSTRUMENT_REGEX = /^([A-Z]{2,5})-(\d{3,5}[A-Z]?)$/;

// Lines: 6"-PG-1001-A1A, 2"-FW-A-001, 8"-CS150-NA-1001
const LINE_REGEX = /^\d{1,2}"?-[A-Z]{1,4}\d{0,3}-[A-Z0-9-]+$/;

function classifyTag(text) {
  text = text.trim().toUpperCase();
  if (LINE_REGEX.test(text)) return 'line';
  const match = text.match(/^([A-Z]+)-(\d+[A-Z]?)$/);
  if (!match) return null;
  const prefix = match[1];
  if (EQUIPMENT_PREFIXES.has(prefix)) return 'equipment';
  if (prefix.length >= 2 && ISA_FIRST_LETTERS.has(prefix[0])) return 'instrument';
  return 'unknown';
}
```

### Word Reassembly

OCR often splits tags across multiple words (e.g., "V" + "-" + "1001"). The pipeline must:
1. Extract all words with bounding boxes
2. Group spatially adjacent words on the same horizontal line (y-overlap > 60%, x-gap < 15px)
3. Concatenate grouped words and re-test against tag patterns
4. Use the merged bounding box (union of all constituent word boxes)

---

## Database Changes

### New Table: `ocr_extraction`

Staging area for OCR results before approval:

```sql
CREATE TABLE ocr_extraction (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_id         UUID NOT NULL REFERENCES pnid(id),
    pnid_version_id UUID REFERENCES pnid_version(id),

    -- OCR result
    extracted_text   VARCHAR(200) NOT NULL,
    tag_type         VARCHAR(20) NOT NULL,  -- 'equipment', 'instrument', 'line', 'unknown'
    confidence       DECIMAL(4,3),          -- OCR confidence 0-1

    -- Bounding box (percentage of image dimensions, matches existing convention)
    bbox_x_pct       DECIMAL(5,2) NOT NULL,
    bbox_y_pct       DECIMAL(5,2) NOT NULL,
    bbox_w_pct       DECIMAL(5,2) NOT NULL,
    bbox_h_pct       DECIMAL(5,2) NOT NULL,

    -- Pixel coordinates (raw, for reference)
    bbox_x_px        INTEGER,
    bbox_y_px        INTEGER,
    bbox_w_px        INTEGER,
    bbox_h_px        INTEGER,

    -- Matching
    matched_entity_id UUID,                 -- FK to equipment/instrument/line
    match_confidence  DECIMAL(4,3),          -- fuzzy match score
    match_method      VARCHAR(50),           -- 'exact', 'fuzzy', 'manual'

    -- Approval
    status           VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'approved', 'rejected', 'modified'
    reviewed_by      VARCHAR(100),
    reviewed_at      TIMESTAMPTZ,

    -- Image dimensions used for normalization
    image_width_px   INTEGER,
    image_height_px  INTEGER,

    created_at       TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_tag_type CHECK (tag_type IN ('equipment', 'instrument', 'line', 'unknown')),
    CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'rejected', 'modified'))
);

CREATE INDEX idx_ocr_extraction_pnid ON ocr_extraction(pnid_id);
CREATE INDEX idx_ocr_extraction_status ON ocr_extraction(status);
CREATE INDEX idx_ocr_extraction_tag_type ON ocr_extraction(tag_type);

-- Track OCR job runs
CREATE TABLE ocr_job (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pnid_id         UUID NOT NULL REFERENCES pnid(id),
    pnid_version_id UUID REFERENCES pnid_version(id),
    status          VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'

    -- Stats
    total_words      INTEGER,
    tags_found       INTEGER,
    tags_matched     INTEGER,

    -- Timing
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    error_message    TEXT,

    created_at       TIMESTAMPTZ DEFAULT NOW(),
    created_by       VARCHAR(100)
);
```

---

## Backend Implementation

### New Files

```
backend/src/services/ocr/
├── VisionOCRProvider.js      # Google Cloud Vision API wrapper
├── TagClassifier.js          # Regex-based tag classification
├── TagMatcher.js             # Fuzzy matching against DB entities
├── WordGrouper.js            # Spatial word grouping/reassembly
└── OcrPipeline.js            # Orchestrates the full pipeline

backend/src/routes/
└── ocr.js                    # API endpoints for OCR operations
```

### 1. `VisionOCRProvider.js` — OCR Engine

```javascript
import vision from '@google-cloud/vision';

export default class VisionOCRProvider {
  constructor(credentials) {
    const opts = {};
    if (credentials) {
      opts.credentials = typeof credentials === 'string'
        ? JSON.parse(credentials) : credentials;
    }
    this.client = new vision.ImageAnnotatorClient(opts);
  }

  // For images (PNG, JPG, TIFF)
  async extractFromImage(imageBuffer) {
    const [result] = await this.client.documentTextDetection({
      image: { content: imageBuffer.toString('base64') }
    });
    return this._parseResponse(result);
  }

  // For PDFs (async batch via GCS)
  async extractFromPdf(gcsUri) {
    const [operation] = await this.client.asyncBatchAnnotateFiles({
      requests: [{
        inputConfig: { gcsSource: { uri: gcsUri }, mimeType: 'application/pdf' },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        outputConfig: { gcsDestination: { uri: `${gcsUri}_ocr_output/` }, batchSize: 1 }
      }]
    });
    const [result] = await operation.promise();
    // Parse output JSON from GCS
    return this._parseBatchResponse(result);
  }

  _parseResponse(result) {
    const annotation = result.fullTextAnnotation;
    if (!annotation) return { words: [], fullText: '' };

    const words = [];
    for (const page of annotation.pages) {
      const pageWidth = page.width;
      const pageHeight = page.height;

      for (const block of page.blocks) {
        for (const paragraph of block.paragraphs) {
          for (const word of paragraph.words) {
            const text = word.symbols.map(s => s.text).join('');
            const vertices = word.boundingBox.vertices;
            words.push({
              text,
              confidence: word.confidence,
              vertices,
              pageWidth,
              pageHeight,
            });
          }
        }
      }
    }
    return { words, fullText: annotation.text };
  }
}
```

### 2. `WordGrouper.js` — Spatial Word Reassembly

```javascript
export function groupAdjacentWords(words, maxGapPx = 15, yOverlapThreshold = 0.6) {
  // Sort by y then x
  const sorted = [...words].sort((a, b) => {
    const aY = Math.min(...a.vertices.map(v => v.y || 0));
    const bY = Math.min(...b.vertices.map(v => v.y || 0));
    if (Math.abs(aY - bY) > 10) return aY - bY;
    const aX = Math.min(...a.vertices.map(v => v.x || 0));
    const bX = Math.min(...b.vertices.map(v => v.x || 0));
    return aX - bX;
  });

  const groups = [];
  const used = new Set();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const group = [sorted[i]];
    used.add(i);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const last = group[group.length - 1];
      if (areAdjacent(last, sorted[j], maxGapPx, yOverlapThreshold)) {
        group.push(sorted[j]);
        used.add(j);
      }
    }

    const mergedText = group.map(w => w.text).join('');
    const mergedBox = mergeVertices(group.map(w => w.vertices));
    const avgConfidence = group.reduce((s, w) => s + w.confidence, 0) / group.length;

    groups.push({
      text: mergedText,
      confidence: avgConfidence,
      vertices: mergedBox,
      pageWidth: group[0].pageWidth,
      pageHeight: group[0].pageHeight,
      wordCount: group.length,
    });
  }
  return groups;
}
```

### 3. `TagMatcher.js` — Database Matching

```javascript
export async function matchTagsToEntities(prisma, pnidId, classifiedTags) {
  // Get all equipment, instruments, and lines that could appear on this P&ID
  // via the system → pnid_system relationship
  const systems = await prisma.$queryRaw`
    SELECT s.id FROM system s
    JOIN pnid_system ps ON ps.system_id = s.id
    WHERE ps.pnid_id = ${pnidId}::uuid
  `;
  const systemIds = systems.map(s => s.id);

  const equipment = await prisma.equipment.findMany({
    where: { system_id: { in: systemIds }, deleted_at: null }
  });
  const instruments = await prisma.instrument.findMany({
    where: { system_id: { in: systemIds }, deleted_at: null }
  });
  const lines = await prisma.line.findMany({
    where: { system_id: { in: systemIds }, deleted_at: null }
  });

  // Also include cross-referenced entities (from other systems visible on this P&ID)
  // ...existing junction table data

  return classifiedTags.map(tag => {
    let match = null;
    let matchConfidence = 0;

    if (tag.type === 'equipment') {
      match = equipment.find(e => e.tag === tag.text);
      if (!match) match = fuzzyMatch(tag.text, equipment, 'tag');
    } else if (tag.type === 'instrument') {
      match = instruments.find(i => i.tag === tag.text);
      if (!match) match = fuzzyMatch(tag.text, instruments, 'tag');
    } else if (tag.type === 'line') {
      match = lines.find(l => l.line_number === tag.text);
      if (!match) match = fuzzyMatch(tag.text, lines, 'line_number');
    }

    return {
      ...tag,
      matchedEntityId: match?.entity?.id || null,
      matchConfidence: match?.score || 0,
      matchMethod: match?.method || null,
    };
  });
}
```

### 4. `OcrPipeline.js` — Orchestrator

```javascript
export async function runOcrPipeline(prisma, pnidId, storageProvider) {
  // 1. Create job record
  const job = await createJob(prisma, pnidId);

  // 2. Fetch P&ID image from storage
  const pnid = await prisma.pnid.findUnique({ where: { id: pnidId } });
  const imageBuffer = await storageProvider.download(pnid.storage_key);

  // 3. Run OCR
  const ocrProvider = new VisionOCRProvider(storageProvider.config.credentials_json);
  const ocrResult = await ocrProvider.extractFromImage(imageBuffer);

  // 4. Group adjacent words
  const grouped = groupAdjacentWords(ocrResult.words);

  // 5. Classify tags
  const classified = grouped
    .map(g => ({ ...g, type: classifyTag(g.text) }))
    .filter(g => g.type !== null);

  // 6. Match against database
  const matched = await matchTagsToEntities(prisma, pnidId, classified);

  // 7. Store in ocr_extraction staging table
  for (const tag of matched) {
    const pct = verticesToPct(tag.vertices, tag.pageWidth, tag.pageHeight);
    await prisma.$queryRaw`
      INSERT INTO ocr_extraction (
        pnid_id, pnid_version_id, extracted_text, tag_type, confidence,
        bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct,
        bbox_x_px, bbox_y_px, bbox_w_px, bbox_h_px,
        matched_entity_id, match_confidence, match_method,
        image_width_px, image_height_px
      ) VALUES (...)
    `;
  }

  // 8. Update job
  await updateJob(prisma, job.id, 'completed', {
    totalWords: ocrResult.words.length,
    tagsFound: classified.length,
    tagsMatched: matched.filter(m => m.matchedEntityId).length,
  });

  return job.id;
}
```

### 5. API Endpoints (`routes/ocr.js`)

```
POST /api/v1/ocr/extract/:pnidId
  → Triggers OCR pipeline for a P&ID
  → Returns job ID for polling

GET  /api/v1/ocr/jobs/:jobId
  → Returns job status and stats

GET  /api/v1/ocr/results/:pnidId
  → Returns all OCR extractions for a P&ID
  → Filterable by: tag_type, status, match_confidence threshold

POST /api/v1/ocr/results/:pnidId/approve
  → Body: { extractionIds: [...], action: 'approve' | 'reject' }
  → On approve: copies bbox coordinates to pnid_equipment/pnid_instrument/pnid_line
  → Creates junction table entries if they don't exist
  → Sets position_verified = true

PATCH /api/v1/ocr/results/:extractionId
  → Modify a single extraction (reassign entity, adjust bbox, change type)
  → For manual corrections before approval

POST /api/v1/ocr/results/:pnidId/approve-all
  → Approve all matched extractions above a confidence threshold
  → Quick-approve for high-confidence matches
```

---

## Frontend Implementation

### New Components

```
frontend/src/components/ocr/
├── OcrReviewPanel.jsx        # Main approval screen
├── OcrTagList.jsx            # Scrollable list of extracted tags
├── OcrTagCard.jsx            # Individual tag with match info
├── OcrCanvasOverlay.jsx      # Bounding box visualization on P&ID
└── OcrMatchDialog.jsx        # Manual entity linking dialog
```

### OcrReviewPanel — The Approval Screen

This is the key UI. It shows:

```
┌────────────────────────────────────────────────────────────────┐
│  OCR Review — AD219-490-D-15101 Rev.4                    [×]  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────┐  ┌────────────────────────────┐ │
│  │                          │  │  Extracted Tags (17 found)  │ │
│  │     P&ID Canvas          │  │                            │ │
│  │     with OCR bounding    │  │  ✅ V-1001  → V-1001      │ │
│  │     boxes highlighted    │  │     98% match  [Approve]   │ │
│  │                          │  │                            │ │
│  │  [Green] = matched       │  │  ✅ P-1001A → P-1001A     │ │
│  │  [Yellow] = low conf     │  │     95% match  [Approve]   │ │
│  │  [Red] = no match        │  │                            │ │
│  │                          │  │  ⚠️ V-1O01  → V-1001?     │ │
│  │  Click box to select     │  │     72% fuzzy  [Review]    │ │
│  │  tag in list             │  │                            │ │
│  │                          │  │  ❌ XYZ-999  → No match    │ │
│  │                          │  │     [Link] [Reject]        │ │
│  │                          │  │                            │ │
│  └──────────────────────────┘  │  ─── Summary ───           │ │
│                                │  Equipment: 8/10 matched    │ │
│  [Approve All Matched (≥90%)]  │  Instruments: 5/5 matched  │ │
│  [Reject Unmatched]            │  Lines: 2/2 matched        │ │
│                                └────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Interactions:**
- Click a tag in the list → highlights its bounding box on the canvas, scrolls to it
- Click a bounding box on canvas → selects the tag in the list
- "Approve" → writes bbox coordinates to `pnid_equipment`/`pnid_instrument`/`pnid_line`
- "Link" → opens dialog to manually select an entity from the database
- "Reject" → marks as rejected (won't create annotation)
- "Approve All Matched" → bulk approve all tags with match_confidence ≥ threshold
- Drag to adjust bounding box (optional, v2)

### Integration with Existing PnidViewer

The OCR review is triggered from the existing P&ID viewer:
1. Add "Run OCR" button to the `AnnotationToolbar` (visible in edit mode)
2. When clicked, calls `POST /api/v1/ocr/extract/:pnidId`
3. Shows progress indicator while OCR processes
4. Opens `OcrReviewPanel` as a modal/slide-over when complete
5. On approval, the overlay layer automatically shows the new hotspots (existing `OverlayLayer.jsx` already renders from `pnid_equipment`/`pnid_instrument`)

### Approval Flow → Annotation Creation

When user approves an OCR extraction:

```javascript
async function approveExtraction(extraction) {
  if (extraction.tag_type === 'equipment') {
    // Upsert into pnid_equipment junction table
    await api.post(`/api/v1/ocr/results/${pnidId}/approve`, {
      extractionIds: [extraction.id],
      action: 'approve'
    });
    // Backend does:
    // INSERT INTO pnid_equipment (pnid_id, equipment_id, annotation_x_pct, ...)
    // ON CONFLICT (pnid_id, equipment_id) UPDATE SET annotation_x_pct = ...
  }
  // Same for instruments and lines

  // Refresh overlay layer to show new hotspots
  queryClient.invalidateQueries(['pnid-overlay', pnidId]);
}
```

---

## Storage Key Convention

OCR results stored alongside P&IDs in the same GCS bucket:

```
{platform_code}/pids/{drawing_number}/rev_{revision}/
├── drawing.pdf                    # The P&ID file
├── thumbnail.jpg                  # Preview thumbnail
├── ocr/
│   ├── raw_ocr_output.json        # Full Vision API response (for debugging)
│   ├── extracted_tags.json         # Classified tags with bounding boxes
│   └── approval_log.json          # Audit trail of approvals
```

Line lists and equipment lists stored at platform level:
```
{platform_code}/
├── linelists/rev_{n}/linelist.xlsx
├── equipment/rev_{n}/equipment_list.xlsx
└── pids/{drawing_number}/...
```

---

## NPM Dependencies

```bash
cd backend
npm install @google-cloud/vision    # OCR API
npm install sharp                    # Image dimension extraction (already common)
```

No new frontend dependencies needed — uses existing React Query + existing UI components.

---

## Implementation Steps (Build Order)

### Phase 1: OCR Engine + Database (Backend)
1. Create migration: `ocr_extraction` and `ocr_job` tables
2. Implement `VisionOCRProvider.js` — Vision API wrapper
3. Implement `WordGrouper.js` — spatial word reassembly
4. Implement `TagClassifier.js` — regex-based tag classification
5. Implement `TagMatcher.js` — fuzzy matching against DB
6. Implement `OcrPipeline.js` — orchestrator
7. Add `download()` method to `GCSStorageProvider` (currently missing)

### Phase 2: API Routes (Backend)
8. Create `routes/ocr.js` with extract, status, results, approve endpoints
9. Register routes in the Fastify app
10. Add approval logic: copy approved coords to junction tables

### Phase 3: Approval UI (Frontend)
11. Create `OcrReviewPanel.jsx` — main review screen
12. Create `OcrCanvasOverlay.jsx` — bounding box visualization
13. Create `OcrTagList.jsx` — tag list with match status
14. Create `OcrMatchDialog.jsx` — manual linking
15. Add "Run OCR" button to `AnnotationToolbar.jsx`
16. Add React Query hooks for OCR endpoints

### Phase 4: Polish
17. Handle PDF P&IDs (async batch processing via GCS URI)
18. Add bulk approve/reject
19. Add re-run OCR (for updated P&ID versions)
20. Persist raw OCR output to GCS for debugging

---

## Line List & Equipment List Comparison

When line lists / equipment lists are uploaded to GCS (same storage as P&IDs), the pipeline can cross-reference:

1. **On line list upload**: Parse the spreadsheet → insert/update `line` table rows
2. **On equipment list upload**: Parse → insert/update `equipment` table rows
3. **On OCR run**: The `TagMatcher` already queries these tables for matching
4. **Comparison view**: Show side-by-side:
   - Tags found by OCR on this P&ID
   - Tags in the line/equipment list that reference this P&ID
   - Highlight discrepancies (tag on drawing but not in list, or in list but not on drawing)

This catches errors like:
- Equipment on drawing but missing from equipment list
- Line in list referencing this P&ID but not found on drawing
- Tag number mismatches (OCR vs list)

---

## Security & Permissions

- OCR extraction requires admin/editor role (not viewer)
- Approval requires a different user than the one who ran OCR (four-eyes principle, configurable)
- Raw OCR output stored in GCS with same access controls as P&IDs
- Vision API called with service account credentials (same as GCS)

---

## Cost Estimate

- Google Cloud Vision: $1.50 per 1000 images
- Typical project: 24 P&IDs × 1-3 revisions = ~72 images = **$0.11**
- Large project: 500 P&IDs = **$0.75**
- Negligible cost. No need for Tesseract fallback.
