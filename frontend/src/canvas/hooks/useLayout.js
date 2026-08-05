/**
 * useLayout — Runs ELK layout with persistence support.
 *
 * Priority: persisted (manual save) → hinted ELK (generated hints) → pure ELK → grid fallback.
 * ELK runs on the main thread (reliable across all build targets).
 * Results are cached by systemId.
 */
import { useState, useEffect, useRef } from 'react';
import { computeElkLayout, computeHintedElkLayout } from '../../components/canvas/layout/elkLayout';
import { loadLayout, mergePersistedPositions } from '../layout/layoutPersistence';

/**
 * @param {object} params
 * @param {object[]} params.nodes - Raw nodes from useTopologyData
 * @param {object[]} params.edges - Raw edges from useTopologyData
 * @param {string|null} params.systemId - Active system ID (cache key)
 * @returns {{ positionedNodes: object[], positionedEdges: object[], layoutReady: boolean }}
 */
export default function useLayout({ nodes, edges, systemId }) {
  const [positionedNodes, setPositionedNodes] = useState([]);
  const [positionedEdges, setPositionedEdges] = useState([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const cache = useRef(new Map());

  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      setPositionedNodes([]);
      setPositionedEdges([]);
      setLayoutReady(false);
      return;
    }

    const cacheKey = systemId || 'default';

    // Check memory cache first
    if (cache.current.has(cacheKey)) {
      const cached = cache.current.get(cacheKey);
      setPositionedNodes(cached.nodes);
      setPositionedEdges(cached.edges);
      setLayoutReady(true);
      return;
    }

    setLayoutReady(false);
    let cancelled = false;

    (async () => {
      let result = null;

      // Attempt to load persisted positions
      let savedPositions = null;
      let isGeneratedLayout = false;

      if (systemId) {
        try {
          const saved = await loadLayout(systemId);
          if (saved && saved.length > 0) {
            savedPositions = saved;
            // Check if these positions were auto-generated (pinned=false) vs
            // manually saved by the user (pinned=true). Generated positions serve
            // as ELK hints; manually saved positions are used directly.
            const pinnedCount = saved.filter(p => p.pinned).length;
            isGeneratedLayout = pinnedCount === 0; // all unpinned = generated layout

            if (!isGeneratedLayout) {
              // Manually saved positions — use directly (highest priority)
              const merged = mergePersistedPositions(nodes, saved);
              result = { nodes: merged, edges };
            }
          }
        } catch {
          // Persisted layout unavailable — fall through
        }
      }

      // Hinted ELK: when generated positions exist, use them as soft constraints
      if (!result && isGeneratedLayout && savedPositions) {
        try {
          const hints = new Map();
          for (const pos of savedPositions) {
            hints.set(pos.entity_id || pos.entityId, { x: pos.x, y: pos.y });
          }
          result = await computeHintedElkLayout(nodes, edges, hints);
        } catch (err) {
          console.warn('useLayout: hinted ELK failed, falling through to pure ELK:', err);
        }
      }

      // Pure ELK layered layout (no hints)
      if (!result) {
        try {
          result = await computeElkLayout(nodes, edges);
        } catch (err) {
          console.warn('useLayout: ELK failed, using grid fallback:', err);
          const cols = Math.ceil(Math.sqrt(nodes.length));
          result = {
            nodes: nodes.map((n, i) => ({
              ...n,
              position: { x: (i % cols) * 250, y: Math.floor(i / cols) * 150 },
            })),
            edges,
          };
        }
      }

      if (cancelled) return;
      cache.current.set(cacheKey, result);
      setPositionedNodes(result.nodes);
      setPositionedEdges(result.edges);
      setLayoutReady(true);
    })();

    return () => { cancelled = true; };
  }, [nodes, edges, systemId]);

  return { positionedNodes, positionedEdges, layoutReady };
}
