/**
 * SelectionContract — events emitted by the canvas via SelectionBus.
 * Other modules (P&ID Viewer, Miller Columns, AI Panel) subscribe to these.
 */

/** @enum {string} Selection event types */
export const SelectionEvent = {
  ENTITY_SELECT: 'entity:select',
  ENTITY_DESELECT: 'entity:deselect',
  ENTITY_HOVER: 'entity:hover',
  SYSTEM_SELECT: 'system:select',
  TRACE_COMPLETE: 'trace:complete',
  OVERLAY_CHANGE: 'overlay:change',
};

/** @enum {string} Entity types that can be selected */
export const EntityType = {
  EQUIPMENT: 'equipment',
  LINE: 'line',
  INSTRUMENT: 'instrument',
  SYSTEM: 'system',
};

/** @enum {string} Source of the selection event */
export const SelectionSource = {
  CANVAS_2D: '2d-canvas',
  MILLER_COLUMNS: 'miller-columns',
  PNID_VIEWER: 'pnid-viewer',
  AI_PANEL: 'ai-panel',
  SEARCH: 'search',
};

/**
 * @typedef {Object} SelectionContext
 * @property {string} systemId - UUID of the owning system
 * @property {string} systemCode - System code (e.g. 'PV019')
 * @property {string[]} lineIds - Connected line UUIDs
 * @property {string[]} pnidIds - P&IDs this entity appears on
 */

/**
 * @typedef {Object} EntitySelectPayload
 * @property {string} entityId - UUID of the selected entity
 * @property {string} entityType - One of EntityType values
 * @property {string} entityTag - Human-readable tag (e.g. 'PV019-XT')
 * @property {string} source - One of SelectionSource values
 * @property {SelectionContext} context
 */

/**
 * @typedef {Object} EntityDeselectPayload
 * @property {string} entityId
 * @property {string} source
 */

/**
 * @typedef {Object} TraceCompletePayload
 * @property {string} startEntityId
 * @property {string} direction - 'upstream' | 'downstream' | 'isolation'
 * @property {string[]} pathEntityIds
 */

/**
 * @typedef {Object} OverlayChangePayload
 * @property {string} overlayName
 * @property {boolean} active
 * @property {Object} data
 */
