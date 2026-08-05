# Session: Annotation Module Redesign — Standalone Tag Viewer & Editor

## Context

The annotation module currently works tightly coupled with the OCR pipeline — annotations are created during OCR approval and rendered in the PnidViewer. The redesign makes it a **standalone module** that reads from the central database (junction tables + annotation table) and provides a complete tag management and annotation workspace for any P&ID, independent of how the data got there (OCR, manual import, CSV, API).

## Current Architecture (what exists)

### Database (central source of truth)
- `annotation` table: id, pnid_id, x_pct/y_pct/w_pct/h_pct, shape, color, stroke_width, linked_entity_type, linked_entity_id, approval_status (draft/approved), metadata (has extraction_id for OCR origin)
- `pnid_equipment`: pnid_id, equipment_id, annotation_x_pct/y_pct/w_pct/h_pct, position_verified
- `pnid_instrument`: pnid_id, instrument_id, annotation_x_pct/y_pct/w_pct/h_pct, position_verified
- `pnid_line`: pnid_id, line_id, annotation_x_pct/y_pct, is_continuation
- `pnid_system`: pnid_id, system_id, is_primary
- `ocr_extraction`: extracted_text, tag_type, bbox coordinates, matched_entity_id, linked_annotation_id, confidence

### Frontend Components (in `/frontend/src/components/pnid/`)
- `PnidViewer.jsx` — Main orchestrator: edit mode, tool selection, pan/zoom, OCR integration
- `AnnotationToolbar.jsx` — 5 categories (Equipment/Instruments/Piping/Valves/General) with 20+ P&ID symbols
- `AnnotationPanel.jsx` — Right sidebar with Registry (entity placement coverage) & Repository (audit log)
- `KonvaAnnotationStage.jsx` — Konva.js rendering of annotations with drag, selection, OCR ghosts
- `KonvaShapeRenderer.jsx` — Individual shape rendering (pin, line, rect, circle, diamond, P&ID symbols)
- `KonvaOcrGhosts.jsx` — Semi-transparent OCR bounding box suggestions
- `LinkDialog.jsx` — Modal for linking annotations to entities
- `OverlayLayer.jsx` — Renders equipment/instrument/line boxes from junction tables

### Backend Routes (`/backend/src/routes/annotations.js`)
- `GET /pnids/:pnidId/annotations` — Fetch all annotations for a P&ID
- `POST /pnids/:pnidId/annotations` — Create annotation
- `GET /pnids/:pnidId/overlay` — Fetch entity positions from junction tables
- `GET /pnids/:pnidId/linkable-entities` — All entities available for linking
- `PATCH /annotations/:annotationId` — Update (position, color, stroke, text, status)
- `PATCH /annotations/:annotationId/approve` — Toggle draft/approved
- `DELETE /annotations/:annotationId` — Soft delete
- `POST /pnids/:pnidId/place-entity` — Atomic: create entity + junction + annotation

### Services
- `annotationPublishService.js` — Pushes annotation coordinates to junction tables
- `aiAssistance.js` — `createDraftAnnotationsFromOcr()` creates color-coded annotations from OCR data

### Coordinate System
All positions are **percentage-based** (x_pct, y_pct, w_pct, h_pct) — works at any zoom level or drawing size.

### Current Limitations
1. Tightly coupled to OCR pipeline — hard to use standalone
2. No way to see all tags across P&IDs for a platform
3. No search/filter bar for finding tags on the drawing
4. No visual indicator for AI vs manual annotations
5. Entities in the register without coordinates can't be manually annotated easily
6. No bidirectional click: annotation→list and list→annotation
7. No way to filter annotations by system/line/equipment/instrument relationships
8. Annotations don't dynamically reflect register changes

## What Needs to Change

### 1. Standalone Entry Point — Annotation Workspace

Create a new top-level view accessible from the main navigation (not just through OCR pipeline):

**Route:** `/annotations` or `/pnid-viewer`

**Layout (3 panels):**
```
┌─────────────────────────────────────────────────────────────────┐
│  [Google-style search bar]                    [P&ID selector]   │
├──────────┬──────────────────────────────┬───────────────────────┤
│          │                              │                       │
│  Tag     │    P&ID Drawing Canvas       │   Annotation          │
│  List    │    (Konva + PDF/Image)        │   Properties          │
│  Panel   │                              │   Panel               │
│          │                              │                       │
│  Lines   │                              │   - Color picker      │
│  Equip   │                              │   - Shape selector    │
│  Instr   │                              │   - Entity link       │
│  Systems │                              │   - Source indicator   │
│          │                              │   - Position editor   │
│          │                              │                       │
├──────────┴──────────────────────────────┴───────────────────────┤
│  Status bar: 34 equipment · 26 lines · 13 instruments · 2/34   │
│  not positioned · AI: 45 · Manual: 28                           │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Google-Style Search Bar (Top)

A persistent search bar at the top of the annotation workspace:
- **Instant search** across all tag numbers, descriptions, entity types
- **Search scope:** current P&ID only (default) or all P&IDs on the platform
- **Results dropdown:** shows tag, type, P&ID drawing number, annotation status
- **Click result → highlights annotation on canvas** (pan + zoom to it, pulse animation)
- **Keyboard:** `/` to focus, `Esc` to close, arrow keys to navigate results
- **Filter chips:** after search, show removable filter chips (e.g., "type: equipment", "system: HC")

### 3. P&ID Selector (Top Right)

Dropdown or breadcrumb to switch between P&IDs:
- Show: drawing_number, title, annotation progress (e.g., "34/47 annotated")
- Filter by system (show P&IDs for system HC, or system 28)
- Quick-switch without losing search context
- Show annotation coverage percentage per P&ID

### 4. Tag List Panel (Left Side)

Replace the current Registry tab with a full **Tag List Panel**:

**Grouped by discipline with collapsible sections:**
- **Lines** (count) — color: `#8AB4FF`
- **Equipment** (count) — color: `#3BE494`
- **Instruments** (count) — color: `#FFD466`
- **Systems** (count) — shown as grouping headers

