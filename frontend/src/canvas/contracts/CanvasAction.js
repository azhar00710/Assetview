/**
 * CanvasAction — commands that external modules dispatch TO the canvas.
 * P&ID Viewer, AI Panel, and Miller Sidebar use these to control the canvas.
 */

/** @enum {string} Canvas action types */
export const CanvasActionType = {
  /** Pan/zoom to a specific entity */
  FOCUS_ENTITY: 'FOCUS_ENTITY',
  /** Highlight a set of entities with a color */
  HIGHLIGHT: 'HIGHLIGHT',
  /** Start upstream/downstream trace from entity */
  START_TRACE: 'START_TRACE',
  /** Show an overlay (isolation, corrosion, etc.) */
  SHOW_OVERLAY: 'SHOW_OVERLAY',
  /** Remove all active overlays */
  CLEAR_OVERLAYS: 'CLEAR_OVERLAYS',
  /** Switch to a different system */
  SET_SYSTEM: 'SET_SYSTEM',
};

/**
 * @typedef {Object} FocusEntityPayload
 * @property {string} entityId - UUID of the entity to focus
 * @property {boolean} zoom - Whether to zoom in on the entity
 */

/**
 * @typedef {Object} HighlightPayload
 * @property {string[]} entityIds - UUIDs to highlight
 * @property {string} color - CSS color for highlight
 * @property {number} [duration] - Auto-clear after ms (0 = permanent)
 */

/** @enum {string} Trace directions */
export const TraceDirection = {
  UPSTREAM: 'upstream',
  DOWNSTREAM: 'downstream',
  ISOLATION: 'isolation',
};

/**
 * @typedef {Object} StartTracePayload
 * @property {string} entityId
 * @property {string} direction - One of TraceDirection values
 */

/** @enum {string} Overlay types */
export const OverlayType = {
  ISOLATION: 'isolation',
  CORROSION: 'corrosion',
  PERMIT: 'permit',
  SIS: 'sis',
  TRACING: 'tracing',
};

/**
 * @typedef {Object} ShowOverlayPayload
 * @property {string} type - One of OverlayType values
 * @property {Object} data - Overlay-specific data
 */

/**
 * @typedef {Object} SetSystemPayload
 * @property {string} systemId - UUID of the target system
 */
