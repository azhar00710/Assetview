/**
 * useCanvasStore — Zustand store for all canvas state.
 * Single source of truth: view, selection, tracing, overlays, layout, data.
 * No API calls in store — those happen in hooks.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

enableMapSet();

const useCanvasStore = create(
  immer((set, get) => ({
    // === VIEW STATE ===
    zoomLevel: 'SYSTEM',
    viewport: { x: 0, y: 0, zoom: 1 },
    activeSystemId: null,
    activePlatformId: null,

    // === DATA STATE ===
    nodes: [],
    edges: [],

    // === SELECTION STATE ===
    selectedNodeIds: new Set(),
    hoveredNodeId: null,

    // === TRACING STATE ===
    traceResult: null,
    traceMode: null,

    // === OVERLAY STATE ===
    activeOverlays: new Set(),
    overlayData: {},

    // === ISOLATION RESULT STATE ===
    isolationResult: null,

    // === CROSS-SYSTEM VISIBILITY ===
    visibleCrossSystems: [],

    // === CONTEXT MENU STATE ===
    contextMenu: null,

    // === X-REF STATE ===
    xrefEnabled: false,

    // === FILTER STATE (canvas search) ===
    filterState: { line: null, equipmentType: null, criticality: null },

    // === LINE HIGHLIGHT STATE ===
    hoveredLineId: null,
    selectedLineId: null,
    lineColorMode: false,

    // === DRAFTING STATE ===
    isDrafting: false,

    // === SELECTED NODE (detail panel) ===
    selectedNode: null,

    // === LAYOUT STATE ===
    layoutMode: 'auto',
    layoutReady: false,
    pinnedNodeIds: new Set(),

    // === ACTIONS ===

    setSystem: (systemId) =>
      set((state) => {
        state.activeSystemId = systemId;
        state.selectedNodeIds = new Set();
        state.hoveredNodeId = null;
        state.traceResult = null;
        state.traceMode = null;
      }),

    selectNode: (nodeId) =>
      set((state) => {
        state.selectedNodeIds = new Set([nodeId]);
      }),

    toggleNode: (nodeId) =>
      set((state) => {
        const next = new Set(state.selectedNodeIds);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        state.selectedNodeIds = next;
      }),

    deselectAll: () =>
      set((state) => {
        state.selectedNodeIds = new Set();
        state.hoveredNodeId = null;
      }),

    setHoveredNode: (nodeId) =>
      set((state) => {
        state.hoveredNodeId = nodeId;
      }),

    startTrace: (nodeId, direction) =>
      set((state) => {
        state.traceMode = direction;
        state.traceResult = { startNodeId: nodeId, direction, path: [], boundary: [] };
      }),

    setTraceResult: (result) =>
      set((state) => {
        state.traceResult = result;
      }),

    clearTrace: () =>
      set((state) => {
        state.traceResult = null;
        state.traceMode = null;
        state.visibleCrossSystems = [];
      }),

    setIsolationResult: (result) =>
      set((state) => {
        state.isolationResult = result;
      }),

    clearIsolation: () =>
      set((state) => {
        state.isolationResult = null;
      }),

    setVisibleCrossSystems: (systemIds) =>
      set((state) => {
        state.visibleCrossSystems = systemIds;
      }),

    setContextMenu: (menu) =>
      set((state) => {
        state.contextMenu = menu;
      }),

    clearContextMenu: () =>
      set((state) => {
        state.contextMenu = null;
      }),

    toggleOverlay: (name) =>
      set((state) => {
        const next = new Set(state.activeOverlays);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        state.activeOverlays = next;
      }),

    setOverlayData: (name, data) =>
      set((state) => {
        state.overlayData[name] = data;
      }),

    updateNodePosition: (nodeId, position) =>
      set((state) => {
        const node = state.nodes.find((n) => n.id === nodeId);
        if (node) {
          node.position = position;
        }
      }),

    setZoomLevel: (level) =>
      set((state) => {
        state.zoomLevel = level;
      }),

    setViewport: (viewport) =>
      set((state) => {
        state.viewport = viewport;
      }),

    setTopologyData: (nodes, edges) =>
      set((state) => {
        state.nodes = nodes;
        state.edges = edges;
        state.layoutReady = true;
      }),

    setLayoutMode: (mode) =>
      set((state) => {
        state.layoutMode = mode;
      }),

    setLayoutReady: (ready) =>
      set((state) => {
        state.layoutReady = ready;
      }),

    toggleXref: () =>
      set((state) => {
        state.xrefEnabled = !state.xrefEnabled;
      }),

    setFilterState: (filters) =>
      set((state) => {
        state.filterState = { ...state.filterState, ...filters };
      }),

    setSelectedNode: (node) =>
      set((state) => {
        state.selectedNode = node;
      }),

    clearSelectedNode: () =>
      set((state) => {
        state.selectedNode = null;
      }),

    // Line highlighting
    setHoveredLine: (lineId) =>
      set((state) => {
        state.hoveredLineId = lineId;
      }),

    selectLine: (lineId) =>
      set((state) => {
        state.selectedLineId = lineId;
      }),

    clearLine: () =>
      set((state) => {
        state.hoveredLineId = null;
        state.selectedLineId = null;
      }),

    toggleLineColorMode: () =>
      set((state) => {
        state.lineColorMode = !state.lineColorMode;
      }),

    // Drafting
    setDrafting: (isDrafting) =>
      set((state) => {
        state.isDrafting = isDrafting;
      }),

    // Pin node (layout persistence)
    togglePinNode: (nodeId) =>
      set((state) => {
        const next = new Set(state.pinnedNodeIds);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        state.pinnedNodeIds = next;
      }),
  }))
);

// === SELECTORS ===
export const useZoomLevel = () => useCanvasStore((s) => s.zoomLevel);
export const useViewport = () => useCanvasStore((s) => s.viewport);
export const useActiveSystemId = () => useCanvasStore((s) => s.activeSystemId);
export const useActivePlatformId = () => useCanvasStore((s) => s.activePlatformId);
export const useNodes = () => useCanvasStore((s) => s.nodes);
export const useEdges = () => useCanvasStore((s) => s.edges);
export const useSelectedNodeIds = () => useCanvasStore((s) => s.selectedNodeIds);
export const useHoveredNodeId = () => useCanvasStore((s) => s.hoveredNodeId);
export const useTraceResult = () => useCanvasStore((s) => s.traceResult);
export const useTraceMode = () => useCanvasStore((s) => s.traceMode);
export const useActiveOverlays = () => useCanvasStore((s) => s.activeOverlays);
export const useOverlayData = () => useCanvasStore((s) => s.overlayData);
export const useLayoutMode = () => useCanvasStore((s) => s.layoutMode);
export const useLayoutReady = () => useCanvasStore((s) => s.layoutReady);
export const useXrefEnabled = () => useCanvasStore((s) => s.xrefEnabled);
export const useFilterState = () => useCanvasStore((s) => s.filterState);
export const useSelectedNode = () => useCanvasStore((s) => s.selectedNode);
export const useHoveredLineId = () => useCanvasStore((s) => s.hoveredLineId);
export const useSelectedLineId = () => useCanvasStore((s) => s.selectedLineId);
export const useLineColorMode = () => useCanvasStore((s) => s.lineColorMode);
export const useIsDrafting = () => useCanvasStore((s) => s.isDrafting);
export const useIsolationResult = () => useCanvasStore((s) => s.isolationResult);
export const useVisibleCrossSystems = () => useCanvasStore((s) => s.visibleCrossSystems);
export const useContextMenu = () => useCanvasStore((s) => s.contextMenu);
export const usePinnedNodeIds = () => useCanvasStore((s) => s.pinnedNodeIds);

export default useCanvasStore;