**Each tag row shows:**
- Tag number (monospace font)
- Entity type icon
- Annotation status indicator:
  - Green dot: has annotation with coordinates (positioned)
  - Orange dot: AI-annotated (from OCR, not manually verified)
  - Red dot: in register but NO annotation coordinates (needs manual placement)
  - Blue dot: manually annotated
- System code (if entity belongs to a system)
- Confidence % (if from OCR)

**Interactions:**
- **Click tag → pan canvas to annotation** (smooth scroll + highlight pulse)
- **Right-click → context menu:** Edit, Delete, Re-annotate, View in Register
- **Drag tag from list → drop on canvas** to manually place annotation for unpositioned entities
- **Multi-select** (shift+click, ctrl+click) for bulk operations

**Filters at top of panel:**
- Filter by: All | Positioned | Unpositioned | AI | Manual
- Filter by system (dropdown)
- Sort by: Tag number | Type | Status | Confidence

### 5. P&ID Drawing Canvas (Center)

Keep the existing Konva-based rendering but enhance:

**Annotation indicators on canvas:**
- Each annotation shows a small badge in the corner:
  - `AI` badge (small, semi-transparent) for OCR-originated annotations
  - `M` badge for manually created annotations
  - Colored border matching entity type (green=equipment, blue=line, amber=instrument)
- **Hover:** show tooltip with tag number, type, system, confidence
- **Click annotation → selects in tag list** (scroll to it, highlight)
- **Click annotation → opens properties panel** on right

**Manual annotation for unpositioned entities:**
- When user drags an unpositioned entity from the tag list to the canvas:
  1. Show crosshair cursor
  2. User clicks position on drawing
  3. Create annotation at click point with default shape for entity type
  4. Write coordinates to junction table
  5. Update tag list status indicator (red → blue dot)
- Alternative: Click "Annotate" button on an unpositioned entity → enter placement mode → click on canvas

**Dynamic sync with register:**
- If an entity is added/removed from the register, the tag list and canvas update
- If junction table coordinates change (e.g., from another session), annotations refresh
- Polling or websocket for live updates (polling every 30s is fine)

### 6. Annotation Properties Panel (Right Side)

When an annotation is selected, show editable properties:

**Identity section:**
- Tag number (read-only, links to register)
- Entity type (equipment/instrument/line)
- System code
- Description (from register)

**Appearance section:**
- **Color picker:** predefined colors + custom hex input
  - Default colors by type: Equipment=#3BE494, Instrument=#FFD466, Line=#8AB4FF, Valve=#FF897A
- **Shape selector:** rectangle, circle, diamond, pin, P&ID symbols
- **Stroke width:** 1-4 px slider
- **Opacity:** 0-100% slider
- **Label display:** show/hide tag text on canvas

**Position section:**
- X%, Y%, W%, H% fields (editable, snap to 0.5% increments)
- "Reset to OCR position" button (if OCR bbox available)
- "Center on entity" button

**Source & Status section:**
- Source indicator: "AI (OCR)" with confidence %, or "Manual"
- OCR extraction link (if from OCR: show original extracted text, bbox)
- Approval status: Draft / Approved toggle
- Created date, last modified date

**Actions:**
- Delete annotation
- Duplicate annotation
- Export annotation data (JSON)

### 7. Bidirectional Click Navigation

This is critical for usability:

**Canvas → List:**
- Click any annotation on the canvas
- Tag list scrolls to that entity and highlights it
- Properties panel opens on the right

**List → Canvas:**
- Click any tag in the list
- Canvas pans and zooms to show the annotation
- Annotation gets a highlight pulse animation (yellow glow, fades after 1s)
- If entity has no annotation (unpositioned), show a message: "Not annotated — click to place"

**Search → Canvas:**
- Search result clicked → canvas pans to annotation + list highlights tag

### 8. Relationship Filtering

Since entities have relationships (system → lines → equipment → instruments):

**System filter:**
- Select a system in the filter dropdown
- Tag list shows only entities belonging to that system
- Canvas dims/hides annotations for other systems (30% opacity)
- System boundary shown as a subtle colored background region

**Line filter:**
- Select a line → show equipment and instruments on that line
- Canvas highlights the line annotation and connected entities

