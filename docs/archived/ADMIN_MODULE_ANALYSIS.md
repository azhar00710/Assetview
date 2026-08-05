# Admin Module Analysis — P&ID Management, Versioning, Storage & Annotation Integrity

## Executive Summary

This document analyzes the best approach for evolving AssetView's admin module to support:
1. **Full hierarchy CRUD** — Create/manage oil fields, locations, platforms, units
2. **P&ID upload & storage** — Cloud (S3/Azure Blob/GCS) or local server with abstraction layer
3. **P&ID versioning** — Revision tracking without destroying annotation canvases
4. **Annotation canvas preservation** — How to handle canvas data when P&IDs are updated
5. **Line list updates** — Controlled updates to lines/equipment/instruments with impact analysis

The application is **NOT a storage application**. P&IDs, line lists, and other documents reside on external storage (cloud bucket or local network share). AssetView connects to that storage via key/link mechanism.

---

## 1. Storage Architecture — Cloud & Local Abstraction

### Core Principle: AssetView Stores References, Not Files

AssetView should never be the source-of-truth for file storage. Instead, it stores:
- **Storage references** (keys/paths) pointing to where files live
- **Metadata** (revision, status, checksums) for integrity
- **Thumbnails** (small preview images generated on upload for fast UI rendering)

### Storage Provider Abstraction Layer

Create a `StorageProvider` interface that supports both cloud and local backends:

```
backend/src/services/storage/
├── StorageProvider.js        # Abstract interface
├── S3StorageProvider.js      # AWS S3 / MinIO implementation
├── AzureBlobProvider.js      # Azure Blob Storage implementation
├── GCSStorageProvider.js     # Google Cloud Storage implementation
├── LocalStorageProvider.js   # Local filesystem / NAS implementation
└── index.js                  # Factory — reads config, returns correct provider
```

#### StorageProvider Interface

```javascript
class StorageProvider {
  /**
   * Upload a file and return a storage reference
   * @param {Buffer|Stream} file - File content
   * @param {string} key - Storage key (path within bucket/folder)
   * @param {object} metadata - Content-type, custom headers
   * @returns {{ storageKey, storageUrl, checksum, size }}
   */
  async upload(file, key, metadata) {}

  /**
   * Generate a time-limited signed URL for viewing/downloading
   * @param {string} key - Storage key
   * @param {number} expiresIn - Seconds until expiry (default 3600)
   * @returns {string} Signed URL (cloud) or direct path (local)
   */
  async getSignedUrl(key, expiresIn = 3600) {}

  /**
   * Delete a file from storage
   * @param {string} key - Storage key
   */
  async delete(key) {}

  /**
   * Check if a file exists
   * @param {string} key - Storage key
   * @returns {boolean}
   */
  async exists(key) {}

  /**
   * Copy a file within storage (used for versioning)
   * @param {string} sourceKey
   * @param {string} destKey
   */
  async copy(sourceKey, destKey) {}
}
```

#### Configuration Model

```
# .env — Storage configuration

# Provider: 's3' | 'azure' | 'gcs' | 'local'
STORAGE_PROVIDER=s3

# Cloud: S3 / MinIO
STORAGE_S3_BUCKET=assetview-pids
STORAGE_S3_REGION=me-south-1
STORAGE_S3_ACCESS_KEY=AKIA...
STORAGE_S3_SECRET_KEY=...
STORAGE_S3_ENDPOINT=            # Optional: for MinIO or S3-compatible

# Cloud: Azure Blob
STORAGE_AZURE_CONNECTION_STRING=...
STORAGE_AZURE_CONTAINER=pids

# Cloud: GCS
STORAGE_GCS_BUCKET=assetview-pids
STORAGE_GCS_KEY_FILE=/path/to/service-account.json

# Local: Network share or local folder
STORAGE_LOCAL_BASE_PATH=/mnt/nas/assetview/pids
STORAGE_LOCAL_SERVE_URL=https://files.company.com/assetview
```

#### Storage Key Convention

Files are organized by hierarchy path for clean structure:

```
{concession_code}/{field_code}/{platform_code}/pids/
  {drawing_number}/
    rev_{revision}/
      original.pdf                    # Original uploaded PDF
      rendered.png                    # Full-resolution raster (for canvas)
      thumbnail.jpg                   # 400px thumbnail (for list views)
      metadata.json                   # Upload metadata, checksum, uploader
```

