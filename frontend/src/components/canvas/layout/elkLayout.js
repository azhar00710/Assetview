/**
 * ELK Layout Engine for System Topology Canvas.
 *
 * Uses Eclipse Layout Kernel (elkjs) to compute orthogonal, layered layouts
 * for equipment topology graphs. Implements Sugiyama-style horizontal spine
 * with orthogonal edge routing (insights N1, N2, N21 from implementation plan).
 *
 * Port-based routing (N4): equipment nodes define inlet/outlet ports for
 * clean edge connection points.
 */

import ELK from 'elkjs/lib/elk.bundled.js';

// Default node dimensions
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;

// Per-type node dimensions for accurate ELK layout
const NODE_DIMENSIONS = {
  equipment:      { width: 120, height: 100 },
  instrument:     { width: 50,  height: 60  },
  tee:            { width: 14,  height: 14  },
  gateway:        { width: 90,  height: 40  },
  collapsedGroup: { width: 220, height: 120 },
};

// ELK layout options for P&ID-style orthogonal layout
const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  // Kandinsky-aware settings (N21): minimize crossings, orthogonal bends
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.edgeRouting': 'ORTHOGONAL',
  // Spacing tuned for P&ID readability
  'elk.spacing.nodeNode': '60',
  'elk.spacing.edgeEdge': '20',
  'elk.spacing.edgeNode': '30',
  'elk.layered.spacing.nodeNodeBetweenLayers': '150',
  'elk.layered.spacing.edgeNodeBetweenLayers': '40',
  // Port-based routing (N4)
  'elk.portConstraints': 'FIXED_SIDE',
  // Ensure consistent left-to-right flow
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

/**
 * Convert React Flow nodes/edges into ELK graph format.
 *
 * @param {object[]} rfNodes - React Flow nodes from topology API
 * @param {object[]} rfEdges - React Flow edges from topology API
 * @returns {object} ELK graph input
 */
function toElkGraph(rfNodes, rfEdges) {
  const hasInstruments = rfNodes.some((n) => n.type === 'instrument');

  const children = rfNodes.map((node) => {
    const dims = NODE_DIMENSIONS[node.type] || {};
    const width = node.width || node.data?.width || dims.width || DEFAULT_NODE_WIDTH;
    const height = node.height || node.data?.height || dims.height || DEFAULT_NODE_HEIGHT;

    const props = {
      'elk.portConstraints': 'FIXED_SIDE',
    };
    // Place instruments in a separate partition below main equipment
    if (hasInstruments) {
      props['elk.partitioning.partition'] = node.type === 'instrument' ? '1' : '0';
    }

    return {
      id: node.id,
      width,
      height,
      ports: [
        { id: `${node.id}-in`, properties: { 'port.side': 'WEST' } },
        { id: `${node.id}-out`, properties: { 'port.side': 'EAST' } },
      ],
      properties: props,
    };
  });

  // Only include edges whose source AND target nodes exist in the graph
  const nodeIds = new Set(children.map((c) => c.id));
  const edges = rfEdges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      sources: [`${edge.source}-out`],
      targets: [`${edge.target}-in`],
    }));

  const layoutOptions = { ...ELK_OPTIONS };
  if (hasInstruments) {
    layoutOptions['elk.partitioning.activate'] = 'true';
  }

  return {
    id: 'root',
    properties: layoutOptions,
    children,
    edges,
  };
}

/**
 * Apply ELK layout positions back to React Flow nodes and extract edge routes.
 *
 * @param {object} elkGraph - Computed ELK graph with positions
 * @param {object[]} rfNodes - Original React Flow nodes
 * @param {object[]} rfEdges - Original React Flow edges
 * @returns {{ nodes: object[], edges: object[] }} Updated React Flow data
 */
function fromElkGraph(elkGraph, rfNodes, rfEdges) {
  // Build position map from ELK output
  const posMap = new Map();
  for (const child of elkGraph.children || []) {
    posMap.set(child.id, { x: child.x, y: child.y });
  }

  // Build edge route map from ELK output
  const routeMap = new Map();
  for (const edge of elkGraph.edges || []) {
    if (edge.sections && edge.sections.length > 0) {
      const section = edge.sections[0];
      const points = [];
      if (section.startPoint) points.push(section.startPoint);
      if (section.bendPoints) points.push(...section.bendPoints);
      if (section.endPoint) points.push(section.endPoint);
      routeMap.set(edge.id, points);
    }
  }

  // Update node positions
  const nodes = rfNodes.map((node) => {
    const pos = posMap.get(node.id);
    if (!pos) return node;
    return { ...node, position: { x: pos.x, y: pos.y } };
  });

  // Update edge styles — keep original styling but mark as orthogonal
  const edges = rfEdges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    pathOptions: { borderRadius: 8 },
  }));

  return { nodes, edges };
}

