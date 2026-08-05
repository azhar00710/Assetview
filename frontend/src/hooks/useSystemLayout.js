/**
 * @deprecated This monolithic hook has been split into focused modules:
 *   - canvas/hooks/useTopologyData.js — topology fetching + node/edge building
 *   - canvas/hooks/useLayout.js — ELK layout via Web Worker + persistence
 *   - canvas/hooks/useSemanticZoom.js — zoom-level node/edge filtering
 *   - canvas/layout/layoutPersistence.js — save/load positions to API
 *
 * This file is kept for backward compatibility. New code should import
 * from the split modules above instead.
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { SC } from '../data/constants';

// Zoom level thresholds
export const ZOOM_LEVELS = {
  OVERVIEW: { min: 0, max: 0.45, label: 'Overview' },
  SYSTEM: { min: 0.45, max: 1.2, label: 'System' },
  DETAIL: { min: 1.2, max: 5, label: 'Detail' },
};

export function getZoomLevel(zoom) {
  if (zoom < ZOOM_LEVELS.OVERVIEW.max) return 'OVERVIEW';
  if (zoom < ZOOM_LEVELS.DETAIL.min) return 'SYSTEM';
  return 'DETAIL';
}

const elk = new ELK();

// ELK layout options for orthogonal P&ID-style layout
const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '60',
  'elk.layered.spacing.nodeNodeBetweenLayers': '150',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.portConstraints': 'FIXED_SIDE',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

/**
 * Build topology data for a given system from hierarchy data.
 * Uses from_equipment_tag / to_equipment_tag on lines to create directed flow edges.
 * Returns { nodes, edges } for React Flow, plus gateway references.
 */
