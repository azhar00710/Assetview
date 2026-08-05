/**
 * AIToolInterface — defines what the AI assistant (Claude) can read from
 * and do to the canvas. All AI actions go through the Zustand store.
 */

/** @enum {string} AI read operations */
export const AIReadOperation = {
  /** Compact JSON summary of nodes/edges/active overlays */
  GET_CANVAS_SUMMARY: 'getCanvasSummary',
  /** Currently selected entities */
  GET_SELECTED_ENTITIES: 'getSelectedEntities',
  /** Active trace result (if any) */
  GET_ACTIVE_TRACE: 'getActiveTrace',
  /** Only what's currently rendered in viewport */
  GET_VISIBLE_SUBGRAPH: 'getVisibleSubgraph',
};

/** @enum {string} AI write operations */
export const AIWriteOperation = {
  /** Visually highlight a set of entities */
  HIGHLIGHT_ENTITIES: 'highlightEntities',
  /** Trigger upstream/downstream trace */
  START_TRACE: 'startTrace',
  /** Compute and show isolation boundary */
  SHOW_ISOLATION: 'showIsolation',
  /** Remove all overlays */
  CLEAR_OVERLAYS: 'clearOverlays',
  /** Pan/zoom to a specific entity */
  FOCUS_ENTITY: 'focusEntity',
  /** Add a temporary text label to an entity */
  ANNOTATE_ENTITY: 'annotateEntity',
};

/**
 * @typedef {Object} AIHighlightParams
 * @property {string[]} entityIds - UUIDs to highlight
 * @property {string} color - CSS color
 */

/**
 * @typedef {Object} AITraceParams
 * @property {string} entityId - Start node UUID
 * @property {'upstream'|'downstream'} direction
 */

/**
 * @typedef {Object} AIIsolationParams
 * @property {string} equipmentId - Target equipment UUID
 */

/**
 * @typedef {Object} AIFocusParams
 * @property {string} entityId - UUID to focus on
 */

/**
 * @typedef {Object} AIAnnotateParams
 * @property {string} entityId - UUID to annotate
 * @property {string} text - Annotation text
 */

/**
 * @typedef {Object} AICanvasSummary
 * @property {string} systemId - Active system UUID
 * @property {number} nodeCount - Total nodes rendered
 * @property {number} edgeCount - Total edges rendered
 * @property {string[]} activeOverlays - Active overlay names
 * @property {string[]} selectedEntityIds - Selected entity UUIDs
 * @property {string|null} traceMode - Current trace mode
 */
