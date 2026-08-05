import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

const useAnnotationWorkspace = create(
  immer((set, get) => ({
    // P&ID selection
    selectedPnidId: null,
    selectedPnidInfo: null, // { id, drawingNumber, title }

    // Tag selection
    selectedEntityId: null,
    selectedEntityType: null, // 'equipment' | 'instrument' | 'line'

    // Search
    searchQuery: '',
    searchScope: 'current', // 'current' | 'platform'
    filterChips: [], // [{ type: 'entityType', value: 'equipment', label: 'Equipment' }]

    // Tag list filters
    tagFilter: 'all', // 'all' | 'positioned' | 'unpositioned' | 'ai' | 'manual'
    systemFilter: null, // system ID
    sortBy: 'tag', // 'tag' | 'type' | 'status' | 'confidence'
    expandedSections: { lines: true, equipment: true, instruments: true },

    // Workspace mode
    placementMode: false, // true when placing an unpositioned entity
    placementEntity: null, // { id, type, tag } — entity being placed
    drawMode: false, // true when drafting annotation geometry
    activeTool: 'rectangle', // rectangle | circle | diamond | pin | line
    draftEntity: null, // { id, type, tag } when drafting for a specific tag

    // Canvas interaction
    highlightEntityId: null, // entity ID to highlight/pulse on canvas
    panToEntity: null, // { xPct, yPct } — triggers canvas pan
    selectedAnnotationIds: new Set(),
    multiSelectMode: false,

    // Display mode for overlay: 'both' | 'shapes' | 'text'
    overlayDisplayMode: 'both',

    // Properties panel
    propertiesPanelOpen: true,
    tagListPanelOpen: true,

    // Actions
    selectPnid: (pnidId, pnidInfo) => set(state => {
      state.selectedPnidId = pnidId;
      state.selectedPnidInfo = pnidInfo;
      state.selectedEntityId = null;
      state.selectedEntityType = null;
      state.highlightEntityId = null;
      state.panToEntity = null;
      state.selectedAnnotationIds = new Set();
      state.drawMode = false;
      state.draftEntity = null;
    }),

    selectEntity: (entityId, entityType) => set(state => {
      state.selectedEntityId = entityId;
      state.selectedEntityType = entityType;
      state.selectedAnnotationIds = new Set();
    }),

    deselectEntity: () => set(state => {
      state.selectedEntityId = null;
      state.selectedEntityType = null;
    }),

    setSearchQuery: (query) => set(state => {
      state.searchQuery = query;
    }),

    setSearchScope: (scope) => set(state => {
      state.searchScope = scope;
    }),

    addFilterChip: (chip) => set(state => {
      if (!state.filterChips.find(c => c.type === chip.type && c.value === chip.value)) {
        state.filterChips.push(chip);
      }
    }),

    removeFilterChip: (type, value) => set(state => {
      state.filterChips = state.filterChips.filter(c => !(c.type === type && c.value === value));
    }),

    clearFilterChips: () => set(state => {
      state.filterChips = [];
    }),

    setTagFilter: (filter) => set(state => {
      state.tagFilter = filter;
    }),

    setSystemFilter: (systemId) => set(state => {
      state.systemFilter = systemId;
    }),

    setSortBy: (sortBy) => set(state => {
      state.sortBy = sortBy;
    }),

    toggleSection: (section) => set(state => {
      state.expandedSections[section] = !state.expandedSections[section];
    }),

    enterPlacementMode: (entity) => set(state => {
      state.placementMode = true;
      state.placementEntity = entity;
      state.drawMode = false;
      state.draftEntity = null;
    }),

    exitPlacementMode: () => set(state => {
      state.placementMode = false;
      state.placementEntity = null;
    }),

    setDrawMode: (enabled, draftEntity = null) => set(state => {
      state.drawMode = enabled;
      state.draftEntity = draftEntity;
      if (enabled) {
        state.placementMode = false;
        state.placementEntity = null;
      }
    }),

    setActiveTool: (tool) => set(state => {
      state.activeTool = tool;
    }),

    setMultiSelectMode: (enabled) => set(state => {
      state.multiSelectMode = enabled;
      if (!enabled) state.selectedAnnotationIds = new Set();
    }),

    clearSelection: () => set(state => {
      state.selectedAnnotationIds = new Set();
    }),

    setSelectedAnnotationIds: (ids) => set(state => {
      state.selectedAnnotationIds = new Set(ids || []);
      if (state.selectedAnnotationIds.size > 0) {
        state.selectedEntityId = null;
        state.selectedEntityType = null;
      }
    }),

    toggleAnnotationSelection: (annotationId, additive = false) => set(state => {
      const next = additive ? new Set(state.selectedAnnotationIds) : new Set();
      if (next.has(annotationId)) next.delete(annotationId);
      else next.add(annotationId);
      state.selectedAnnotationIds = next;
      state.multiSelectMode = next.size > 1;
      if (next.size > 0) {
        state.selectedEntityId = null;
        state.selectedEntityType = null;
      }
    }),

    selectByType: (entityType, annotations = []) => set(state => {
      const ids = annotations
        .filter(a => a.linkedEntityType === entityType)
        .map(a => a.id);
      state.selectedAnnotationIds = new Set(ids);
      state.multiSelectMode = ids.length > 1;
    }),

    selectByState: (stateKey, annotations = []) => set(state => {
      const ids = annotations
        .filter(a => {
          if (stateKey === 'draft') return a.approvalStatus !== 'approved';
          if (stateKey === 'approved') return a.approvalStatus === 'approved';
          return true;
        })
        .map(a => a.id);
      state.selectedAnnotationIds = new Set(ids);
      state.multiSelectMode = ids.length > 1;
    }),

    highlightEntity: (entityId, position) => set(state => {
      state.highlightEntityId = entityId;
      state.panToEntity = position;
    }),

    clearHighlight: () => set(state => {
      state.highlightEntityId = null;
      state.panToEntity = null;
    }),

    togglePropertiesPanel: () => set(state => {
      state.propertiesPanelOpen = !state.propertiesPanelOpen;
    }),

    toggleTagListPanel: () => set(state => {
      state.tagListPanelOpen = !state.tagListPanelOpen;
    }),

    setOverlayDisplayMode: (mode) => set(state => {
      state.overlayDisplayMode = mode;
    }),
  }))
);

export default useAnnotationWorkspace;