**Cross-P&ID navigation:**
- If an entity appears on multiple P&IDs (via junction tables), show a "Also on: P&ID-001, P&ID-003" link
- Click to switch P&ID while keeping the entity selected

### 9. Unpositioned Entity Workflow

For entities in the register that have NO annotation coordinates:

**Visual indicator:**
- In tag list: red dot + "Not placed" label
- Status bar: "2/34 not positioned" counter

**Placement workflow:**
1. Click unpositioned entity in tag list
2. Properties panel shows: "This entity has no position on this P&ID"
3. Button: "Place on Drawing"
4. Canvas enters placement mode (crosshair cursor, dimmed background)
5. User clicks on the P&ID where the tag appears
6. Annotation created at click point
7. Coordinates written to junction table immediately
8. Tag list updates: red dot → blue dot

**Bulk placement:**
- "Auto-place from OCR" button: for entities that have OCR bboxes but no annotation yet
- Uses existing `KonvaOcrGhosts.jsx` suggestion system

### 10. Backend Changes

**New endpoint: Tag search**
```
GET /api/v1/annotations/search?q=PT-001&platform_id=X&pnid_id=Y
```
Returns matching entities across types with their annotation status.

**New endpoint: Annotation summary per P&ID**
```
GET /api/v1/pnids/:pnidId/annotation-summary
```
Returns: { total, positioned, unpositioned, aiAnnotated, manualAnnotated, byType: { lines, equipment, instruments } }

**Enhanced overlay endpoint:**
Extend `GET /pnids/:pnidId/overlay` to include:
- Source indicator (has linked OCR extraction = AI, otherwise = manual)
- System code for each entity
- Confidence score from OCR extraction (if available)

**Annotation source tracking:**
When creating annotations, store in metadata:
```json
{ "source": "ocr" | "manual" | "import", "ocrConfidence": 0.95, "extractionId": "..." }
```

## UI Design Guidelines

- Dark mode: `bg=#0D1F17`, `panel=#111D14`, `card=#16352B`, `text=#D3DFE2`, `muted=#919A9B`
- Canvas area: light background `#F5F7F7` (always light for drawing readability)
- Accent: `#3BE494` (process green), Secondary: `#2D33E0` (blue)
- Entity colors: Equipment=`#3BE494`, Line=`#8AB4FF`, Instrument=`#FFD466`, Valve=`#FF897A`, System=`#A855F7`
- Font: 11px base, 9px labels, monospace for tag numbers
- Use Material Symbols Outlined icons
- Tag list rows: compact (py-1.5), hover highlight, status dot on left
- Search bar: full-width, rounded, with search icon, clear button, filter chips below
- Canvas annotations: 2px stroke default, semi-transparent fill (15% opacity)

## Files to Create/Modify

### New Files
- `frontend/src/components/annotations/AnnotationWorkspace.jsx` — Main 3-panel layout
- `frontend/src/components/annotations/TagListPanel.jsx` — Left panel with grouped tag list
- `frontend/src/components/annotations/TagSearchBar.jsx` — Google-style search bar
- `frontend/src/components/annotations/AnnotationPropertiesPanel.jsx` — Right panel with editable properties
- `frontend/src/components/annotations/PnidSelector.jsx` — P&ID picker with coverage stats
- `frontend/src/components/annotations/StatusBar.jsx` — Bottom bar with annotation stats
- `frontend/src/hooks/useAnnotationWorkspace.js` — Zustand store for workspace state (selected tag, filters, search)

### Modified Files
- `frontend/src/components/pnid/KonvaAnnotationStage.jsx` — Add source badges, click→select sync
- `frontend/src/components/pnid/OverlayLayer.jsx` — Add source indicator colors, system grouping
- `frontend/src/components/pnid/PnidViewer.jsx` — Accept external selection state, pan-to-annotation
- `backend/src/routes/annotations.js` — Add search endpoint, enhance overlay response
- `frontend/src/App.jsx` — Add route for `/annotations`

### Keep Existing (reuse)
- `KonvaShapeRenderer.jsx` — Shape rendering unchanged
- `KonvaDrawingPreview.jsx` — Drawing preview unchanged  
- `AnnotationToolbar.jsx` — Tool palette reused in workspace
- `LinkDialog.jsx` — Entity linking modal reused
- All backend CRUD routes — annotation create/update/delete unchanged

## Key Constraints

- Must work with existing data — all current annotations remain valid
- Coordinates stay percentage-based (x_pct, y_pct, w_pct, h_pct)
- Junction table writes must include annotation coordinates
- The module reads from the central database — it doesn't care if data came from OCR, CSV import, or manual entry
- Keep the existing PnidViewer working as-is for backward compatibility (the new workspace wraps it)
- Search must be fast — use pg_trgm index on tag/line_number fields
- Annotation source (AI vs manual) must be visually distinct on canvas and in list

## Test Data
- Platform: AKK4
- P&IDs: AD-28-D-100000-SHT-001, AD-28-D-100001-SHT-001
- Expected: ~110 equipment, ~18 lines, ~32 instruments from OCR pipeline
- Some entities will have coordinates (from OCR), some won't (need manual placement)