Example:
```
AD219/UMS/WHT-5/pids/15101/rev_4/original.pdf
AD219/UMS/WHT-5/pids/15101/rev_4/rendered.png
AD219/UMS/WHT-5/pids/15101/rev_4/thumbnail.jpg
```

### Database Schema Addition — Storage Configuration Table

```sql
CREATE TABLE storage_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Scope: can be global, per-concession, or per-platform
  scope_type VARCHAR(20) NOT NULL DEFAULT 'global',  -- global | concession | platform
  scope_id UUID,  -- NULL for global, FK for concession/platform

  provider VARCHAR(20) NOT NULL,  -- s3 | azure | gcs | local
  bucket_or_container VARCHAR(255),
  region VARCHAR(50),
  endpoint_url VARCHAR(500),       -- custom endpoint for S3-compatible / local serve URL
  base_path VARCHAR(500),          -- base prefix within bucket or local path
  credentials_ref VARCHAR(255),    -- reference to secret manager, NOT stored in DB

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(scope_type, scope_id)
);
```

This allows different projects (concessions) or platforms to use different storage backends — e.g., one project on AWS, another on local NAS.

### How the Connection Works

1. **Admin configures storage** in Admin > Settings: selects provider, enters bucket/path, validates connection
2. **On P&ID upload**: backend resolves the storage provider for that platform's scope, uploads file, stores the `storage_key` in the `pnid` table
3. **On P&ID view**: backend generates a signed URL (cloud) or constructs the serve URL (local), returns it to frontend
4. **Frontend never sees raw credentials** — only time-limited signed URLs or proxied paths

---

## 2. P&ID Upload Workflow

### Upload Process

```
Admin uploads P&ID PDF
        │
        ▼
┌─────────────────────────┐
│  Backend receives file   │
│  (multipart/form-data)   │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Validate file           │
│  - PDF/TIFF format       │
│  - Max size (100MB)      │
│  - Virus scan (optional) │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Generate renderings     │
│  - PNG raster (canvas)   │
│  - JPG thumbnail (list)  │
│  - Extract page count    │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Upload to storage       │
│  - Original PDF          │
│  - Rendered PNG          │
│  - Thumbnail JPG         │
│  - Compute SHA-256 hash  │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Update database         │
│  - pnid.storage_key      │
│  - pnid.file_checksum    │
│  - pnid.has_image = true │
│  - pnid_version record   │
└─────────────────────────┘
```

### API Endpoint

```
POST /api/v1/admin/pnids/:id/upload
Content-Type: multipart/form-data
Body: { file: <PDF>, revision?: "5", notes?: "Updated well connections" }

Response: {
  success: true,
  pnid: { id, drawingNumber, revision, storageKey, hasImage },
  version: { id, versionNumber, previousRevision, newRevision }
}
```

### Database Schema Addition — pnid table extensions

```sql
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS storage_key VARCHAR(500);
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS thumbnail_key VARCHAR(500);
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS file_checksum VARCHAR(128);
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT 1;
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS uploaded_by UUID;
```

---

## 3. P&ID Versioning — The Critical Problem

### The Problem

When a P&ID is revised (e.g., Rev 4 → Rev 5):
- The drawing image changes (new/moved equipment, changed piping)
- **Existing annotations have percentage-based positions** that may no longer be accurate
- The admin should NOT have to re-annotate everything from scratch
- But some annotations WILL need adjustment because equipment has moved

### Versioning Strategy: "Copy-on-Revise" with Annotation Migration

#### New Table: `pnid_version`

```sql
CREATE TABLE pnid_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pnid_id UUID NOT NULL REFERENCES pnid(id),

  -- Version tracking
  version_number INTEGER NOT NULL,         -- Auto-incrementing per pnid
  revision VARCHAR(20) NOT NULL,           -- Document revision (e.g., "Rev 5")

  -- Storage references (each version keeps its own files)
  storage_key VARCHAR(500) NOT NULL,       -- Path to rendered image for this version
  pdf_storage_key VARCHAR(500),            -- Path to original PDF
  thumbnail_key VARCHAR(500),
  file_checksum VARCHAR(128),
  file_size_bytes BIGINT,

  -- What changed
  change_summary TEXT,                     -- Admin's description of changes
  change_type VARCHAR(50),                 -- minor_update | equipment_change | layout_change | full_redraw

  -- Status
  status VARCHAR(20) DEFAULT 'draft',     -- draft | active | superseded

  -- Annotation snapshot
  annotation_snapshot_id UUID,             -- Reference to frozen annotation set (see below)

  -- Audit
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  superseded_at TIMESTAMPTZ,
  superseded_by UUID,

  UNIQUE(pnid_id, version_number)
);

CREATE INDEX idx_pnid_version_pnid ON pnid_version(pnid_id);
CREATE INDEX idx_pnid_version_active ON pnid_version(pnid_id) WHERE status = 'active';
```

