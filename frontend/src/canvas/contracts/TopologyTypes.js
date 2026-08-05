/**
 * TopologyTypes — data shape definitions for canvas nodes, edges, and overlays.
 * All topology data flowing through the canvas must conform to these shapes.
 */

/** @enum {string} Node types rendered on the canvas */
export const NodeType = {
  EQUIPMENT: 'equipment',
  INSTRUMENT: 'instrument',
  COLLAPSED_GROUP: 'collapsedGroup',
  GATEWAY: 'gateway',
  TEE: 'tee',
  HEADER: 'header',
};

/** @enum {string} Edge types rendered on the canvas */
export const EdgeType = {
  PIPE: 'pipe',
  SIGNAL: 'signal',
  BOUNDARY: 'boundary',
  UTILITY: 'utility',
};

/** @enum {string} Visual states for nodes and edges */
export const VisualState = {
  DEFAULT: 'default',
  SELECTED: 'selected',
  HIGHLIGHTED: 'highlighted',
  DIMMED: 'dimmed',
  XREF: 'xref',
};

/** @enum {string} Semantic zoom levels */
export const ZoomLevel = {
  OVERVIEW: 'OVERVIEW',
  SYSTEM: 'SYSTEM',
  DETAIL: 'DETAIL',
};

/** @enum {string} Layout computation modes */
export const LayoutMode = {
  AUTO: 'auto',
  MANUAL: 'manual',
  PERSISTED: 'persisted',
};

/**
 * @typedef {Object} TopologyNode - React Flow node shape
 * @property {string} id - UUID
 * @property {string} type - One of NodeType values
 * @property {{ x: number, y: number }} position
 * @property {Object} data
 * @property {string} data.tag - Human-readable tag
 * @property {string} data.label - Display label
 * @property {string} data.systemId - Owning system UUID
 * @property {string} data.systemCode - Owning system code
 * @property {string} [data.equipmentType] - Valve, vessel, pump, etc.
 * @property {string} [data.criticality] - high | medium | low
 * @property {string} [data.visualState] - One of VisualState values
 */

/**
 * @typedef {Object} TopologyEdge - React Flow edge shape
 * @property {string} id - UUID
 * @property {string} source - Source node ID
 * @property {string} target - Target node ID
 * @property {string} type - One of EdgeType values
 * @property {Object} data
 * @property {string} [data.lineTag] - Line tag (e.g. '4"-PV019-001')
 * @property {string} [data.nominalSize] - Pipe size
 * @property {string} [data.visualState] - One of VisualState values
 */
