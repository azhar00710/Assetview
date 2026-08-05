/**
 * SystemCanvas — Session 5 Integration
 *
 * Wires together:
 *   - useCanvasStore (Zustand) for all canvas state
 *   - useTopologyData → useLayout → useSemanticZoom pipeline
 *   - nodeRegistry / edgeRegistry for React Flow node/edge types
 *   - Overlay hooks (tracing, isolation, corrosion) for visual state
 *   - SelectionBus for cross-module event sync
 *   - CanvasToolbar with overlay toggles and zoom indicator
 *   - Mock data when VITE_USE_MOCK=true
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import useCanvasStore from '../../canvas/store/useCanvasStore';
import useTopologyData from '../../canvas/hooks/useTopologyData';
import useLayout from '../../canvas/hooks/useLayout';
import useSemanticZoom, { getZoomLevel } from '../../canvas/hooks/useSemanticZoom';
import useTracingOverlay from '../../canvas/overlays/useTracingOverlay';
import useIsolationOverlay from '../../canvas/overlays/useIsolationOverlay';
import useCorrosionOverlay from '../../canvas/overlays/useCorrosionOverlay';
import useLineHighlightOverlay from '../../canvas/overlays/useLineHighlightOverlay';
import nodeRegistry from './nodes/nodeRegistry';
import edgeRegistry from './edges/edgeRegistry';
import CanvasToolbar from './CanvasToolbar';
import NodeDetailPanel from './NodeDetailPanel';
import SheetPanel from './SheetPanel';
import CanvasSearch from './CanvasSearch';
import DraftingPanel from './DraftingPanel';
import GenerateCanvasPanel from './GenerateCanvasPanel';
import IsolationSummaryPanel from './IsolationSummaryPanel';
import ContextMenu from './ContextMenu';
import SelectionToolbar from './SelectionToolbar';
import { saveLayout, loadLayout } from '../../canvas/layout/layoutPersistence';
import { exportPng, exportSvg } from './canvasExport';
import selectionBus from '../../lib/SelectionBus';
import useDraftingMode from '../../hooks/useDraftingMode';
import useSystemLayout, { ZOOM_LEVELS } from '../../hooks/useSystemLayout';
import { md, alpha, systemColor } from '../../lib/theme';
import { SC } from '../../data/constants';

// ─── Edge styles (fallback for edges without custom components) ───
function getEdgeStyle(type) {
  switch (type) {
    case 'pipe':
      return { stroke: md.onSurfaceVariant, strokeWidth: 2 };
    case 'signal':
      return { stroke: '#FFD466', strokeWidth: 1, strokeDasharray: '4 3' };
    case 'boundary':
      return { stroke: md.outline, strokeWidth: 1.5, strokeDasharray: '6 4' };
    case 'utility':
      return { stroke: '#8AB4FF', strokeWidth: 1.5, strokeDasharray: '3 3' };
    default:
      return { stroke: md.outline, strokeWidth: 1 };
  }
}

// ─── Merge overlay styles onto nodes/edges ──────────────────────────
function applyOverlayStyles(nodes, edges, overlays) {
  const mergedNodeStyles = new Map();
  const mergedDimmed = new Set();
  const mergedHighlightedNodes = new Set();
  const mergedHighlightedEdges = new Set();
  const mergedEdgeStyles = new Map();

  for (const overlay of overlays) {
    for (const id of overlay.highlightedNodeIds) mergedHighlightedNodes.add(id);
    for (const id of overlay.highlightedEdgeIds) mergedHighlightedEdges.add(id);
    for (const id of overlay.dimmedNodeIds) mergedDimmed.add(id);
    for (const [id, style] of overlay.nodeStyles) {
      const prev = mergedNodeStyles.get(id) || {};
      mergedNodeStyles.set(id, { ...prev, ...style });
    }
    for (const [id, style] of overlay.edgeStyles) {
      const prev = mergedEdgeStyles.get(id) || {};
      mergedEdgeStyles.set(id, { ...prev, ...style });
    }
  }

  // Don't dim nodes that are explicitly highlighted
  for (const id of mergedHighlightedNodes) mergedDimmed.delete(id);

  const hasAnyOverlay = overlays.some(
    (o) => o.highlightedNodeIds.size > 0 || o.dimmedNodeIds.size > 0
  );

  const styledNodes = nodes.map((node) => {
    const extra = mergedNodeStyles.get(node.id) || {};
    const highlighted = mergedHighlightedNodes.has(node.id);
    const dimmed = hasAnyOverlay && mergedDimmed.has(node.id);
    return {
      ...node,
      data: { ...node.data, highlighted, dimmed, ...extra },
    };
  });

  const styledEdges = edges.map((edge) => {
    const extra = mergedEdgeStyles.get(edge.id) || {};
    const highlighted = mergedHighlightedEdges.has(edge.id);
    const dimmed = hasAnyOverlay && !highlighted;
    return {
      ...edge,
      data: { ...edge.data, highlighted, dimmed, ...extra },
    };
  });

  return { styledNodes, styledEdges };
}

// ─── Inner component with access to ReactFlow instance ──────────────
function SystemCanvasInner({
  systemId,
  platformId,
  onSystemSelect,
  onClose,
}) {
  const reactFlowInstance = useReactFlow();
  const prevNodeCount = useRef(0);
  const [sheetsOpen, setSheetsOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [activePnid, setActivePnid] = useState(null);

  const canvasRef = useRef(null);

  // ─── Store actions ───
  const setSystem = useCanvasStore((s) => s.setSystem);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const toggleNode = useCanvasStore((s) => s.toggleNode);
  const deselectAll = useCanvasStore((s) => s.deselectAll);
  const setHoveredNode = useCanvasStore((s) => s.setHoveredNode);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const setZoomLevel = useCanvasStore((s) => s.setZoomLevel);
  const setTopologyData = useCanvasStore((s) => s.setTopologyData);
  const storeZoomLevel = useCanvasStore((s) => s.zoomLevel);
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const xrefEnabled = useCanvasStore((s) => s.xrefEnabled);
  const toggleXref = useCanvasStore((s) => s.toggleXref);
  const selectedNode = useCanvasStore((s) => s.selectedNode);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const clearSelectedNode = useCanvasStore((s) => s.clearSelectedNode);
  const setHoveredLine = useCanvasStore((s) => s.setHoveredLine);
  const selectLine = useCanvasStore((s) => s.selectLine);
  const clearLine = useCanvasStore((s) => s.clearLine);
  const lineColorMode = useCanvasStore((s) => s.lineColorMode);
  const toggleLineColorMode = useCanvasStore((s) => s.toggleLineColorMode);
  const setContextMenu = useCanvasStore((s) => s.setContextMenu);
  const clearContextMenu = useCanvasStore((s) => s.clearContextMenu);
  const clearTrace = useCanvasStore((s) => s.clearTrace);
  const clearIsolation = useCanvasStore((s) => s.clearIsolation);

  // ─── Drafting mode ───
  const drafting = useDraftingMode(systemId);

  // ─── Step 1: Sync systemId into store ───
  useEffect(() => {
    setSystem(systemId);
  }, [systemId, setSystem]);

  // ─── Step 2: Fetch topology (mock or API) ───
  const isOverview = !systemId;
  const entityFilter = drafting.isDrafting && drafting.selectedIds.size > 0 ? drafting.selectedIds : null;
  const { nodes: rawNodes, edges: rawEdges, loading } = useTopologyData(
    systemId,
    { overview: isOverview, includeXref: xrefEnabled, platformId, entityFilter }
  );

  // ─── Step 3: Run ELK layout ───
  const { positionedNodes, positionedEdges, layoutReady } = useLayout({
    nodes: rawNodes,
    edges: rawEdges,
    systemId,
  });

  // ─── Step 4: Semantic zoom filtering ───
  const { visibleNodes, visibleEdges, zoomLevel } = useSemanticZoom(
    positionedNodes,
    positionedEdges
  );

  // Sync computed zoom level back to store
  useEffect(() => {
    if (zoomLevel !== storeZoomLevel) {
      setZoomLevel(zoomLevel);
    }
  }, [zoomLevel, storeZoomLevel, setZoomLevel]);

  // Sync positioned data to store for overlay hooks
  useEffect(() => {
    if (layoutReady && positionedNodes.length > 0) {
      setTopologyData(positionedNodes, positionedEdges);
    }
  }, [positionedNodes, positionedEdges, layoutReady, setTopologyData]);

  // ─── Step 5: Overlay hooks ───
  const tracingOverlay = useTracingOverlay();
  const isolationOverlay = useIsolationOverlay();
  const corrosionOverlay = useCorrosionOverlay();
  const lineHighlightOverlay = useLineHighlightOverlay();

  const overlays = useMemo(
    () => [tracingOverlay, isolationOverlay, corrosionOverlay, lineHighlightOverlay],
    [tracingOverlay, isolationOverlay, corrosionOverlay, lineHighlightOverlay]
  );

  // ─── Step 6: Merge overlay styles ───
  const { styledNodes, styledEdges } = useMemo(
    () => applyOverlayStyles(visibleNodes, visibleEdges, overlays),
    [visibleNodes, visibleEdges, overlays]
  );

  // ─── Step 7: Inject callbacks into special nodes ───
  const handleNavigateToSystem = useCallback(
    (targetSystemId) => {
      onSystemSelect?.(targetSystemId);
    },
    [onSystemSelect]
  );

  const setTraceResult = useCanvasStore((s) => s.setTraceResult);
  const traceResult = useCanvasStore((s) => s.traceResult);
  const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

  // "Trace Across Systems" — follows downstream from a gateway's source entity
  const handleTraceAcross = useCallback(
    async (targetSystemId, gatewayNodeId) => {
      // Find the entity connected to this gateway in the current edges
      const gatewayEdge = rawEdges.find(
        (e) => e.target === gatewayNodeId || e.source === gatewayNodeId
      );
      const entityId = gatewayEdge
        ? (gatewayEdge.target === gatewayNodeId ? gatewayEdge.source : gatewayEdge.target)
        : gatewayNodeId;

      try {
        const res = await fetch(`${API_URL}/topology/downstream/${entityId}?maxDepth=50`);
        if (!res.ok) return;
        const data = await res.json();

        // Merge with existing trace if active
        const existingPath = traceResult?.path || [];
        const crossSystemIds = data.visitedIds || [];
        const mergedPath = [...new Set([...existingPath, entityId, ...crossSystemIds])];

        setTraceResult({
          ...traceResult,
          path: mergedPath,
          crossSystemIds,
          boundary: traceResult?.boundary || [],
          direction: 'downstream',
        });
      } catch (err) {
        console.error('Cross-system trace failed:', err);
      }
    },
    [rawEdges, traceResult, setTraceResult, API_URL]
  );

  const finalNodes = useMemo(() => {
    return styledNodes.map((node) => {
      if (node.type === 'collapsedGroup') {
        return { ...node, data: { ...node.data, onExpand: handleNavigateToSystem } };
      }
      if (node.type === 'gateway') {
        return {
          ...node,
          data: {
            ...node.data,
            onNavigate: handleNavigateToSystem,
            onTraceAcross: traceResult
              ? (targetSysId) => handleTraceAcross(targetSysId, node.id)
              : undefined,
          },
        };
      }
      return node;
    });
  }, [styledNodes, handleNavigateToSystem, handleTraceAcross, traceResult]);

  // ─── Step 8: Selection marking ───
  const nodesWithSelection = useMemo(() => {
    if (selectedNodeIds.size === 0) return finalNodes;
    return finalNodes.map((n) => ({
      ...n,
      selected: selectedNodeIds.has(n.id),
    }));
  }, [finalNodes, selectedNodeIds]);

  // ─── Fit view when node count changes ───
  useEffect(() => {
    if (nodesWithSelection.length > 0 && nodesWithSelection.length !== prevNodeCount.current) {
      prevNodeCount.current = nodesWithSelection.length;
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2, duration: 400 });
      }, 100);
    }
  }, [nodesWithSelection.length, reactFlowInstance]);

  // ─── Event handlers ───
  const handleViewportChange = useCallback(
    (viewport) => {
      setViewport(viewport);
    },
    [setViewport]
  );

  const handleNodeClick = useCallback(
    (event, node) => {
      // Ctrl/Cmd+Click → multi-select toggle
      if (event.ctrlKey || event.metaKey) {
        toggleNode(node.id);
      } else {
        selectNode(node.id);
        // Open detail panel for equipment/instrument nodes
        if (node.type === 'equipment' || node.type === 'instrument') {
          setSelectedNode(node);
        }
      }
      // Emit to SelectionBus for cross-module sync
      selectionBus.emit('tag:select', {
        tag: node.data?.tag || node.id,
        source: '2d',
        meta: {
          entityId: node.id,
          entityType: node.type,
          systemId: node.data?.systemId,
        },
      });
    },
    [selectNode, toggleNode, setSelectedNode]
  );

  const handlePaneClick = useCallback(() => {
    deselectAll();
    clearLine();
    selectionBus.clearSelection('2d');
  }, [deselectAll, clearLine]);

  const handleNodeMouseEnter = useCallback(
    (_event, node) => {
      setHoveredNode(node.id);
      selectionBus.emit('tag:hover', {
        tag: node.data?.tag || node.id,
        source: '2d',
      });
    },
    [setHoveredNode]
  );

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNode(null);
    selectionBus.emit('tag:hover', { tag: null, source: '2d' });
  }, [setHoveredNode]);

  // ─── Right-click context menu for all node types ───
  const handleNodeContextMenu = useCallback(
    (event, node) => {
      event.preventDefault();
      // Use client coords for portal-rendered menu (fixed positioning)
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id, nodeData: node.data, nodeType: node.type });
    },
    [setContextMenu]
  );

  // ─── Layout persistence: save on drag stop ───
  const handleNodeDragStop = useCallback(
    (_event, node) => {
      if (!systemId) return;
      const currentNodes = reactFlowInstance.getNodes();
      const positions = currentNodes.map((n) => ({ entityId: n.id, x: n.position.x, y: n.position.y }));
      saveLayout(systemId, positions).catch(() => {});
    },
    [systemId, reactFlowInstance]
  );

  const handlePaneContextMenu = useCallback(() => {
    clearContextMenu();
  }, [clearContextMenu]);

  // ─── Edge event handlers (line highlighting) ───
  const handleEdgeMouseEnter = useCallback(
    (_event, edge) => {
      const lineId = edge.data?.lineId || edge.lineId;
      if (lineId) setHoveredLine(lineId);
    },
    [setHoveredLine]
  );

  const handleEdgeMouseLeave = useCallback(() => {
    setHoveredLine(null);
  }, [setHoveredLine]);

  const handleEdgeClick = useCallback(
    (_event, edge) => {
      const lineId = edge.data?.lineId || edge.lineId;
      if (!lineId) return;
      selectLine(lineId);
      // Open line detail panel with a synthetic "line" node
      setSelectedNode({
        id: lineId,
        type: 'line',
        data: { lineId, lineTag: edge.data?.lineTag, lineName: edge.data?.lineName },
      });
    },
    [selectLine, setSelectedNode]
  );

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handler = (e) => {
      // Skip if typing in input/textarea/contenteditable
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

      // Ctrl/Cmd+K → focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.querySelector('[data-canvas-search]')?.focus();
        return;
      }

      switch (e.key) {
        case 'Escape':
          clearSelectedNode();
          deselectAll();
          clearContextMenu();
          clearTrace();
          clearIsolation();
          if (drafting.isDrafting) drafting.exitDraft();
          break;
        case '1':
          reactFlowInstance.zoomTo(0.3, { duration: 300 });
          break;
        case '2':
          reactFlowInstance.zoomTo(0.8, { duration: 300 });
          break;
        case '3':
          reactFlowInstance.zoomTo(1.5, { duration: 300 });
          break;
        case 't':
        case 'T':
          // Toggle trace mode — handled via overlay manager
          break;
        case 'i':
        case 'I':
          // Toggle isolation mode — handled via overlay manager
          break;
        case 'd':
        case 'D':
          if (systemId) {
            drafting.isDrafting ? drafting.exitDraft() : drafting.enterDraft();
          }
          break;
        case 'x':
        case 'X':
          toggleXref();
          break;
        case 'f':
        case 'F':
          reactFlowInstance.fitView({ padding: 0.2, duration: 400 });
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [reactFlowInstance, clearSelectedNode, deselectAll, clearContextMenu, clearTrace, clearIsolation, toggleXref, drafting, systemId]);

  // ─── Selection change sync (for box-select) ───
  const handleSelectionChange = useCallback(({ nodes: selectedNodes }) => {
    if (selectedNodes && selectedNodes.length > 0) {
      const ids = new Set(selectedNodes.map((n) => n.id));
      useCanvasStore.setState({ selectedNodeIds: ids });
    }
  }, []);

  // ─── System label (derive from topology data) ───
  const systemMeta = useMemo(() => {
    if (!systemId || rawNodes.length === 0) return null;
    // Find first non-gateway, non-collapsed node to get system info
    const sampleNode = rawNodes.find((n) =>
      n.type === 'equipment' && n.data?.systemId === systemId
    ) || rawNodes.find((n) => n.data?.systemId === systemId);
    return sampleNode?.data || null;
  }, [systemId, rawNodes]);

  const systemLabel = systemMeta
    ? `${systemMeta.systemCode || ''} — System Topology`
    : systemId ? 'System Topology' : 'Platform Overview';
  const sysColor = systemMeta?.systemCode
    ? SC[systemMeta.systemType || 'process'] || null
    : null;

  // ─── Export handlers ───
  const handleExportPng = useCallback(() => {
    const el = canvasRef.current?.querySelector('.react-flow__viewport');
    if (el) exportPng(el, { systemLabel, platformName: systemMeta?.platformName });
  }, [systemLabel, systemMeta]);

  const handleExportSvg = useCallback(() => {
    const el = canvasRef.current?.querySelector('.react-flow__viewport');
    if (el) exportSvg(el, { systemLabel, platformName: systemMeta?.platformName });
  }, [systemLabel, systemMeta]);

  // ─── Save / Reset layout handlers ───
  const handleSaveLayout = useCallback(() => {
    if (!systemId) return;
    const currentNodes = reactFlowInstance.getNodes();
    const positions = currentNodes.map((n) => ({ entityId: n.id, x: n.position.x, y: n.position.y }));
    saveLayout(systemId, positions).catch(() => {});
  }, [systemId, reactFlowInstance]);

  const handleResetLayout = useCallback(() => {
    if (!systemId) return;
    saveLayout(systemId, []).catch(() => {});
    setSystem(systemId);
  }, [systemId, setSystem]);

  return (
    <div className="flex flex-col h-full w-full" style={{ background: md.surface }}>
      {/* ─── Toolbar ─── */}
      <CanvasToolbar
        systemLabel={systemLabel}
        systemColor={sysColor}
        zoomLevel={zoomLevel}
        onBack={onClose}
        onOverview={systemId ? () => onSystemSelect?.(null) : null}
        hasSystem={!!systemId}
        xrefEnabled={xrefEnabled}
        onToggleXref={toggleXref}
        sheetsOpen={sheetsOpen}
        onToggleSheets={() => setSheetsOpen((v) => !v)}
        lineColorMode={lineColorMode}
        onToggleLineColor={toggleLineColorMode}
        draftMode={drafting.isDrafting}
        onToggleDraft={() => drafting.isDrafting ? drafting.exitDraft() : drafting.enterDraft()}
        generateOpen={generateOpen}
        onToggleGenerate={() => setGenerateOpen((v) => !v)}
        onSaveLayout={handleSaveLayout}
        onResetLayout={handleResetLayout}
        onExportPng={handleExportPng}
        onExportSvg={handleExportSvg}
      >
        <CanvasSearch
          platformId={platformId}
          onSelectNode={(node) => {
            selectNode(node.id);
            if (node.type === 'equipment' || node.type === 'instrument') {
              setSelectedNode(node);
            }
          }}
        />
      </CanvasToolbar>

      {/* ─── React Flow Canvas ─── */}
      <div className="flex-1 relative" ref={canvasRef}>
        <ReactFlow
          nodes={nodesWithSelection}
          edges={styledEdges}
          nodeTypes={nodeRegistry}
          edgeTypes={edgeRegistry}
          onViewportChange={handleViewportChange}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          onNodeContextMenu={handleNodeContextMenu}
          onPaneContextMenu={handlePaneContextMenu}
          onEdgeMouseEnter={handleEdgeMouseEnter}
          onEdgeMouseLeave={handleEdgeMouseLeave}
          onEdgeClick={handleEdgeClick}
          onNodeDragStop={handleNodeDragStop}
          onSelectionChange={handleSelectionChange}
          selectionOnDrag
          selectionMode="partial"
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ animated: false }}
          style={{ background: '#F5F7F7' }}
        >
          <Background
            color="#D0D5D5"
            gap={30}
            size={1}
            variant="dots"
            style={{ opacity: 0.6 }}
          />
          <Controls
            showInteractive={false}
            position="top-right"
            style={{
              background: '#FFFFFF',
              border: '1px solid #D0D5D5',
              borderRadius: 8,
              boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
            }}
          />
          <MiniMap
            nodeColor={(n) => {
              if (n.type === 'collapsedGroup') return n.data?.color || md.primary;
              if (n.type === 'gateway') return n.data?.color || md.outline;
              if (n.type === 'instrument') return '#FFD466';
              return SC[n.data?.systemType] || md.primary;
            }}
            position="bottom-right"
            style={{
              background: '#FFFFFF',
              border: '1px solid #D0D5D5',
              borderRadius: 8,
              boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
              marginBottom: 8,
              marginRight: 8,
            }}
            maskColor="rgba(245,247,247,0.7)"
          />
        </ReactFlow>

        {/* Loading overlay */}
        {(loading || (systemId && !layoutReady)) && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(245,247,247,0.85)' }}
          >
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: '#3BE494 transparent #3BE494 #3BE494' }}
              />
              <span style={{ fontSize: 12, color: '#444' }}>
                Computing layout...
              </span>
            </div>
          </div>
        )}

        {/* Zoom level controls (bottom-left) — clickable */}
        <div
          className="absolute bottom-3 left-3 flex flex-col gap-1"
          style={{
            background: 'rgba(255,255,255,0.9)',
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid #D0D5D5',
          }}
        >
          {[
            { key: 'OVERVIEW', zoom: 0.3 },
            { key: 'SYSTEM', zoom: 0.8 },
            { key: 'DETAIL', zoom: 1.5 },
          ].map(({ key, zoom }) => (
            <button
              key={key}
              onClick={() => reactFlowInstance.zoomTo(zoom, { duration: 300 })}
              className="flex items-center gap-2"
              style={{
                fontSize: 9,
                color: zoomLevel === key ? '#16352B' : '#666',
                fontWeight: zoomLevel === key ? 700 : 400,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '1px 0',
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: zoomLevel === key ? '#3BE494' : 'transparent',
                  border: zoomLevel === key ? 'none' : '1px solid #aaa',
                }}
              />
              {key.charAt(0) + key.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Node detail panel */}
        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            onClose={clearSelectedNode}
          />
        )}

        {/* Isolation summary panel */}
        <IsolationSummaryPanel />

        {/* Multi-select toolbar */}
        <SelectionToolbar />

        {/* Right-click context menu (portal-rendered) */}
        <ContextMenu
          onNavigate={handleNavigateToSystem}
          onTraceAcross={(targetSysId, gatewayId) => handleTraceAcross(targetSysId, gatewayId)}
        />

        {/* Sheet panel (bottom drawer) */}
        {sheetsOpen && systemId && (
          <SheetPanel
            systemId={systemId}
            onOpenPnid={(pnid) => setActivePnid(pnid)}
            onClose={() => setSheetsOpen(false)}
          />
        )}

        {/* Drafting panel (left drawer) */}
        {drafting.isDrafting && systemId && (
          <DraftingPanel
            systemId={systemId}
            topologyNodes={rawNodes}
            topologyEdges={rawEdges}
            drafting={drafting}
          />
        )}

        {/* Generate canvas panel (left drawer) */}
        {generateOpen && systemId && (
          <GenerateCanvasPanel
            systemId={systemId}
            onClose={() => setGenerateOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * SystemCanvas — Zustand-powered topology viewer with semantic zoom,
 * overlay system, and SelectionBus integration.
 *
 * Props:
 *   systemId    — active system UUID (null = overview)
 *   platformId  — active platform UUID
 *   onSystemSelect(systemId) — navigate to a system
 *   onClose     — back/close handler
 */
export default function SystemCanvas(props) {
  return (
    <ReactFlowProvider>
      <SystemCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
