/**
 * Web Worker for async ELK layout computation.
 *
 * Offloads the ELK layout calculation to a background thread so the
 * main UI thread remains responsive. Critical for graphs with 30+ nodes
 * where ELK computation can take 100-500ms.
 *
 * Usage: import as `new Worker(new URL('./layoutWorker.js', import.meta.url))`
 * Post message: { nodes, edges, options }
 * Receives message: { nodes, edges } | { error }
 */

import ELKModule from 'elkjs/lib/elk.bundled.js';

// Handle CJS/ESM interop — Vite production worker bundles may wrap the CJS export
const ELKConstructor = typeof ELKModule === 'function' ? ELKModule : (ELKModule?.default || ELKModule);
const elk = new ELKConstructor();

// Default dimensions matching elkLayout.js
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;

// Per-type node dimensions — must match elkLayout.js
const NODE_DIMENSIONS = {
  equipment:      { width: 120, height: 100 },
  instrument:     { width: 50,  height: 60  },
  tee:            { width: 14,  height: 14  },
  gateway:        { width: 90,  height: 40  },
  collapsedGroup: { width: 220, height: 120 },
};

// ELK layout options — must match elkLayout.js ELK_OPTIONS
const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '60',
  'elk.spacing.edgeEdge': '20',
  'elk.spacing.edgeNode': '30',
  'elk.layered.spacing.nodeNodeBetweenLayers': '150',
  'elk.layered.spacing.edgeNodeBetweenLayers': '40',
  'elk.portConstraints': 'FIXED_SIDE',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

/**
 * Build ELK graph from serialized React Flow data.
 */
function buildElkGraph(nodes, edges, options) {
  const hasInstruments = nodes.some((n) => n.type === 'instrument');

  const children = nodes.map((node) => {
    const props = {
      'elk.portConstraints': 'FIXED_SIDE',
    };
    // Place instruments in a separate partition below main equipment
    if (hasInstruments) {
      props['elk.partitioning.partition'] = node.type === 'instrument' ? '1' : '0';
    }
    const dims = NODE_DIMENSIONS[node.type] || {};
    return {
      id: node.id,
      width: node.width || dims.width || DEFAULT_NODE_WIDTH,
      height: node.height || dims.height || DEFAULT_NODE_HEIGHT,
      ports: [
        { id: `${node.id}-in`, properties: { 'port.side': 'WEST' } },
        { id: `${node.id}-out`, properties: { 'port.side': 'EAST' } },
      ],
      properties: props,
    };
  });

  const elkEdges = edges.map((edge) => ({
    id: edge.id,
    sources: [`${edge.source}-out`],
    targets: [`${edge.target}-in`],
  }));

  const mergedOptions = { ...ELK_OPTIONS, ...options };
  if (hasInstruments) {
    mergedOptions['elk.partitioning.activate'] = 'true';
  }

  return {
    id: 'root',
    properties: mergedOptions,
    children,
    edges: elkEdges,
  };
}

/**
 * Apply ELK positions back to React Flow format.
 */
function applyLayout(elkGraph, originalNodes, originalEdges) {
  const posMap = new Map();
  for (const child of elkGraph.children || []) {
    posMap.set(child.id, { x: child.x, y: child.y });
  }

  const nodes = originalNodes.map((node) => {
    const pos = posMap.get(node.id);
    if (!pos) return node;
    return { ...node, position: { x: pos.x, y: pos.y } };
  });

  const edges = originalEdges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    pathOptions: { borderRadius: 8 },
  }));

  return { nodes, edges };
}

// ELK stress options for hinted layout
const ELK_STRESS_OPTIONS = {
  'elk.algorithm': 'stress',
  'elk.stress.desiredEdgeLength': '150',
  'elk.spacing.nodeNode': '60',
  'elk.spacing.edgeEdge': '20',
  'elk.spacing.edgeNode': '30',
};

/**
 * Build ELK graph with position hints (stress algorithm).
 */
function buildHintedElkGraph(nodes, edges) {
  const nodeIds = new Set(nodes.map(n => n.id));

  const children = nodes.map((node) => {
    const dims = NODE_DIMENSIONS[node.type] || {};
    const child = {
      id: node.id,
      width: node.width || dims.width || DEFAULT_NODE_WIDTH,
      height: node.height || dims.height || DEFAULT_NODE_HEIGHT,
      ports: [
        { id: `${node.id}-in`, properties: { 'port.side': 'WEST' } },
        { id: `${node.id}-out`, properties: { 'port.side': 'EAST' } },
      ],
      properties: {},
    };

    // Apply position hints as initial coordinates
    if (node.hintX !== undefined && node.hintY !== undefined) {
      child.x = node.hintX;
      child.y = node.hintY;
    }

    return child;
  });

  const elkEdges = edges
    .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((edge) => ({
      id: edge.id,
      sources: [`${edge.source}-out`],
      targets: [`${edge.target}-in`],
    }));

  return {
    id: 'root',
    properties: { ...ELK_STRESS_OPTIONS },
    children,
    edges: elkEdges,
  };
}

// Handle messages from main thread
self.onmessage = async (event) => {
  const { nodes, edges, options = {}, type } = event.data;

  try {
    let elkGraph;
    if (type === 'hinted') {
      elkGraph = buildHintedElkGraph(nodes, edges);
    } else {
      elkGraph = buildElkGraph(nodes, edges, options);
    }
    const layoutResult = await elk.layout(elkGraph);
    const result = applyLayout(layoutResult, nodes, edges);
    self.postMessage(result);
  } catch (error) {
    self.postMessage({ error: error.message || 'ELK layout failed' });
  }
};
