# Admin Interface — Implementation Plan

## Overview
Full CRUD admin interface for managing the entire asset hierarchy, bulk import/export of lists, and annotation linkage tracking.

## What We're Building

### 1. Admin Panel (new route/view)
A sidebar or top-nav toggle that switches from the main AssetView to an Admin mode with these sections:

### 2. Hierarchy Manager
Tree view showing: **Concession → Field → Complex → Platform**
- Add/Edit/Delete at every level
- Drag-to-reorder (nice-to-have)
- Inline editing of names, codes, descriptions
- Platform-specific fields: status, location coordinates

### 3. System Manager (per Platform)
- Add/Edit/Delete systems within a selected platform
- Set system type (process/utility/safety/instrument)
- Color coding preview

### 4. P&ID (Drawing) Manager (per Platform)
- Add/Edit/Delete P&ID drawings
- Assign primary system + secondary systems
- Upload drawing images
- Set document status, revision info

### 5. List Manager (per Platform) — Lines, Equipment, Instruments
- **View** as sortable/filterable table
- **Add** individual items via form
- **Edit** inline or via modal
- **Delete** with confirmation
- **Upload** CSV/Excel to bulk import
- **Download** CSV export of current data
- **Linkage status**: badge showing which items are annotated on P&IDs vs unlinked

### 6. Annotation Linkage Dashboard
- For each platform, show counts: total items vs linked (annotated on P&IDs)
- Visual indicators: linked (green), unlinked (red/grey)
- Quick action: click unlinked item to assign it to a P&ID

---

## Backend API Additions

### Hierarchy CRUD
```
POST   /api/v1/admin/concessions
PUT    /api/v1/admin/concessions/:id
DELETE /api/v1/admin/concessions/:id
POST   /api/v1/admin/fields
PUT    /api/v1/admin/fields/:id
DELETE /api/v1/admin/fields/:id
POST   /api/v1/admin/complexes
PUT    /api/v1/admin/complexes/:id
DELETE /api/v1/admin/complexes/:id
POST   /api/v1/admin/platforms
PUT    /api/v1/admin/platforms/:id
DELETE /api/v1/admin/platforms/:id
```

### System CRUD
```
POST   /api/v1/admin/systems
PUT    /api/v1/admin/systems/:id
DELETE /api/v1/admin/systems/:id
```

### P&ID CRUD
```
POST   /api/v1/admin/pnids
PUT    /api/v1/admin/pnids/:id
DELETE /api/v1/admin/pnids/:id
POST   /api/v1/admin/pnids/:id/systems     (assign systems)
DELETE /api/v1/admin/pnids/:id/systems/:sid (remove system)
```

### Lines/Equipment/Instruments CRUD
```
POST   /api/v1/admin/lines
PUT    /api/v1/admin/lines/:id
DELETE /api/v1/admin/lines/:id
POST   /api/v1/admin/equipment
PUT    /api/v1/admin/equipment/:id
DELETE /api/v1/admin/equipment/:id
POST   /api/v1/admin/instruments
PUT    /api/v1/admin/instruments/:id
DELETE /api/v1/admin/instruments/:id
```

### Bulk Import/Export
```
POST   /api/v1/admin/import/lines?platform_id=         (CSV upload)
POST   /api/v1/admin/import/equipment?platform_id=      (CSV upload)
POST   /api/v1/admin/import/instruments?platform_id=    (CSV upload)
GET    /api/v1/admin/export/lines?platform_id=          (CSV download)
GET    /api/v1/admin/export/equipment?platform_id=      (CSV download)
GET    /api/v1/admin/export/instruments?platform_id=    (CSV download)
```

### Linkage Status
```
GET    /api/v1/admin/linkage?platform_id=   (annotation linkage summary)
```

---

## Frontend Components

### New Files
```
frontend/src/components/admin/
├── AdminLayout.jsx          # Admin shell with sidebar nav
├── HierarchyManager.jsx     # Tree view for concession→platform
├── SystemManager.jsx        # Systems CRUD for selected platform
├── PnidManager.jsx          # P&ID drawings CRUD
├── LineManager.jsx          # Line list with import/export
├── EquipmentManager.jsx     # Equipment list with import/export
├── InstrumentManager.jsx    # Instrument list with import/export
├── LinkageDashboard.jsx     # Annotation linkage overview
├── CsvUploadModal.jsx       # Reusable CSV upload dialog
└── AdminFormModal.jsx       # Reusable add/edit form modal
```

### New Hooks
```
frontend/src/hooks/useAdminApi.js   # React Query mutations for all admin CRUD
```

---

## Implementation Order

1. **Backend admin routes** — hierarchy CRUD, then entity CRUD, then import/export
2. **Frontend admin layout** — toggle between main view and admin
3. **Hierarchy manager** — tree + CRUD forms
4. **Entity managers** — tables with add/edit/delete + CSV
5. **Linkage dashboard** — annotation status tracking