#### How It Works

```
P&ID "15101" exists at Rev 4 with 12 equipment annotations
                │
                ▼
Admin uploads Rev 5 PDF
                │
                ▼
┌──────────────────────────────────────┐
│  1. Current version (Rev 4) marked   │
│     status = 'superseded'            │
│     Files KEPT in storage (archive)  │
│     Annotation positions FROZEN      │
│     in pnid_version.snapshot         │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  2. New version record created       │
│     version_number = 2               │
│     revision = "Rev 5"              │
│     status = 'active'               │
│     New storage_key for new files    │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  3. Annotation migration decision    │
│     Admin chooses:                   │
│     a) CARRY FORWARD — copy all      │
│        annotation positions to new   │
│        version (default)             │
│     b) SELECTIVE — review each       │
│        annotation, keep/adjust/drop  │
│     c) FRESH START — no annotations  │
│        carried over                  │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  4. pnid table updated              │
│     pnid.revision = "Rev 5"         │
│     pnid.storage_key = new key      │
│     pnid.active_version_id = new ID │
│     Existing pnid_equipment /        │
│     pnid_instrument positions        │
│     KEPT (carry forward) or          │
│     CLEARED (fresh start)            │
└──────────────────────────────────────┘
```

#### The Canvas Preservation Rule

**Annotations are tied to the P&ID entity (pnid.id), NOT to a specific version.**

This means:
- `pnid_equipment` and `pnid_instrument` positions point to the **current** P&ID drawing
- When a new version is uploaded, these positions are **carried forward by default**
- The admin gets a **review mode** where they can see the new drawing with old annotation positions overlaid, and adjust any that have shifted
- Old versions + their annotation snapshots are archived and viewable (read-only) via a "Version History" panel

#### Annotation Snapshot (for archival)

```sql
CREATE TABLE annotation_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pnid_version_id UUID NOT NULL REFERENCES pnid_version(id),
  snapshot_data JSONB NOT NULL,  -- Full copy of pnid_equipment + pnid_instrument + annotation positions
  created_at TIMESTAMPTZ DEFAULT now()
);
```

The `snapshot_data` JSONB contains:
```json
{
  "equipment": [
    { "equipment_id": "...", "tag": "XV-1901", "x_pct": 45.2, "y_pct": 32.1, "w_pct": 5.0, "h_pct": 4.0 }
  ],
  "instruments": [
    { "instrument_id": "...", "tag": "PT-1901", "x_pct": 48.0, "y_pct": 30.0, "w_pct": 3.0, "h_pct": 3.0 }
  ],
  "annotations": [
    { "id": "...", "type": "pin", "x_pct": 50.0, "y_pct": 50.0, "text": "Check valve alignment" }
  ]
}
```

### Why This Approach

| Alternative | Problem |
|------------|---------|
| **Create new pnid record per revision** | Breaks all FK references (lines, equipment, systems point to old pnid_id). Requires cascade updates across junction tables. Very destructive. |
| **Overwrite files in place** | Loses history. Cannot compare revisions. No rollback. |
| **Version annotation positions separately** | Over-complex. Annotations are simple enough to snapshot as JSONB. |
| **Our approach: version the files, carry forward the annotations** | Preserves all relationships. P&ID identity (pnid.id) never changes. Annotations auto-migrate. History preserved in snapshots. |

---

## 4. Canvas Annotation Model — How It Works With Versions

### Current State

The canvas (P&ID viewer) overlays annotations using percentage-based coordinates:

```
pnid_equipment: { pnid_id, equipment_id, annotation_x_pct, annotation_y_pct, annotation_w_pct, annotation_h_pct }
pnid_instrument: { pnid_id, instrument_id, annotation_x_pct, annotation_y_pct, annotation_w_pct, annotation_h_pct }
annotation: { pnid_id, x_pct, y_pct, w_pct, h_pct, type, text, status }
```

### Version-Aware Canvas Behavior

#### Viewing Current Version (Normal Mode)
- Canvas loads the **active version's** rendered image
- Overlays current `pnid_equipment` / `pnid_instrument` / `annotation` positions
- No change from current behavior

#### Viewing Historical Version (Archive Mode)
- Canvas loads the **selected version's** rendered image from `pnid_version.storage_key`
- Overlays positions from `annotation_snapshot.snapshot_data`
- **Read-only** — no editing allowed on archived versions
- Visual indicator: "Viewing Rev 4 (superseded)" banner

#### Annotation Adjustment Mode (After Upload)
When a new P&ID version is uploaded with "carry forward" annotations:

1. **Side-by-side comparison**: Old version (left) and new version (right) with annotation positions shown
2. **Drag-to-adjust**: Admin can drag annotation hotspots to correct positions on new drawing
3. **Bulk confirm**: Once satisfied, admin confirms and positions are saved
4. **Unresolved markers**: Any annotation not reviewed gets an "unverified" flag (shown as dashed border in viewer)

```sql
-- Add verification tracking to junction tables
ALTER TABLE pnid_equipment ADD COLUMN IF NOT EXISTS position_verified BOOLEAN DEFAULT true;
ALTER TABLE pnid_equipment ADD COLUMN IF NOT EXISTS verified_for_version UUID REFERENCES pnid_version(id);

ALTER TABLE pnid_instrument ADD COLUMN IF NOT EXISTS position_verified BOOLEAN DEFAULT true;
ALTER TABLE pnid_instrument ADD COLUMN IF NOT EXISTS verified_for_version UUID REFERENCES pnid_version(id);
```

When annotations are carried forward, `position_verified` is set to `false` and the admin adjusts + verifies each one. The `LinkageDashboard` already shows linked/unlinked status — this extends naturally to show "verified" vs "needs review" status.

---

## 5. Line List Updates — Controlled Change Management

### The Problem

Line lists, equipment lists, and instrument lists change over the life of a project:
- New lines added during construction
- Equipment tags renamed
- Instruments re-calibrated or replaced
- Lines re-routed between P&IDs

These changes can affect:
- Junction table relationships (pnid_line, pnid_equipment, pnid_instrument)
- Annotation positions (if equipment tag changes, the annotation still points to the right entity by FK, but the displayed tag changes)
- Cross-references (if a line moves to a different system, cross-ref logic changes)

### Strategy: Import with Change Detection

#### CSV/Excel Import with Diff Preview

When an admin imports an updated line list:

```
┌──────────────────────────────────┐
│  1. Parse uploaded CSV            │
│  2. Match rows to existing        │
│     entities by unique key        │
│     (line_number, tag, etc.)      │
│  3. Generate diff report:         │
│     - NEW: 3 lines added          │
│     - MODIFIED: 5 lines changed   │
│     - REMOVED: 1 line not in file │
│     - UNCHANGED: 4 lines same     │
│  4. Show diff to admin for review │
│  5. Admin approves changes        │
│  6. Apply changes with audit log  │
└──────────────────────────────────┘
```

#### API Endpoint

```
POST /api/v1/admin/import/lines/preview?platform_id=
Content-Type: text/csv
Response: {
  preview: {
    added: [{ lineNumber: "XX-4\"-NEW-001", ... }],
    modified: [{
      lineNumber: "CO-6\"-EC12NLD-1195AD",
      changes: {
        nominalSize: { old: "6\"", new: "8\"" },
        designPressure: { old: "45.0", new: "52.0" }
      }
    }],
    removed: [{ lineNumber: "OLD-LINE-001", hasAnnotations: true, annotationCount: 3 }],
    unchanged: [{ lineNumber: "PR-10\"-PA1MCS-1105AD" }]
  },
  warnings: [
    "Line OLD-LINE-001 has 3 P&ID annotations that will be orphaned if removed"
  ]
}

POST /api/v1/admin/import/lines/apply?platform_id=
Body: {
  importId: "preview-id",
  approvedAdds: [...ids],
  approvedModifies: [...ids],
  approvedRemoves: [...ids],   // Admin can choose NOT to remove certain lines
  removeAction: "soft_delete"  // soft_delete | archive | hard_delete (never recommended)
}
```