function buildSystemTopology(systemId, data) {
  const { systems, lines: allLines, equipment: allEquipment, instruments: allInstruments, pnidSystems, pnidLines } = data;
  const system = systems.find(s => s.id === systemId);
  if (!system) return { nodes: [], edges: [], gateways: [] };

  const getSys = (id) => systems.find(s => s.id === id);

  // Equipment in this system
  const equipment = allEquipment.filter(e => e.systemId === systemId);
  // Lines in this system
  const lines = allLines.filter(l => l.systemId === systemId);
  // Instruments in this system
  const instruments = allInstruments.filter(i => i.systemId === systemId);

  // Build tag→equipment lookup (across ALL equipment for cross-system references)
  const tagToEquip = new Map();
  allEquipment.forEach(eq => tagToEquip.set(eq.tag, eq));

  // P&IDs that reference this system
  const pnidRels = pnidSystems.filter(r => r.systemId === systemId);

  // Detect gateway systems from line from/to tags that reference equipment in other systems
  const gatewaySystems = new Map(); // systemId → { tags that connect }

  // Also detect from P&ID cross-refs
  pnidRels.filter(r => r.isPrimary).forEach(rel => {
    pnidSystems.filter(ps => ps.pnidId === rel.pnidId && ps.systemId !== systemId)
      .forEach(ps => {
        if (!gatewaySystems.has(ps.systemId)) gatewaySystems.set(ps.systemId, new Set());
      });
  });

  const nodes = [];
  const edges = [];
  const gateways = [];
  const addedGateways = new Set();

  // Add equipment nodes
  equipment.forEach(eq => {
    nodes.push({
      id: `eq-${eq.id}`,
      type: 'equipment',
      data: {
        tag: eq.tag, eqType: eq.eqType, desc: eq.desc,
        criticality: eq.criticality, sil: eq.sil,
        systemType: system.sysType, systemCode: system.code, lineId: eq.lineId,
      },
      position: { x: 0, y: 0 },
    });
  });

  // Add instrument nodes
  instruments.forEach(inst => {
    nodes.push({
      id: `inst-${inst.id}`,
      type: 'instrument',
      data: {
        tag: inst.tag, iType: inst.iType, desc: inst.desc,
        range: inst.range, scada: inst.scada,
        systemType: system.sysType, lineId: inst.lineId,
      },
      position: { x: 0, y: 0 },
    });
  });

  // Helper: get node ID for an equipment tag (may be in this system or a gateway)
  function getNodeId(tag) {
    if (!tag) return null;
    const eq = tagToEquip.get(tag);
    if (!eq) return null;
    if (eq.systemId === systemId) return `eq-${eq.id}`;
    // Equipment is in another system — create gateway
    if (!addedGateways.has(eq.systemId)) {
      const gs = getSys(eq.systemId);
      if (gs) {
        addedGateways.add(eq.systemId);
        if (!gatewaySystems.has(eq.systemId)) gatewaySystems.set(eq.systemId, new Set());
        gatewaySystems.get(eq.systemId).add(tag);
        const gwNode = {
          id: `gw-${eq.systemId}`,
          type: 'gateway',
          data: {
            targetSystemId: eq.systemId, targetSystemCode: gs.code,
            targetSystemName: gs.name, targetSystemType: gs.sysType,
            color: SC[gs.sysType] || SC.process,
          },
          position: { x: 0, y: 0 },
        };
        gateways.push(gwNode);
        nodes.push(gwNode);
      }
    }
    return `gw-${eq.systemId}`;
  }

  // Build directed edges from line from/to tags
  lines.forEach(line => {
    const lineEquip = equipment.filter(e => e.lineId === line.id);
    const lineInst = instruments.filter(i => i.lineId === line.id);
    const edgeData = { lineName: line.name, size: line.size, service: line.service };

    if (lineEquip.length >= 2) {
      // Chain equipment on the same line in order: first → second → third → ...
      for (let i = 0; i < lineEquip.length - 1; i++) {
        edges.push({
          id: `pipe-${line.id}-${i}`,
          source: `eq-${lineEquip[i].id}`, target: `eq-${lineEquip[i + 1].id}`,
          type: 'pipe', data: edgeData,
        });
      }

      // Connect line's fromTag to first equipment (if fromTag is outside this line's equipment)
      if (line.fromTag && !lineEquip.find(e => e.tag === line.fromTag)) {
        const srcId = getNodeId(line.fromTag);
        if (srcId) {
          edges.push({
            id: `pipe-from-${line.id}`, source: srcId, target: `eq-${lineEquip[0].id}`,
            type: 'pipe', data: edgeData,
          });
        }
      }

      // Connect last equipment to line's toTag (if toTag is outside this line's equipment)
      if (line.toTag && !lineEquip.find(e => e.tag === line.toTag)) {
        const tgtId = getNodeId(line.toTag);
        if (tgtId) {
          edges.push({
            id: `pipe-to-${line.id}`, source: `eq-${lineEquip[lineEquip.length - 1].id}`, target: tgtId,
            type: 'pipe', data: edgeData,
          });
        }
      }
    } else if (lineEquip.length === 1) {
      // Single equipment on line — connect from/to tags
      const eqNodeId = `eq-${lineEquip[0].id}`;

      if (line.fromTag && line.fromTag !== lineEquip[0].tag) {
        const srcId = getNodeId(line.fromTag);
        if (srcId) {
          edges.push({
            id: `pipe-from-${line.id}`, source: srcId, target: eqNodeId,
            type: 'pipe', data: edgeData,
          });
        }
      }

      if (line.toTag && line.toTag !== lineEquip[0].tag) {
        const tgtId = getNodeId(line.toTag);
        if (tgtId) {
          edges.push({
            id: `pipe-to-${line.id}`, source: eqNodeId, target: tgtId,
            type: 'pipe', data: edgeData,
          });
        }
      }
    } else {
      // No equipment on line — connect from/to tags directly
      if (line.fromTag && line.toTag) {
        const srcId = getNodeId(line.fromTag);
        const tgtId = getNodeId(line.toTag);
        if (srcId && tgtId) {
          edges.push({
            id: `pipe-${line.id}`, source: srcId, target: tgtId,
            type: 'pipe', data: edgeData,
          });
        }
      }
    }

    // Connect instruments to the first equipment on their line
    if (lineEquip.length > 0) {
      lineInst.forEach(inst => {
        edges.push({
          id: `signal-${inst.id}`,
          source: `eq-${lineEquip[0].id}`, target: `inst-${inst.id}`,
          type: 'signal', data: { lineName: line.name },
        });
      });
    }
  });

  // Add remaining gateway nodes for systems that share P&IDs but weren't connected via lines
  gatewaySystems.forEach((tags, gsId) => {
    if (addedGateways.has(gsId)) return;
    const gs = getSys(gsId);
    if (!gs) return;
    addedGateways.add(gsId);
    const gwNode = {
      id: `gw-${gsId}`,
      type: 'gateway',
      data: {
        targetSystemId: gsId, targetSystemCode: gs.code,
        targetSystemName: gs.name, targetSystemType: gs.sysType,
        color: SC[gs.sysType] || SC.process,
      },
      position: { x: 0, y: 0 },
    };
    gateways.push(gwNode);
    nodes.push(gwNode);
  });

  return { nodes, edges, gateways };
}

