import { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import useAnnotationWorkspace from '../../hooks/useAnnotationWorkspace';
import { useAnnotations, useOverlay, usePlaceEntity, useCreateAnnotation, useDeleteAnnotation } from '../../hooks/useAnnotations';
import { usePnidsByPlatform, useSystems } from '../../hooks/useApi';
import TagSearchBar from './TagSearchBar';
import PnidSelector from './PnidSelector';
import TagListPanel from './TagListPanel';
import AnnotationPropertiesPanel from './AnnotationPropertiesPanel';
import StatusBar from './StatusBar';
import AIAnnotateMode from './AIAnnotateMode';
import PnidViewer from '../pnid/PnidViewer';
import LinkDialog from '../pnid/LinkDialog';

export default function AnnotationWorkspace({ platformId, onClose, initialPnid }) {
  const {
    selectedPnidId, selectedPnidInfo, selectPnid,
    selectedEntityId, selectedEntityType, selectEntity,
    highlightEntityId, panToEntity, clearHighlight,
    placementMode, placementEntity, exitPlacementMode,
    drawMode, setDrawMode, activeTool, setActiveTool, draftEntity,
    selectedAnnotationIds, setSelectedAnnotationIds, clearSelection,
    propertiesPanelOpen, tagListPanelOpen,
    togglePropertiesPanel, toggleTagListPanel,
    overlayDisplayMode, setOverlayDisplayMode,
  } = useAnnotationWorkspace();

  // Fetch platform data
  const { data: apiSystems = [] } = useSystems(platformId);
  const { data: apiPnids = [] } = usePnidsByPlatform(platformId);

  // Auto-select initial P&ID
  useEffect(() => {
    if (initialPnid && !selectedPnidId) {
      selectPnid(initialPnid.id, initialPnid);
    } else if (!selectedPnidId && apiPnids?.length > 0) {
      const first = apiPnids[0];
      selectPnid(first.id, {
        id: first.id,
        drawingNumber: first.drawingNumber,
        title: first.title,
      });
    }
  }, [initialPnid, selectedPnidId, apiPnids]);

  // Fetch data for selected P&ID
  const { data: annotations = [] } = useAnnotations(selectedPnidId);
  const { data: overlay } = useOverlay(selectedPnidId);
  const createAnnotation = useCreateAnnotation(selectedPnidId);
  const deleteAnnotation = useDeleteAnnotation(selectedPnidId);
  const placeEntity = usePlaceEntity(selectedPnidId);
  const [pendingManualAnnotation, setPendingManualAnnotation] = useState(null);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const [resizingLeft, setResizingLeft] = useState(false);
  const leftResizeStart = useRef({ x: 0, width: 320 });
  const selectedAnnotationIdsArray = useMemo(() => Array.from(selectedAnnotationIds || []), [selectedAnnotationIds]);

  // Map P&IDs for selector
  const pnidList = useMemo(() => {
    if (!apiPnids) return [];
    return apiPnids.map(p => ({
      id: p.id,
      drawingNumber: p.drawingNumber,
      title: p.title,
      primarySystemId: p.primarySystemId,
      primarySystemCode: p.primarySystemCode,
      systemIds: [], // Could be populated from pnid_system
    }));
  }, [apiPnids]);

  // Handle entity selection from canvas overlay click
  const handleOverlaySelect = useCallback((entity) => {
    if (entity) {
      selectEntity(entity.id, entity.entityType || (entity.lineNumber ? 'line' : entity.tag ? 'equipment' : 'instrument'));
    }
  }, [selectEntity]);

  // Handle placement on canvas
  const handleCanvasPlacement = useCallback((xPct, yPct) => {
    if (!placementMode || !placementEntity) return;
    placeEntity.mutate({
      entityType: placementEntity.type,
      entityId: placementEntity.id,
      xPct,
      yPct,
      wPct: placementEntity.type === 'line' ? undefined : (placementEntity.type === 'instrument' ? 8 : 12),
      hPct: placementEntity.type === 'line' ? undefined : (placementEntity.type === 'instrument' ? 8 : 6),
      shape: placementEntity.type === 'instrument' ? 'circle' : 'rectangle',
      color: placementEntity.type === 'instrument' ? '#FFD466' : placementEntity.type === 'line' ? '#8AB4FF' : '#3BE494',
      strokeWidth: 2,
    });
    exitPlacementMode();
  }, [placementMode, placementEntity, placeEntity, exitPlacementMode]);

  const handleWorkspaceCreateAnnotation = useCallback((annotationData) => {
    const toolToShape = {
      rectangle: 'rectangle',
      circle: 'circle',
      diamond: 'diamond',
      pin: 'pin',
      line: 'line',
    };
    const resolvedShape = toolToShape[activeTool] || annotationData.shape || 'rectangle';

    if (draftEntity) {
      placeEntity.mutate({
        entityType: draftEntity.type,
        entityId: draftEntity.id,
        xPct: annotationData.xPct,
        yPct: annotationData.yPct,
        wPct: annotationData.wPct,
        hPct: annotationData.hPct,
        x2Pct: annotationData.x2Pct,
        y2Pct: annotationData.y2Pct,
        shape: resolvedShape,
        color: draftEntity.type === 'instrument' ? '#FFD466' : draftEntity.type === 'line' ? '#8AB4FF' : '#3BE494',
        strokeWidth: 2,
        metadata: { source: 'manual' },
      });
      setDrawMode(false, null);
      setActiveTool('rectangle');
      return;
    }

    setPendingManualAnnotation({
      annotationType: 'shape',
      shape: resolvedShape,
      xPct: annotationData.xPct,
      yPct: annotationData.yPct,
      wPct: annotationData.wPct,
      hPct: annotationData.hPct,
      x2Pct: annotationData.x2Pct,
      y2Pct: annotationData.y2Pct,
      color: '#8AB4FF',
      strokeWidth: 2,
      metadata: { source: 'manual' },
    });
  }, [activeTool, draftEntity, placeEntity, createAnnotation, setDrawMode, setActiveTool]);

  const handleManualLink = useCallback((linkData) => {
    if (!pendingManualAnnotation) return;
    placeEntity.mutate({
      ...linkData,
      xPct: pendingManualAnnotation.xPct,
      yPct: pendingManualAnnotation.yPct,
      wPct: pendingManualAnnotation.wPct,
      hPct: pendingManualAnnotation.hPct,
      x2Pct: pendingManualAnnotation.x2Pct,
      y2Pct: pendingManualAnnotation.y2Pct,
      shape: pendingManualAnnotation.shape,
      color: pendingManualAnnotation.color,
      strokeWidth: pendingManualAnnotation.strokeWidth,
    });
    setPendingManualAnnotation(null);
  }, [pendingManualAnnotation, placeEntity]);

  const handleManualSkip = useCallback(() => {
    if (!pendingManualAnnotation) return;
    createAnnotation.mutate({
      annotationType: pendingManualAnnotation.annotationType || 'shape',
      shape: pendingManualAnnotation.shape,
      xPct: pendingManualAnnotation.xPct,
      yPct: pendingManualAnnotation.yPct,
      wPct: pendingManualAnnotation.wPct,
      hPct: pendingManualAnnotation.hPct,
      x2Pct: pendingManualAnnotation.x2Pct,
      y2Pct: pendingManualAnnotation.y2Pct,
      color: pendingManualAnnotation.color,
      strokeWidth: pendingManualAnnotation.strokeWidth,
      metadata: pendingManualAnnotation.metadata || { source: 'manual' },
    });
    setPendingManualAnnotation(null);
  }, [pendingManualAnnotation, createAnnotation]);

  // Handle cross-sheet navigation from continuation badges
  const handleSheetNavigate = useCallback((targetPnidId) => {
    if (!targetPnidId) return;
    const targetPnid = pnidList.find(p => p.id === targetPnidId);
    if (targetPnid) {
      selectPnid(targetPnid.id, { id: targetPnid.id, drawingNumber: targetPnid.drawingNumber, title: targetPnid.title });
    }
  }, [pnidList, selectPnid]);

  useEffect(() => {
    if (!resizingLeft) return;
    const onMove = (e) => {
      const delta = e.clientX - leftResizeStart.current.x;
      const next = Math.max(280, Math.min(520, leftResizeStart.current.width + delta));
      setLeftPanelWidth(next);
    };
    const onUp = () => setResizingLeft(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizingLeft]);

  return (
    <div className="flex flex-col h-full w-full bg-[#0D1F17]">
      {/* Top bar: Search + P&ID selector */}
      <div className="flex items-center px-3 py-2 bg-[#111D14] border-b border-[#919A9B]/10 gap-3 shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-[#919A9B] hover:text-[#D3DFE2] transition-colors text-[11px]"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back
        </button>
        <div className="h-4 w-px bg-[#919A9B]/20" />

        {/* Title */}
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-[#3BE494]">edit_note</span>
          <span className="text-[12px] font-semibold text-[#D3DFE2]">Annotation Workspace</span>
        </div>

        <div className="h-4 w-px bg-[#919A9B]/20" />

        {/* Search bar */}
        <TagSearchBar platformId={platformId} />

        {/* P&ID selector */}
        <PnidSelector pnids={pnidList} systems={apiSystems} />

        {/* Display mode toggle */}
        <div className="flex items-center bg-[#0D1F17] rounded p-0.5 gap-0.5">
          {[
            { mode: 'shapes', icon: 'crop_free', title: 'Bounding boxes only' },
            { mode: 'both', icon: 'layers', title: 'Boxes + text labels' },
            { mode: 'text', icon: 'text_fields', title: 'Text labels only' },
          ].map(({ mode, icon, title }) => (
            <button
              key={mode}
              onClick={() => setOverlayDisplayMode(mode)}
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                overlayDisplayMode === mode ? 'bg-[#3BE494] text-[#0D1F17]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
              }`}
              title={title}
            >
              <span className="material-symbols-outlined text-[14px]">{icon}</span>
            </button>
          ))}
        </div>

        {/* Panel toggles */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={toggleTagListPanel}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              tagListPanelOpen ? 'bg-[#3BE494]/15 text-[#3BE494]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
            }`}
            title="Toggle tag list panel"
          >
            <span className="material-symbols-outlined text-[16px]">view_list</span>
          </button>
          <button
            onClick={togglePropertiesPanel}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              propertiesPanelOpen ? 'bg-[#3BE494]/15 text-[#3BE494]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
            }`}
            title="Toggle properties panel"
          >
            <span className="material-symbols-outlined text-[16px]">tune</span>
          </button>
        </div>
      </div>

      {/* AI Annotate bar — dedicated row so it doesn't overflow */}
      {selectedPnidId && (
        <div className="flex items-center px-3 py-1.5 bg-[#111D14] border-b border-[#3BE494]/10 gap-2 shrink-0">
          <AIAnnotateMode
            pnidId={selectedPnidId}
            platformId={platformId}
            annotations={annotations}
            selectedAnnotationIds={selectedAnnotationIdsArray}
            onAiSuggestionsChange={setAiSuggestions}
            pnidList={pnidList}
            onNavigatePnid={handleSheetNavigate}
          />
        </div>
      )}

      {/* Annotation ribbon */}
      {selectedPnidId && (
        <div className="flex items-center px-3 py-1.5 bg-[#16352B] border-b border-[#919A9B]/10 gap-1.5 shrink-0">
          {[
            { key: 'select', icon: 'near_me', label: 'Select' },
            { key: 'rectangle', icon: 'rectangle', label: 'Rectangle' },
            { key: 'circle', icon: 'circle', label: 'Circle' },
            { key: 'diamond', icon: 'diamond', label: 'Diamond' },
            { key: 'pin', icon: 'location_on', label: 'Pin' },
            { key: 'line', icon: 'horizontal_rule', label: 'Line' },
          ].map(tool => (
            <button
              key={tool.key}
              onClick={() => {
                setActiveTool(tool.key);
                if (tool.key === 'select') {
                  setDrawMode(false, null);
                } else {
                  setDrawMode(true, draftEntity || null);
                }
              }}
              className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                ((tool.key === 'select' && !drawMode) || (drawMode && activeTool === tool.key))
                  ? 'bg-[#3BE494] text-[#0D1F17]'
                  : 'text-[#D3DFE2] hover:bg-white/10'
              }`}
              title={tool.label}
            >
              <span className="material-symbols-outlined text-[15px]">{tool.icon}</span>
              <span>{tool.label}</span>
            </button>
          ))}

          <div className="h-5 w-px bg-[#919A9B]/20 mx-1" />

          <div className={`px-2 h-7 flex items-center rounded text-[10px] font-semibold ${
            drawMode ? 'bg-[#8AB4FF]/15 text-[#8AB4FF]' : 'bg-[#3BE494]/15 text-[#3BE494]'
          }`}>
            {drawMode ? 'Annotate Mode' : 'Select Mode'}
          </div>
          <div className={`px-2 h-7 flex items-center rounded text-[10px] font-semibold ${
            selectedAnnotationIdsArray.length > 0
              ? 'bg-[#3BE494]/15 text-[#3BE494]'
              : 'bg-[#919A9B]/10 text-[#919A9B]'
          }`}>
            Selected: {selectedAnnotationIdsArray.length}
          </div>

          {selectedAnnotationIdsArray.length > 0 && (
            <button
              onClick={() => {
                selectedAnnotationIdsArray.forEach(id => deleteAnnotation.mutate(id));
                clearSelection();
              }}
              className="h-8 px-2.5 flex items-center gap-1.5 rounded-md text-[11px] font-semibold text-[#FF897A] hover:bg-[#FF897A]/10"
              title="Delete selected annotations"
            >
              <span className="material-symbols-outlined text-[15px]">delete</span>
              <span>Delete Selected</span>
            </button>
          )}
        </div>
      )}

      {/* Placement mode banner */}
      {placementMode && placementEntity && (
        <div className="flex items-center justify-center gap-3 px-3 py-1.5 bg-[#FF897A]/10 border-b border-[#FF897A]/20 shrink-0">
          <span className="material-symbols-outlined text-[16px] text-[#FF897A] animate-pulse">my_location</span>
          <span className="text-[11px] text-[#FF897A] font-semibold">
            Click on the drawing to place "{placementEntity.tag}"
          </span>
          <button
            onClick={exitPlacementMode}
            className="text-[10px] text-[#919A9B] hover:text-[#D3DFE2] underline"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Main 3-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Tag List Panel */}
        {tagListPanelOpen && (
          <div className="shrink-0 relative" style={{ width: `${leftPanelWidth}px` }}>
            <TagListPanel
              overlay={overlay}
              annotations={annotations}
              systems={apiSystems}
              pnidId={selectedPnidId}
              onDraftAnnotation={(entity) => {
                selectEntity(entity.id, entity.entityType);
                setActiveTool('rectangle');
                setDrawMode(true, { id: entity.id, type: entity.entityType, tag: entity.tag });
              }}
            />
            <div
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize panel"
              onMouseDown={(e) => {
                leftResizeStart.current = { x: e.clientX, width: leftPanelWidth };
                setResizingLeft(true);
              }}
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-transparent hover:bg-[#3BE494]/30"
            />
          </div>
        )}

        {/* Center: P&ID Viewer */}
        <div className="flex-1 min-w-0 relative">
          {selectedPnidId ? (
            <>
              <PnidViewer
                pnidId={selectedPnidId}
                drawingNumber={selectedPnidInfo?.drawingNumber || ''}
                pnidTitle={selectedPnidInfo?.title || ''}
                onClose={onClose}
                embedded
                workspaceMode={{
                  selectedEntityId,
                  highlightEntityId,
                  panToEntity,
                  onClearHighlight: clearHighlight,
                  onEntitySelect: handleOverlaySelect,
                  placementMode,
                  onCanvasPlacement: handleCanvasPlacement,
                  overlayDisplayMode,
                  onSheetNavigate: handleSheetNavigate,
                  drawMode,
                  activeTool,
                  selectedAnnotationIds: selectedAnnotationIdsArray,
                  onSelectionChange: (ids) => setSelectedAnnotationIds(ids),
                  onCreateDrawingAnnotation: handleWorkspaceCreateAnnotation,
                  onClearSelection: clearSelection,
                  showUnpositionedLineList: false,
                  aiSuggestions,
                }}
              />
            </>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <span className="material-symbols-outlined text-[48px] text-[#919A9B]/20">description</span>
                <p className="text-[13px] text-[#919A9B] mt-3">Select a P&ID to begin annotating</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Properties Panel */}
        {propertiesPanelOpen && (
          <div className="w-60 shrink-0">
            <AnnotationPropertiesPanel
              overlay={overlay}
              annotations={annotations}
              pnidId={selectedPnidId}
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      <StatusBar pnidId={selectedPnidId} />

      {/* Manual drafting link flow (same as tested P&ID flow) */}
      {pendingManualAnnotation && selectedPnidId && (
        <LinkDialog
          pnidId={selectedPnidId}
          onLink={handleManualLink}
          onCancel={() => setPendingManualAnnotation(null)}
          onSkip={handleManualSkip}
        />
      )}
    </div>
  );
}