#### Impact Analysis for Removals

Before removing any entity, check:

```sql
-- For a line being removed, check annotation impact
SELECT
  l.line_number,
  COUNT(DISTINCT pl.pnid_id) AS pnid_appearances,
  COUNT(DISTINCT e.id) AS equipment_on_line,
  COUNT(DISTINCT i.id) AS instruments_on_line,
  COUNT(DISTINCT pe.id) AS equipment_annotations,
  COUNT(DISTINCT pi.id) AS instrument_annotations
FROM line l
LEFT JOIN pnid_line pl ON pl.line_id = l.id
LEFT JOIN equipment e ON e.line_id = l.id
LEFT JOIN instrument i ON i.line_id = l.id
LEFT JOIN pnid_equipment pe ON pe.equipment_id = e.id
LEFT JOIN pnid_instrument pi ON pi.instrument_id = i.id
WHERE l.id = $1
GROUP BY l.id, l.line_number;
```

If a line has downstream annotations, the admin sees:
> "Line CO-6\"-EC12NLD-1195AD appears on 2 P&IDs, has 3 equipment and 2 instruments with annotations. Removing this line will orphan those annotations. Proceed?"

#### Audit Log for Changes

```sql
CREATE TABLE change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,   -- line | equipment | instrument | pnid | system
  entity_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL,        -- create | update | delete | import | version
  changes JSONB,                      -- { field: { old: "...", new: "..." } }
  source VARCHAR(50),                 -- manual | csv_import | api
  batch_id UUID,                      -- Groups changes from same import operation
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID
);

CREATE INDEX idx_change_log_entity ON change_log(entity_type, entity_id);
CREATE INDEX idx_change_log_batch ON change_log(batch_id);
```

---

## 6. Admin Module UI — Recommended Tab Structure

### Current Tabs (Already Implemented)
1. Hierarchy (Concession → Field → Complex → Platform)
2. Systems
3. P&IDs
4. Lines
5. Equipment
6. Instruments
7. Linkage Dashboard

### Recommended New/Enhanced Tabs

```
┌─────────────────────────────────────────────────────────────────────┐
│  ADMIN                                                              │
│                                                                     │
│  [Hierarchy] [Systems] [P&IDs] [Lines] [Equipment] [Instruments]   │
│  [Linkage] [Storage] [Import/Export] [Version History] [Audit Log]  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Tab: P&IDs (Enhanced)

Current functionality plus:
- **Upload button** — Opens file picker for PDF/TIFF upload
- **Version badge** — Shows current revision number
- **Version history** — Expandable panel showing all versions with dates
- **Annotation status** — "12/17 equipment annotated" progress indicator
- **Storage indicator** — Icon showing cloud/local with provider name

#### Tab: Storage (New)

- Configure storage provider (S3/Azure/GCS/Local)
- Test connection button
- Storage usage summary (file count, total size)
- Per-scope configuration (global vs per-concession)
- Bucket/folder browser to verify structure

#### Tab: Import/Export (Enhanced)

Current CSV import/export plus:
- **Preview mode** — See diff before applying
- **Selective apply** — Choose which changes to accept
- **Import history** — Log of past imports with rollback option
- **Template download** — Empty CSV with correct headers

#### Tab: Version History (New)

- Timeline view of all P&ID version changes across the platform
- Filterable by P&ID, date range, change type
- Side-by-side comparison viewer
- Annotation migration status per version

#### Tab: Audit Log (New)

- Searchable log of all admin actions
- Filter by entity type, action, user, date
- Export audit log as CSV

---

## 7. Hierarchy Management — Creating New Fields, Platforms, Units

### Current State

The hierarchy manager already supports CRUD at all 4 levels:
- Concession → Field → Complex → Platform

### Recommended Enhancements

#### 1. Hierarchy Templates

For common platform configurations, provide templates:

```javascript
const platformTemplates = {
  'wellhead': {
    systems: [
      { code: 'PV', name: 'Process', sys_type: 'process' },
      { code: 'CD', name: 'Closed Drain', sys_type: 'utility' },
      { code: 'GL', name: 'Gas Lift', sys_type: 'utility' },
      { code: 'ESD', name: 'Emergency Shutdown', sys_type: 'safety' },
      { code: 'FG', name: 'Fire & Gas', sys_type: 'safety' },
      { code: 'IA', name: 'Instrument Air', sys_type: 'utility' },
    ]
  },
  'processing': {
    systems: [
      { code: 'PV', name: 'Process', sys_type: 'process' },
      { code: 'PM', name: 'Production Manifold', sys_type: 'process' },
      { code: 'SC', name: 'Sample Connection', sys_type: 'utility' },
      // ... more
    ]
  }
};
```

When creating a new platform, admin can pick a template to pre-populate systems.

#### 2. Clone Platform

"Clone WHT-5 as WHT-7" — copies systems, empty P&ID shells (no images), and optionally line/equipment structure.

#### 3. Bulk Hierarchy Import

For greenfield projects with dozens of platforms:
```
POST /api/v1/admin/import/hierarchy
Body: CSV with columns: concession_code, field_code, complex_code, platform_code, platform_type, ...
```

---

## 8. Complete Schema Migration

Here is the full migration SQL that adds all new tables/columns:

```sql
-- ============================================
-- Migration: Admin Module Enhancements
-- Version: 2.1.0
-- ============================================

-- 1. Storage configuration
CREATE TABLE IF NOT EXISTS storage_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type VARCHAR(20) NOT NULL DEFAULT 'global',
  scope_id UUID,
  provider VARCHAR(20) NOT NULL,
  bucket_or_container VARCHAR(255),
  region VARCHAR(50),
  endpoint_url VARCHAR(500),
  base_path VARCHAR(500),
  credentials_ref VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(scope_type, scope_id)
);

-- 2. P&ID storage fields
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS storage_key VARCHAR(500);
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS thumbnail_key VARCHAR(500);
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS file_checksum VARCHAR(128);
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT 1;
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS uploaded_by UUID;
ALTER TABLE pnid ADD COLUMN IF NOT EXISTS active_version_id UUID;

-- 3. P&ID version history
CREATE TABLE IF NOT EXISTS pnid_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pnid_id UUID NOT NULL REFERENCES pnid(id),
  version_number INTEGER NOT NULL,
  revision VARCHAR(20) NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  pdf_storage_key VARCHAR(500),
  thumbnail_key VARCHAR(500),
  file_checksum VARCHAR(128),
  file_size_bytes BIGINT,
  change_summary TEXT,
  change_type VARCHAR(50) DEFAULT 'minor_update',
  status VARCHAR(20) DEFAULT 'draft',
  annotation_snapshot_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  superseded_at TIMESTAMPTZ,
  superseded_by UUID,
  UNIQUE(pnid_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_pnid_version_pnid ON pnid_version(pnid_id);
CREATE INDEX IF NOT EXISTS idx_pnid_version_active ON pnid_version(pnid_id) WHERE status = 'active';

-- FK from pnid to active version
ALTER TABLE pnid ADD CONSTRAINT fk_pnid_active_version
  FOREIGN KEY (active_version_id) REFERENCES pnid_version(id);

-- 4. Annotation snapshots (for version archival)
CREATE TABLE IF NOT EXISTS annotation_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pnid_version_id UUID NOT NULL REFERENCES pnid_version(id),
  snapshot_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Annotation position verification tracking
ALTER TABLE pnid_equipment ADD COLUMN IF NOT EXISTS position_verified BOOLEAN DEFAULT true;
ALTER TABLE pnid_equipment ADD COLUMN IF NOT EXISTS verified_for_version UUID REFERENCES pnid_version(id);
ALTER TABLE pnid_instrument ADD COLUMN IF NOT EXISTS position_verified BOOLEAN DEFAULT true;
ALTER TABLE pnid_instrument ADD COLUMN IF NOT EXISTS verified_for_version UUID REFERENCES pnid_version(id);

-- 6. Change log (audit trail)
CREATE TABLE IF NOT EXISTS change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL,
  changes JSONB,
  source VARCHAR(50),
  batch_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID
);
CREATE INDEX IF NOT EXISTS idx_change_log_entity ON change_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_change_log_batch ON change_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_change_log_created ON change_log(created_at DESC);
```

---

## 9. API Endpoint Summary — New & Modified

### Storage Management
```
GET    /api/v1/admin/storage/config              — Get current storage config
PUT    /api/v1/admin/storage/config              — Update storage config
POST   /api/v1/admin/storage/test-connection      — Test storage provider connection
GET    /api/v1/admin/storage/usage                — Storage usage statistics
```

### P&ID Upload & Versioning
```
POST   /api/v1/admin/pnids/:id/upload             — Upload P&ID file (PDF/TIFF)
GET    /api/v1/admin/pnids/:id/versions            — List all versions
GET    /api/v1/admin/pnids/:id/versions/:vid       — Get specific version detail
POST   /api/v1/admin/pnids/:id/versions/:vid/activate  — Rollback to previous version
GET    /api/v1/admin/pnids/:id/versions/:vid/snapshot  — Get annotation snapshot
GET    /api/v1/pnids/:id/image                     — Get signed URL for current P&ID image
GET    /api/v1/pnids/:id/thumbnail                 — Get signed URL for thumbnail
```

### Import with Preview
```
POST   /api/v1/admin/import/lines/preview          — Preview import changes (diff)
POST   /api/v1/admin/import/lines/apply            — Apply approved changes
POST   /api/v1/admin/import/equipment/preview
POST   /api/v1/admin/import/equipment/apply
POST   /api/v1/admin/import/instruments/preview
POST   /api/v1/admin/import/instruments/apply
POST   /api/v1/admin/import/hierarchy               — Bulk hierarchy import
```

### Annotation Position Management
```
PUT    /api/v1/admin/pnids/:id/annotations/verify  — Mark annotation positions as verified
GET    /api/v1/admin/pnids/:id/annotations/unverified — Get unverified annotations after version change
```

### Audit Log
```
GET    /api/v1/admin/audit-log                      — Search audit log
GET    /api/v1/admin/audit-log/export               — Export audit log as CSV
```

---

## 10. Summary of Key Design Decisions

| Decision | Approach | Rationale |
|----------|----------|-----------|
| **Storage** | Provider abstraction (S3/Azure/GCS/Local) with signed URLs | App is NOT a storage system; files live externally |
| **Storage config** | Per-scope (global/concession/platform) in DB | Different projects may use different backends |
| **P&ID identity** | pnid.id is PERMANENT across all revisions | Preserves all FK relationships (lines, equipment, annotations) |
| **Versioning** | pnid_version table, "Copy-on-Revise" pattern | Old versions archived with files + annotation snapshots |
| **Annotations on version change** | Carry forward by default, mark as "unverified" | Minimizes re-work; admin reviews only what moved |
| **Annotation archival** | JSONB snapshot per version | Simple, queryable, no complex FK chains |
| **Line list updates** | Import with diff preview → selective apply | Prevents accidental data loss; admin reviews before committing |
| **Impact analysis** | Check annotation/FK dependencies before removal | Warns admin about downstream effects |
| **Audit trail** | change_log table with JSONB diff | Full traceability for regulatory compliance (oil & gas) |
| **Soft deletes** | Maintained (existing pattern) | Required for audit trail integrity |
| **File format** | PDF (original) + PNG (canvas) + JPG (thumbnail) | PDF for document control, PNG for pixel-perfect canvas, JPG for fast list loading |

---

## 11. Implementation Priority

### Phase 1: Storage Foundation (1-2 weeks)
1. StorageProvider abstraction layer
2. LocalStorageProvider implementation
3. S3StorageProvider implementation
4. Storage config admin UI + API
5. P&ID upload endpoint with file processing

### Phase 2: Versioning (1-2 weeks)
1. pnid_version table + migration
2. Version creation on upload
3. Annotation snapshot on supersede
4. Version history UI in admin
5. Historical version viewer (read-only canvas)

### Phase 3: Annotation Migration (1 week)
1. Carry-forward logic on version change
2. "Unverified" flag on positions
3. Annotation adjustment mode in canvas
4. Linkage dashboard enhancement (verified/unverified counts)

### Phase 4: Import Enhancement (1 week)
1. Preview/diff endpoint for CSV imports
2. Selective apply UI
3. Impact analysis for removals
4. Change log recording

### Phase 5: Hierarchy & Polish (1 week)
1. Platform templates
2. Clone platform functionality
3. Audit log viewer
4. Bulk hierarchy import