/**
 * Build overview topology: all systems on a platform as collapsed groups.
 */
function buildOverviewTopology(data) {
  const { systems, equipment: allEquipment, lines: allLines, instruments: allInstruments, pnidSystems } = data;
  const nodes = [];
  const edges = [];

  systems.forEach(sys => {
    const eqCount = allEquipment.filter(e => e.systemId === sys.id).length;
    const lineCount = allLines.filter(l => l.systemId === sys.id).length;
    const instCount = allInstruments.filter(i => i.systemId === sys.id).length;
    const pnidCount = pnidSystems.filter(r => r.systemId === sys.id && r.isPrimary).length;

    nodes.push({
      id: `group-${sys.id}`,
      type: 'collapsedGroup',
      data: {
        systemId: sys.id, systemCode: sys.code, systemName: sys.name,
        systemType: sys.sysType, color: SC[sys.sysType] || SC.process,
        eqCount, lineCount, instCount, pnidCount,
      },
      position: { x: 0, y: 0 },
    });
  });

  // Cross-system edges from P&ID sharing
  const processedPairs = new Set();
  systems.forEach(sys => {
    const primaryPnids = pnidSystems.filter(r => r.systemId === sys.id && r.isPrimary).map(r => r.pnidId);
    primaryPnids.forEach(pid => {
      pnidSystems.filter(r => r.pnidId === pid && r.systemId !== sys.id && !r.isPrimary)
        .forEach(r => {
          const pairKey = [sys.id, r.systemId].sort().join('-');
          if (!processedPairs.has(pairKey)) {
            processedPairs.add(pairKey);
            edges.push({
              id: `edge-sys-${pairKey}`,
              source: `group-${sys.id}`, target: `group-${r.systemId}`,
              type: 'boundary', data: {},
            });
          }
        });
    });
  });

  return { nodes, edges };
}

/**
 * Run ELK layout on nodes and edges.
 */
async function computeLayout(nodes, edges) {
  if (nodes.length === 0) return { nodes, edges };

  const hasInstruments = nodes.some(n => n.type === 'instrument');
  const layoutOptions = { ...ELK_OPTIONS };
  if (hasInstruments) {
    layoutOptions['elk.partitioning.activate'] = 'true';
  }

  const graph = {
    id: 'root',
    layoutOptions,
    children: nodes.map(n => {
      const props = {};
      if (hasInstruments) {
        props['elk.partitioning.partition'] = n.type === 'instrument' ? '1' : '0';
      }
      return {
        id: n.id,
        width: n.type === 'collapsedGroup' ? 220 : n.type === 'gateway' ? 140 : n.type === 'instrument' ? 100 : 160,
        height: n.type === 'collapsedGroup' ? 120 : n.type === 'gateway' ? 50 : n.type === 'instrument' ? 60 : 80,
        properties: props,
      };
    }),
    edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  try {
    const result = await elk.layout(graph);
    const positionedNodes = nodes.map(node => {
      const elkNode = result.children?.find(c => c.id === node.id);
      return { ...node, position: elkNode ? { x: elkNode.x, y: elkNode.y } : node.position };
    });
    return { nodes: positionedNodes, edges };
  } catch (err) {
    console.warn('ELK layout failed, using fallback grid:', err);
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const positionedNodes = nodes.map((node, i) => ({
      ...node, position: { x: (i % cols) * 250, y: Math.floor(i / cols) * 150 },
    }));
    return { nodes: positionedNodes, edges };
  }
}

/**
 * Hook: useSystemLayout
 *
 * Manages ELK layout computation, zoom level state, and topology data
 * for the SystemCanvas component.
 *
 * @param {Object} options
 * @param {string} options.systemId - Selected system ID
 * @param {string} options.platformId - Platform ID
 * @param {Object} options.hierarchyData - Data from useHierarchy API hook
 */
export default function useSystemLayout({ systemId, platformId, hierarchyData }) {
  const [layoutReady, setLayoutReady] = useState(false);
  const [overviewData, setOverviewData] = useState({ nodes: [], edges: [] });
  const [systemData, setSystemData] = useState({ nodes: [], edges: [], gateways: [] });
  const layoutCache = useRef(new Map());

  // Compute overview layout (all systems as collapsed groups)
  useEffect(() => {
    if (!platformId || !hierarchyData) return;

    const cacheKey = `overview-${platformId}`;
    if (layoutCache.current.has(cacheKey)) {
      setOverviewData(layoutCache.current.get(cacheKey));
      return;
    }

    const topo = buildOverviewTopology(hierarchyData);
    computeLayout(topo.nodes, topo.edges).then(result => {
      layoutCache.current.set(cacheKey, result);
      setOverviewData(result);
    });
  }, [platformId, hierarchyData]);

  // Compute system-level layout when a system is selected
  useEffect(() => {
    if (!systemId || !hierarchyData) {
      setSystemData({ nodes: [], edges: [], gateways: [] });
      setLayoutReady(false);
      return;
    }

    const cacheKey = `system-${systemId}`;
    if (layoutCache.current.has(cacheKey)) {
      const cached = layoutCache.current.get(cacheKey);
      setSystemData(cached);
      setLayoutReady(true);
      return;
    }

    setLayoutReady(false);
    const topo = buildSystemTopology(systemId, hierarchyData);
    computeLayout(topo.nodes, topo.edges).then(result => {
      const data = { ...result, gateways: topo.gateways };
      layoutCache.current.set(cacheKey, data);
      setSystemData(data);
      setLayoutReady(true);
    });
  }, [systemId, platformId, hierarchyData]);

  // Get the nodes/edges for a specific zoom level
  const getNodesForZoomLevel = useCallback((zoomLevel) => {
    if (zoomLevel === 'OVERVIEW') return overviewData;
    if (zoomLevel === 'SYSTEM') {
      return {
        nodes: systemData.nodes.filter(n => n.type !== 'instrument'),
        edges: systemData.edges.filter(e => e.type !== 'signal'),
      };
    }
    return { nodes: systemData.nodes, edges: systemData.edges };
  }, [overviewData, systemData]);

  // Get list of P&IDs for sheet mode
  const systemPnids = useMemo(() => {
    if (!systemId || !hierarchyData) return [];
    const { pnidSystems, pnids } = hierarchyData;
    const pnidRels = pnidSystems.filter(r => r.systemId === systemId && r.isPrimary);
    return pnidRels.map(r => pnids.find(p => p.id === r.pnidId)).filter(Boolean);
  }, [systemId, hierarchyData]);

  return { overviewData, systemData, layoutReady, getNodesForZoomLevel, systemPnids };
}
