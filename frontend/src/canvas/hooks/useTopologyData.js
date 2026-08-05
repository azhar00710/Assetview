/**
 * useTopologyData — Fetches system topology from API.
 * Builds React Flow node/edge arrays from raw topology response.
 *
 * Fetches from GET /api/v1/topology/system/:systemId.
 * Overview mode fetches systems from API and builds CollapsedGroupNodes.
 */
import { useState, useEffect, useRef } from 'react';

const API = import.meta.env.VITE_API_URL || '/api/v1';

// System type → color mapping (matches design tokens)
const SYS_TYPE_COLORS = {
  process: '#3BE494',
  utility: '#2D33E0',
  safety: '#E74C3C',
  instrument: '#F39C12',
};

/**
 * Fetch topology from the backend API.
 */
async function fetchTopology(systemId) {
  const res = await fetch(`${API}/topology/system/${systemId}`);
  if (!res.ok) throw new Error(`Topology fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch boundary edges between systems for overview mode.
 */
async function fetchBoundaries(platformId) {
  try {
    const res = await fetch(`${API}/topology/boundaries?platform_id=${platformId}`);
    if (!res.ok) return [];
    const { boundaries } = await res.json();
    return boundaries || [];
  } catch {
    return [];
  }
}

/**
 * Fetch systems for a platform and build CollapsedGroupNode overview topology.
 * Also fetches boundary edges to draw BoundaryEdges between system nodes.
 */
async function fetchOverviewTopology(platformId) {
  const [systemsRes, boundaries] = await Promise.all([
    fetch(`${API}/platforms/${platformId}/systems`),
    fetchBoundaries(platformId),
  ]);
  if (!systemsRes.ok) throw new Error(`Systems fetch failed: ${systemsRes.status}`);
  const { systems } = await systemsRes.json();
  if (!systems?.length) return { nodes: [], edges: [], gateways: [] };

  // Build CollapsedGroupNodes from systems — grid layout (3 columns)
  const COLS = 3;
  const COL_GAP = 400;
  const ROW_GAP = 300;
  const systemMap = new Map();
  const nodes = systems.map((sys, i) => {
    const nodeId = `grp-${sys.id}`;
    systemMap.set(sys.id, { nodeId, sys });
    return {
      id: nodeId,
      type: 'collapsedGroup',
      position: { x: (i % COLS) * COL_GAP + 200, y: Math.floor(i / COLS) * ROW_GAP + 200 },
      data: {
        systemId: sys.id,
        systemCode: sys.code,
        systemName: sys.name,
        label: sys.name,
        systemType: sys.sysType || 'process',
        color: SYS_TYPE_COLORS[sys.sysType] || SYS_TYPE_COLORS.process,
        eqCount: sys.equipmentCount || 0,
        lineCount: sys.lineCount || 0,
        instCount: sys.instrumentCount || 0,
        pnidCount: sys.primaryPnidCount || 0,
      },
    };
  });

  // Build BoundaryEdges from boundary data
  const edges = boundaries
    .filter((b) => systemMap.has(b.fromSystemId) && systemMap.has(b.toSystemId))
    .map((b, i) => {
      const fromNode = systemMap.get(b.fromSystemId);
      const toNode = systemMap.get(b.toSystemId);
      const color = SYS_TYPE_COLORS[b.fromSystemType] || SYS_TYPE_COLORS.process;
      return {
        id: `boundary-${b.fromSystemId}-${b.toSystemId}-${i}`,
        source: fromNode.nodeId,
        target: toNode.nodeId,
        type: 'boundary',
        data: {
          edgeCount: b.edgeCount,
          connections: b.connections,
          fromSystemCode: b.fromSystemCode,
          toSystemCode: b.toSystemCode,
          targetSystemType: b.fromSystemType,
          targetSystemCode: `${b.edgeCount} connection${b.edgeCount !== 1 ? 's' : ''}`,
          color,
        },
      };
    });

  return { nodes, edges, gateways: [] };
}

/**
 * @param {string|null} systemId - Active system ID
 * @param {object} options
 * @param {boolean} [options.overview] - If true, return overview (collapsed) topology
 * @param {boolean} [options.includeXref] - If true, include cross-system xref nodes
 * @param {string|null} [options.platformId] - Platform ID (needed for API overview mode)
 * @returns {{ nodes: object[], edges: object[], gateways: object[], loading: boolean }}
 */
export default function useTopologyData(systemId, { overview = false, includeXref = false, platformId = null, entityFilter = null } = {}) {
  const [data, setData] = useState({ nodes: [], edges: [], gateways: [] });
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map());

  useEffect(() => {
    if (overview) {
      if (!platformId) {
        setData({ nodes: [], edges: [], gateways: [] });
        setLoading(false);
        return;
      }
      const cacheKey = `overview-${platformId}`;
      if (cache.current.has(cacheKey)) {
        setData(cache.current.get(cacheKey));
        return;
      }
      setLoading(true);
      let cancelled = false;
      fetchOverviewTopology(platformId)
        .then((result) => {
          if (cancelled) return;
          cache.current.set(cacheKey, result);
          setData(result);
        })
        .catch((err) => {
          if (!cancelled) console.error('useTopologyData overview:', err);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => { cancelled = true; };
    }

    if (!systemId) {
      setData({ nodes: [], edges: [], gateways: [] });
      setLoading(false);
      return;
    }

    const cacheKey = `topo-${systemId}-xref-${includeXref}`;
    if (cache.current.has(cacheKey)) {
      setData(cache.current.get(cacheKey));
      return;
    }

    setLoading(true);

    let cancelled = false;
    fetchTopology(systemId)
      .then((result) => {
        if (cancelled) return;
        const topo = {
          nodes: result.nodes || [],
          edges: result.edges || [],
          gateways: result.gateways || [],
        };
        cache.current.set(cacheKey, topo);
        setData(topo);
      })
      .catch((err) => {
        if (!cancelled) console.error('useTopologyData:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [systemId, overview, includeXref, platformId]);

  // Apply entity filter if provided (drafting mode)
  if (entityFilter && entityFilter.size > 0) {
    const filteredNodes = data.nodes.filter((n) => entityFilter.has(n.id));
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = data.edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );
    return { nodes: filteredNodes, edges: filteredEdges, gateways: data.gateways, loading };
  }

  return { nodes: data.nodes, edges: data.edges, gateways: data.gateways, loading };
}