/**
 * Compute ELK layout for React Flow nodes and edges.
 * This is the main entry point.
 *
 * @param {object[]} rfNodes - React Flow nodes
 * @param {object[]} rfEdges - React Flow edges
 * @param {object} [options] - Override ELK options
 * @returns {Promise<{ nodes: object[], edges: object[] }>}
 */
export async function computeElkLayout(rfNodes, rfEdges, options = {}) {
  if (!rfNodes || rfNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const elk = new ELK();
  const elkGraph = toElkGraph(rfNodes, rfEdges);

  // Merge any option overrides
  if (Object.keys(options).length > 0) {
    elkGraph.properties = { ...elkGraph.properties, ...options };
  }

  const layoutGraph = await elk.layout(elkGraph);
  return fromElkGraph(layoutGraph, rfNodes, rfEdges);
}

/**
 * Serialize layout input for transfer to web worker.
 */
export function serializeLayoutInput(rfNodes, rfEdges, options = {}) {
  return {
    nodes: rfNodes.map((n) => {
      const dims = NODE_DIMENSIONS[n.type] || {};
      return {
        id: n.id,
        width: n.width || n.data?.width || dims.width || DEFAULT_NODE_WIDTH,
        height: n.height || n.data?.height || dims.height || DEFAULT_NODE_HEIGHT,
        data: n.data,
        type: n.type,
        style: n.style,
      };
    }),
    edges: rfEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      style: e.style,
      animated: e.animated,
    })),
    options,
  };
}

// ── Hinted (constrained) layout using ELK stress algorithm ──

// ELK stress options — force-directed layout that respects initial positions
const ELK_STRESS_OPTIONS = {
  'elk.algorithm': 'stress',
  'elk.stress.desiredEdgeLength': '150',
  'elk.spacing.nodeNode': '60',
  'elk.spacing.edgeEdge': '20',
  'elk.spacing.edgeNode': '30',
};

/**
 * Compute ELK layout with position hints from PDF annotations.
 * Uses the stress (force-directed) algorithm which respects initial positions.
 * Nodes with hints get fixed initial positions; unhinted nodes are auto-placed.
 *
 * @param {object[]} rfNodes - React Flow nodes
 * @param {object[]} rfEdges - React Flow edges
 * @param {Map<string, {x: number, y: number}>} hints - entityId → {x, y} position hints
 * @returns {Promise<{ nodes: object[], edges: object[] }>}
 */
export async function computeHintedElkLayout(rfNodes, rfEdges, hints) {
  if (!rfNodes || rfNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const elk = new ELK();

  const nodeIds = new Set(rfNodes.map(n => n.id));
  const children = rfNodes.map((node) => {
    const dims = NODE_DIMENSIONS[node.type] || {};
    const width = node.width || node.data?.width || dims.width || DEFAULT_NODE_WIDTH;
    const height = node.height || node.data?.height || dims.height || DEFAULT_NODE_HEIGHT;

    const hint = hints.get(node.id);
    const props = {};

    // If hint exists, set initial position for stress layout
    const child = {
      id: node.id,
      width,
      height,
      ports: [
        { id: `${node.id}-in`, properties: { 'port.side': 'WEST' } },
        { id: `${node.id}-out`, properties: { 'port.side': 'EAST' } },
      ],
      properties: props,
    };

    if (hint) {
      child.x = hint.x;
      child.y = hint.y;
    }

    return child;
  });

  const edges = rfEdges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      sources: [`${edge.source}-out`],
      targets: [`${edge.target}-in`],
    }));

  const elkGraph = {
    id: 'root',
    properties: { ...ELK_STRESS_OPTIONS },
    children,
    edges,
  };

  const layoutGraph = await elk.layout(elkGraph);
  return fromElkGraph(layoutGraph, rfNodes, rfEdges);
}

/**
 * Serialize hinted layout input for web worker.
 */
export function serializeHintedLayoutInput(rfNodes, rfEdges, hints) {
  return {
    type: 'hinted',
    nodes: rfNodes.map((n) => {
      const dims = NODE_DIMENSIONS[n.type] || {};
      const hint = hints.get(n.id);
      return {
        id: n.id,
        width: n.width || n.data?.width || dims.width || DEFAULT_NODE_WIDTH,
        height: n.height || n.data?.height || dims.height || DEFAULT_NODE_HEIGHT,
        data: n.data,
        type: n.type,
        style: n.style,
        hintX: hint?.x,
        hintY: hint?.y,
      };
    }),
    edges: rfEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      style: e.style,
      animated: e.animated,
    })),
  };
}

export { ELK_OPTIONS, ELK_STRESS_OPTIONS, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT };
