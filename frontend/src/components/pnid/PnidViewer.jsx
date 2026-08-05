import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { md, systemColor } from '../../lib/theme';
import { useAuth } from '../../context/AuthContext';
import KonvaAnnotationStage from './konva/KonvaAnnotationStage';
import AnnotationToolbar, { ANNOTATION_CATEGORIES, TOOL_TO_CATEGORY } from './AnnotationToolbar';
import AnnotationPanel from './AnnotationPanel';
import OverlayLayer from './OverlayLayer';
import LinkDialog from './LinkDialog';
import PdfCanvas from './PdfCanvas';
import { useAnnotations, useOverlay, useCreateAnnotation, useUpdateAnnotation, useDeleteAnnotation, usePlaceEntity, useApproveAnnotation, usePnidImage, useLinkableEntities } from '../../hooks/useAnnotations';
import { useOcrExtract, useOcrResults, useOcrJob } from '../../hooks/useOcr';
import { useOcrNotifications } from '../../hooks/useOcrPipeline';
import { useOcrSuggestions } from '../../hooks/useCanvasGeneration';
import OcrReviewPanel from '../ocr/OcrReviewPanel';
import SmartIdentificationDrawStage from './smartIdent/SmartIdentificationDrawStage';
import SmartIdentDrawToolbar from './smartIdent/SmartIdentDrawToolbar';
import FlowAnimationOverlay from './smartIdent/FlowAnimationOverlay';
import SegmentAssignPanel from './smartIdent/SegmentAssignPanel';
import SmartIdentStatusPanel from './smartIdent/SmartIdentStatusPanel';
import SmartIdentRelationshipsView from './smartIdent/SmartIdentRelationshipsView';
import SmartIdentSymbolPicker from './smartIdent/SmartIdentSymbolPicker';
import SmartIdentIsolationPanel from './smartIdent/SmartIdentIsolationPanel';
import { buildSnapPoints } from './smartIdent/smartIdentSnap';
import { normalizeGuideLines } from './smartIdent/lineSnapEngine';
import {
  recomputeAllFlowSequences,
  reverseFlowDirection,
  computeDownstreamIsolation,
} from './smartIdent/flowDirection';
import {
  useSmartIdentHistory,
  buildCreateCommand,
  buildDeleteCommand,
  buildGeometryCommand,
  buildAssignCommand,
} from './smartIdent/smartIdentHistory';
import {
  useCreateDrawSession,
  useAddSmartSegment,
  useAssignSegment,
  useCreateSmartIdentEntity,
  useUpdateSegmentGeometry,
  useDeleteSmartSegment,
  useSmartIdentSessions,
  useSmartIdentSession,
  useGuideLines,
  useBatchFlowSequences,
  SMART_IDENT_COLORS,
} from '../../hooks/useSmartIdentification';
import PnidTagSearch from './PnidTagSearch';
import PnidTagRelationCard from './PnidTagRelationCard';
import {
  resolveEntityRelations,
  relatedEntityIdsFromRelations,
  findEntityPosition,
  buildEntityTagLookup,
} from './pnidTagSearchUtils';
import { useCustomPidSymbols } from '../../hooks/usePidSymbols';
import { setCustomPidSymbols } from './smartIdent/pidSymbolCatalog';

const SYSTEM_TYPE_COLORS = {
  process: systemColor('process'),
  utility: systemColor('utility'),
  safety: systemColor('safety'),
  instrument: systemColor('instrument'),
};

export default function PnidViewer({ pnidId, pnidTitle, drawingNumber, onClose, embedded, workspaceMode, initialFocus }) {
  const containerRef = useRef(null);
  const initialFocusAppliedRef = useRef(null);
  const { hasPermission } = useAuth();
  const canUseSmartAnnotation = hasPermission('smart_annotation.use');

  // Edit vs View mode
  const [editMode, setEditMode] = useState(false);
  const effectiveEditMode = embedded ? true : editMode;

  // Tool state
  const [activeTool, setActiveTool] = useState('select'); // select, pin, line, rectangle, circle, diamond, sym_*
  const [activeCategory, setActiveCategory] = useState(null); // equipment, instrument, piping, valve, general
  const [activeColor, setActiveColor] = useState(md.primary);
  const [activeStroke, setActiveStroke] = useState(2);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [selectedAnnotation, setSelectedAnnotation] = useState(null);
  const [overlayFilter, setOverlayFilter] = useState('all'); // all, equipment, instruments, lines
  const [pendingAnnotation, setPendingAnnotation] = useState(null); // shape data awaiting link

  // Pan/zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drawingSize, setDrawingSize] = useState({ width: 1200, height: 800 });

  // OCR state
  const [showOcrReview, setShowOcrReview] = useState(false);
  const [ocrJobId, setOcrJobId] = useState(null);
  const ocrExtract = useOcrExtract(pnidId);
  const { data: ocrResults } = useOcrResults(pnidId);
  const { data: ocrJobData } = useOcrJob(ocrJobId);

  // When OCR job completes, open review panel
  const ocrJobStatus = ocrJobData?.job?.status;
  useEffect(() => {
    if (ocrJobStatus === 'completed' && ocrJobId) {
      setOcrJobId(null);
      setShowOcrReview(true);
    }
  }, [ocrJobStatus, ocrJobId]);

  const hasOcrResults = (ocrResults?.summary?.total || 0) > 0;
  const ocrLoading = ocrExtract.isPending || ocrJobStatus === 'processing';

  // Smart Identification — manual draw mode
  const [smartIdentMode, setSmartIdentMode] = useState(false);
  const [smartIdentSession, setSmartIdentSession] = useState(null);
  const [smartIdentSegments, setSmartIdentSegments] = useState([]);
  const [selectedSmartSegment, setSelectedSmartSegment] = useState(null);
  const [smartIdentTool, setSmartIdentTool] = useState('line');
  const [smartIdentCategory, setSmartIdentCategory] = useState('piping');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showSmartIdentPanel, setShowSmartIdentPanel] = useState(true);
  const [showSmartIdentRelationships, setShowSmartIdentRelationships] = useState(false);
  const [showHierarchyStandalone, setShowHierarchyStandalone] = useState(false);
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [smartIdentSaveError, setSmartIdentSaveError] = useState(null);
  const [isolationState, setIsolationState] = useState(null);
  const [isolationResult, setIsolationResult] = useState(null);
  const [showAnimatedFlow, setShowAnimatedFlow] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [tagSearchHighlightId, setTagSearchHighlightId] = useState(null);
  const [tagSearchRelatedIds, setTagSearchRelatedIds] = useState([]);
  const [tagSearchSelection, setTagSearchSelection] = useState(null);
  const [tagSearchRelations, setTagSearchRelations] = useState(null);
  const smartIdentInitRef = useRef(false);
  const smartDrawStageRef = useRef(null);
  const smartIdentHistory = useSmartIdentHistory();

  // Drop smart-ident mode if permission is missing
  useEffect(() => {
    if (!canUseSmartAnnotation && smartIdentMode) {
      setSmartIdentMode(false);
    }
  }, [canUseSmartAnnotation, smartIdentMode]);
  const createDrawSession = useCreateDrawSession(pnidId);
  const addSmartSegment = useAddSmartSegment(pnidId);
  const assignSegment = useAssignSegment(pnidId, smartIdentSession?.id);
  const createSmartIdentEntity = useCreateSmartIdentEntity(pnidId, smartIdentSession?.id);
  const batchFlowSequences = useBatchFlowSequences(pnidId, smartIdentSession?.id);
  const updateSegmentGeometry = useUpdateSegmentGeometry(pnidId, smartIdentSession?.id);
  const deleteSmartSegment = useDeleteSmartSegment(pnidId, smartIdentSession?.id);
  const { data: savedSessions = [], isLoading: loadingSmartSessions } = useSmartIdentSessions(pnidId, smartIdentMode);
  const { data: searchSessions = [] } = useSmartIdentSessions(pnidId, !!pnidId);
  const searchSessionId = searchSessions[0]?.id;
  const { data: searchSessionData } = useSmartIdentSession(pnidId, searchSessionId);

  // OCR Notifications for this P&ID
  const { data: ocrNotif } = useOcrNotifications({ pnidId });

  // AI-assisted position suggestions (only when OCR bounding boxes exist and in edit mode)
  const { data: ocrSuggestions } = useOcrSuggestions(editMode && hasOcrResults ? pnidId : null);

  const handleRunOcr = useCallback(() => {
    if (hasOcrResults) {
      // Already has results — just open review panel
      setShowOcrReview(true);
      return;
    }
    ocrExtract.mutate(undefined, {
      onSuccess: (data) => {
        if (data.jobId) {
          setOcrJobId(data.jobId);
        }
      },
    });
  }, [hasOcrResults, ocrExtract]);

  const handleSmartIdentToggle = useCallback(() => {
    if (!canUseSmartAnnotation) return;
    setSmartIdentMode((prev) => {
      if (prev) {
        smartIdentInitRef.current = false;
        setSmartIdentSession(null);
        setSmartIdentSegments([]);
        setSelectedSmartSegment(null);
        setSmartIdentTool('line');
        setSmartIdentCategory('piping');
        setSmartIdentSaveError(null);
        setShowSmartIdentRelationships(false);
        setShowSymbolPicker(false);
        setIsolationState(null);
        setIsolationResult(null);
      } else {
        setSmartIdentTool('line');
        setSmartIdentCategory('piping');
        setShowSymbolPicker(true);
      }
      return !prev;
    });
  }, [canUseSmartAnnotation]);

  // Data
  const { data: annotations = [], isLoading: loadingAnnotations } = useAnnotations(pnidId);
  const { data: overlay, isLoading: loadingOverlay } = useOverlay(pnidId);
  const { data: linkable } = useLinkableEntities(pnidId);
  const { data: customPidSymbols = [] } = useCustomPidSymbols();

  useEffect(() => {
    setCustomPidSymbols(customPidSymbols);
  }, [customPidSymbols]);
  const { data: imageUrl } = usePnidImage(pnidId);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [contentType, setContentType] = useState(null);

  const [pdfPageCount, setPdfPageCount] = useState(1);
  const [pdfPage, setPdfPage] = useState(1);
  const [loadGuideLines, setLoadGuideLines] = useState(false);

  // Defer guide-line extraction — it blocks the backend for 30–90s on large PDFs
  useEffect(() => {
    if (!smartIdentMode || !snapEnabled) {
      setLoadGuideLines(false);
      return;
    }
    const t = setTimeout(() => setLoadGuideLines(true), 8000);
    return () => clearTimeout(t);
  }, [smartIdentMode, snapEnabled, pdfPage]);

  const { data: rawGuideLines = [] } = useGuideLines(
    pnidId,
    pdfPage,
    smartIdentMode && snapEnabled && loadGuideLines,
  );
  const guideLines = useMemo(() => normalizeGuideLines(rawGuideLines), [rawGuideLines]);

  const entitySnapPoints = useMemo(() => {
    if (!overlay) return [];
    return buildSnapPoints({
      equipment: overlay.equipment,
      instruments: overlay.instruments,
      lines: overlay.lines,
    });
  }, [overlay]);

  const relationshipSegments = useMemo(() => {
    if (smartIdentMode && smartIdentSegments.length) return smartIdentSegments;
    const segs = searchSessionData?.segments || [];
    const mode = searchSessionData?.session?.metadata?.mode;
    return segs.filter((s) => s.metadata?.source === 'manual' || mode === 'manual_draw');
  }, [smartIdentMode, smartIdentSegments, searchSessionData]);

  const flowLineSegments = useMemo(
    () => relationshipSegments.filter(
      (s) => s.segmentType === 'line' && (s.geometry?.points?.length || 0) >= 2,
    ),
    [relationshipSegments],
  );

  const tagLookup = useMemo(
    () => buildEntityTagLookup(linkable, overlay),
    [linkable, overlay],
  );

  const panToEntityPosition = useCallback((entityId) => {
    const pos = findEntityPosition(overlay, entityId);
    if (!pos) return false;
    const container = containerRef.current;
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    // Compute pan against the zoom we will actually apply — otherwise bumping
    // zoom after setPan sends the camera to the wrong place.
    const targetZoom = zoom < 0.8 ? 1 : zoom;
    const entityPx = {
      x: (pos.xPct / 100) * drawingSize.width,
      y: (pos.yPct / 100) * drawingSize.height,
    };
    setPan({
      x: rect.width / 2 - entityPx.x * targetZoom,
      y: rect.height / 2 - entityPx.y * targetZoom,
    });
    if (targetZoom !== zoom) setZoom(targetZoom);
    return true;
  }, [overlay, zoom, drawingSize]);

  const handleTagSearchSelect = useCallback((item) => {
    const relations = resolveEntityRelations(
      item.id,
      item.entityType,
      relationshipSegments,
      tagLookup,
    );
    const relatedIds = relatedEntityIdsFromRelations(relations)
      .filter((id) => id !== item.id);

    setTagSearchSelection(item);
    setTagSearchRelations(relations);
    setTagSearchHighlightId(item.id);
    setTagSearchRelatedIds(relatedIds);

    if (item.hasPosition) {
      panToEntityPosition(item.id);
    }

    const linkedSegment = relationshipSegments.find(
      (s) => s.linkedEntityId === item.id && (!item.entityType || s.linkedEntityType === item.entityType),
    );
    if (linkedSegment && smartIdentMode) {
      setSelectedSmartSegment(linkedSegment);
      setSmartIdentTool('select');
    }

    if (workspaceMode?.onEntitySelect) {
      workspaceMode.onEntitySelect({ id: item.id, entityType: item.entityType, tag: item.tag });
    }
  }, [relationshipSegments, tagLookup, panToEntityPosition, workspaceMode, smartIdentMode]);

  const handleTagRelationNavigate = useCallback((entityId, entityType) => {
    if (!entityId) return;
    const pos = findEntityPosition(overlay, entityId);
    const tag = tagLookup.get(entityId) || entityId;
    handleTagSearchSelect({
      id: entityId,
      entityType,
      tag,
      hasPosition: !!pos,
      position: pos,
    });
  }, [overlay, tagLookup, handleTagSearchSelect]);

  const clearTagSearchHighlight = useCallback(() => {
    setTagSearchHighlightId(null);
    setTagSearchRelatedIds([]);
    setTagSearchSelection(null);
    setTagSearchRelations(null);
  }, []);

  // Deep-link / external focus: pan + highlight once overlay is ready
  useEffect(() => {
    if (!initialFocus?.entityId || !overlay) return;
    const focusKey = `${pnidId}:${initialFocus.entityId}`;
    if (initialFocusAppliedRef.current === focusKey) return;
    initialFocusAppliedRef.current = focusKey;

    const tag = initialFocus.tag || tagLookup.get(initialFocus.entityId) || initialFocus.entityId;
    handleTagSearchSelect({
      id: initialFocus.entityId,
      entityType: initialFocus.entityType || 'equipment',
      tag,
      hasPosition: !!findEntityPosition(overlay, initialFocus.entityId),
      position: findEntityPosition(overlay, initialFocus.entityId),
    });
  }, [initialFocus?.entityId, initialFocus?.entityType, initialFocus?.tag, overlay, pnidId, tagLookup, handleTagSearchSelect]);

  const effectiveHighlightId = workspaceMode?.highlightEntityId || tagSearchHighlightId;

  useEffect(() => {
    if (!smartIdentMode) smartIdentHistory.clear();
  }, [smartIdentMode, smartIdentHistory]);

  /** Persist flowSequence updates to backend after local recompute. */
  const syncFlowSequences = useCallback((updatedSegments) => {
    const withSeq = updatedSegments.filter((s) => s.metadata?.flowSequence != null && !String(s.id).startsWith('temp-'));
    if (!withSeq.length || !smartIdentSession?.id) return;

    const flowSequences = withSeq.map((s) => ({
      segmentId: s.id,
      flowSequence: s.metadata.flowSequence,
    }));

    batchFlowSequences.mutate(
      { segmentId: withSeq[0].id, flowSequences },
      {
        onSuccess: (data) => {
          if (data?.updatedSegments?.length) {
            const byId = new Map(data.updatedSegments.map((s) => [s.id, s]));
            setSmartIdentSegments((prev) => prev.map((s) => byId.get(s.id) || s));
          }
        },
      },
    );
  }, [smartIdentSession?.id, batchFlowSequences]);

  const applyFlowSequencesLocally = useCallback((segments) => {
    const updated = recomputeAllFlowSequences(segments);
    setSmartIdentSegments(updated);
    syncFlowSequences(updated);
    return updated;
  }, [syncFlowSequences]);

  const handleReverseFlow = useCallback(() => {
    if (!selectedSmartSegment || selectedSmartSegment.segmentType !== 'line') return;
    if (String(selectedSmartSegment.id).startsWith('temp-')) return;

    const newDir = reverseFlowDirection(selectedSmartSegment);
    assignSegment.mutate(
      {
        segmentId: selectedSmartSegment.id,
        metadata: { flowDirection: newDir },
      },
      {
        onSuccess: (data) => {
          const updated = data.segment;
          setSmartIdentSegments((prev) => {
            const next = prev.map((s) => (s.id === updated.id ? updated : s));
            return recomputeAllFlowSequences(next);
          });
          setSelectedSmartSegment(updated);
          applyFlowSequencesLocally(
            smartIdentSegments.map((s) => (s.id === updated.id ? updated : s)),
          );
        },
      },
    );
  }, [selectedSmartSegment, assignSegment, smartIdentSegments, applyFlowSequencesLocally]);

  const handleRunIsolation = useCallback((seg) => {
    const target = seg || selectedSmartSegment;
    if (!target) return;
    const result = computeDownstreamIsolation(smartIdentSegments, target.id);
    setIsolationResult(result);
    setIsolationState({
      active: true,
      shutdownId: target.id,
      affectedIds: result.affectedIds,
      boundaryIds: result.boundaryIds,
    });
  }, [selectedSmartSegment, smartIdentSegments]);

  const handleClearIsolation = useCallback(() => {
    setIsolationState(null);
    setIsolationResult(null);
  }, []);
  useEffect(() => {
    if (!smartIdentMode) {
      smartIdentInitRef.current = false;
      return;
    }
    if (smartIdentSession || smartIdentInitRef.current) return;
    if (loadingSmartSessions) return;

    smartIdentInitRef.current = true;
    const apiBase = import.meta.env.VITE_API_URL || '/api/v1';

    const loadSession = async (sessionId) => {
      const res = await fetch(`${apiBase}/pnids/${pnidId}/smart-ident/sessions/${sessionId}`);
      if (!res.ok) throw new Error('Failed to load session');
      const data = await res.json();
      if (data?.session) {
        const segments = (data.segments || []).filter(
          (s) => s.metadata?.source === 'manual' || data.session.metadata?.mode === 'manual_draw'
        );
        setSmartIdentSession(data.session);
        setSmartIdentSegments(segments);
        setSmartIdentSaveError(null);
      }
    };

    const pickResumeSession = () => {
      const onPage = savedSessions.filter((s) => s.pageNumber === pdfPage);
      const pool = onPage.length ? onPage : savedSessions;
      return [...pool]
        .filter((s) => s.status === 'ready' && s.metadata?.mode === 'manual_draw')
        .sort((a, b) => {
          const bySegments = (b.segmentCount || 0) - (a.segmentCount || 0);
          if (bySegments !== 0) return bySegments;
          return new Date(b.updatedAt) - new Date(a.updatedAt);
        })[0];
    };

    const resume = pickResumeSession();
    if (resume?.id) {
      loadSession(resume.id).catch(() => {
        smartIdentInitRef.current = false;
        setSmartIdentSaveError('Could not resume draw session');
      });
      return;
    }

    createDrawSession.mutate(
      { pageNumber: pdfPage },
      {
        onSuccess: (data) => {
          setSmartIdentSession(data.session);
          setSmartIdentSegments(data.segments || []);
          setSmartIdentSaveError(null);
        },
        onError: () => {
          smartIdentInitRef.current = false;
          setSmartIdentSaveError('Could not start draw session');
        },
      }
    );
  }, [smartIdentMode, smartIdentSession, loadingSmartSessions, savedSessions, pnidId, pdfPage, createDrawSession]);

  const handleSmartSegmentCreated = useCallback((payload) => {
    const sessionId = smartIdentSession?.id;
    if (!sessionId) {
      setSmartIdentSaveError('Session not ready — wait a moment and try again');
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      sessionId,
      pnidId,
      segmentType: payload.segmentType,
      geometry: payload.geometry,
      metadata: payload.metadata || {},
      displayColor: payload.displayColor,
      linkedEntityId: null,
      linkedEntityType: null,
    };

    setSmartIdentSegments((prev) => [...prev, optimistic]);
    setSmartIdentSaveError(null);

    addSmartSegment.mutate(
      { sessionId, ...payload },
      {
        onSuccess: (data) => {
          const seg = data.segment;
          setSmartIdentSegments((prev) => prev.map((s) => (s.id === tempId ? seg : s)));
          smartIdentHistory.push(buildCreateCommand({
            segment: seg,
            payload,
            sessionId,
            addSmartSegment,
            deleteSmartSegment,
            setSegments: setSmartIdentSegments,
            setSelected: setSelectedSmartSegment,
          }));
        },
        onError: (err) => {
          setSmartIdentSegments((prev) => prev.filter((s) => s.id !== tempId));
          setSmartIdentSaveError(err?.message || 'Failed to save segment');
        },
      }
    );
  }, [smartIdentSession?.id, pnidId, addSmartSegment, deleteSmartSegment, smartIdentHistory]);

  const handleSmartSegmentSelect = useCallback((seg) => {
    setSelectedSmartSegment(seg);
    // Don't switch tool — user stays on line/trace to keep drawing nearby
  }, []);

  const handleSmartSegmentAssign = useCallback((payload) => {
    if (!selectedSmartSegment || String(selectedSmartSegment.id).startsWith('temp-')) {
      setSmartIdentSaveError('Shape is still saving — wait a moment, then try again');
      return;
    }
    setSmartIdentSaveError(null);
    const before = {
      linkedEntityType: selectedSmartSegment.linkedEntityType,
      linkedEntityId: selectedSmartSegment.linkedEntityId,
      parentSegmentId: selectedSmartSegment.parentSegmentId,
      label: selectedSmartSegment.metadata?.label,
      displayColor: selectedSmartSegment.displayColor,
    };
    const { autoParentLine, ...assignPayload } = payload;

    // Optimistic color so flow stroke/animation update immediately
    if (assignPayload.displayColor) {
      const optimistic = { ...selectedSmartSegment, displayColor: assignPayload.displayColor };
      setSmartIdentSegments((prev) =>
        prev.map((s) => (s.id === selectedSmartSegment.id ? optimistic : s))
      );
      setSelectedSmartSegment(optimistic);
    }

    assignSegment.mutate(
      { segmentId: selectedSmartSegment.id, ...assignPayload },
      {
        onSuccess: (data) => {
          const updated = data.segment;
          setSmartIdentSegments((prev) => {
            let next = prev.map((s) => (s.id === updated.id ? updated : s));
            next = recomputeAllFlowSequences(next);
            syncFlowSequences(next);
            return next;
          });
          setSelectedSmartSegment(updated);
          setSmartIdentSaveError(null);
          smartIdentHistory.push(buildAssignCommand({
            segmentId: selectedSmartSegment.id,
            before,
            after: assignPayload,
            assignSegment,
            setSegments: setSmartIdentSegments,
            setSelected: setSelectedSmartSegment,
            syncFlowSequences: (segments) => {
              const next = recomputeAllFlowSequences(segments);
              syncFlowSequences(next);
              return next;
            },
          }));
        },
        onError: (err) => {
          if (assignPayload.displayColor) {
            setSmartIdentSegments((prev) =>
              prev.map((s) => (s.id === selectedSmartSegment.id ? selectedSmartSegment : s))
            );
            setSelectedSmartSegment(selectedSmartSegment);
          }
          setSmartIdentSaveError(err?.message || 'Failed to assign segment');
        },
      }
    );
  }, [selectedSmartSegment, assignSegment, syncFlowSequences]);

  const handleCreateSmartEntity = useCallback((payload) => {
    if (!selectedSmartSegment || String(selectedSmartSegment.id).startsWith('temp-')) {
      setSmartIdentSaveError('Shape is still saving — wait a moment, then try again');
      return;
    }

    setSmartIdentSaveError(null);
    createSmartIdentEntity.mutate(
      {
        ...payload,
        geometry: selectedSmartSegment.geometry,
      },
      {
        onSuccess: (data) => {
          const entity = data?.entity;
          if (!entity?.id) {
            setSmartIdentSaveError('Created entity was returned without an id');
            return;
          }
          handleSmartSegmentAssign({
            linkedEntityType: payload.entityType,
            linkedEntityId: entity.id,
            parentSegmentId: payload.parentSegmentId || null,
            label: entity.label || entity.tag || entity.lineNumber || payload.tag,
          });
        },
        onError: (err) => {
          setSmartIdentSaveError(err?.message || 'Failed to create missing entity');
        },
      }
    );
  }, [selectedSmartSegment, createSmartIdentEntity, handleSmartSegmentAssign]);

  const handleSmartSegmentGeometryChange = useCallback((seg, geometry, opts = {}) => {
    if (!seg?.id || String(seg.id).startsWith('temp-')) return;

    const beforeGeometry = opts.previousGeometry || seg.geometry;

    setSmartIdentSegments((prev) =>
      prev.map((s) => (s.id === seg.id ? { ...s, geometry } : s))
    );
    setSelectedSmartSegment((prev) => (prev?.id === seg.id ? { ...prev, geometry } : prev));

    updateSegmentGeometry.mutate(
      { segmentId: seg.id, geometry },
      {
        onSuccess: (data) => {
          const updated = data.segment;
          setSmartIdentSegments((prev) =>
            prev.map((s) => (s.id === updated.id ? updated : s))
          );
          setSelectedSmartSegment((prev) => (prev?.id === updated.id ? updated : prev));
          smartIdentHistory.push(buildGeometryCommand({
            segmentId: seg.id,
            beforeGeometry,
            afterGeometry: geometry,
            updateSegmentGeometry,
            setSegments: setSmartIdentSegments,
            setSelected: setSelectedSmartSegment,
          }));
        },
        onError: (err) => {
          setSmartIdentSaveError(err?.message || 'Failed to save symbol transform');
        },
      }
    );
  }, [updateSegmentGeometry, smartIdentHistory]);

  const handleSmartSegmentDelete = useCallback((segmentId) => {
    const id = segmentId || selectedSmartSegment?.id;
    if (!id) return;

    if (String(id).startsWith('temp-')) {
      setSmartIdentSegments((prev) => prev.filter((s) => s.id !== id));
      if (selectedSmartSegment?.id === id) setSelectedSmartSegment(null);
      return;
    }

    const deletedSeg = smartIdentSegments.find((s) => s.id === id);
    const sessionId = smartIdentSession?.id;

    deleteSmartSegment.mutate(id, {
      onSuccess: () => {
        setSmartIdentSegments((prev) => prev.filter((s) => s.id !== id));
        if (selectedSmartSegment?.id === id) setSelectedSmartSegment(null);
        setSmartIdentSaveError(null);
        if (deletedSeg && sessionId) {
          smartIdentHistory.push(buildDeleteCommand({
            segment: deletedSeg,
            sessionId,
            addSmartSegment,
            deleteSmartSegment,
            setSegments: setSmartIdentSegments,
            setSelected: setSelectedSmartSegment,
          }));
        }
      },
      onError: (err) => {
        setSmartIdentSaveError(err?.message || 'Failed to delete shape');
      },
    });
  }, [selectedSmartSegment, deleteSmartSegment, smartIdentSegments, smartIdentSession?.id, addSmartSegment, smartIdentHistory]);

  const handleSmartIdentUndo = useCallback(async () => {
    const ok = await smartIdentHistory.undo();
    if (!ok) setSmartIdentSaveError('Nothing to undo');
    else setSmartIdentSaveError(null);
  }, [smartIdentHistory]);

  const handleSmartIdentRedo = useCallback(async () => {
    const ok = await smartIdentHistory.redo();
    if (!ok) setSmartIdentSaveError('Nothing to redo');
    else setSmartIdentSaveError(null);
  }, [smartIdentHistory]);

  const handleSmartIdentReset = useCallback(() => {
    setSelectedSmartSegment(null);
    createDrawSession.mutate(
      { pageNumber: pdfPage },
      {
        onSuccess: (data) => {
          setSmartIdentSession(data.session);
          setSmartIdentSegments([]);
        },
      }
    );
  }, [createDrawSession, pdfPage]);

  // Detect content type via HEAD request so we render PDF vs image correctly
  useEffect(() => {
    if (!imageUrl) { setContentType(null); return; }
    setImageLoaded(false);
    setImageError(false);
    setContentType(null);
    fetch(imageUrl, { method: 'HEAD' })
      .then(res => {
        if (!res.ok) { setImageError(true); return; }
        const ct = res.headers.get('content-type') || '';
        setContentType(ct.includes('pdf') ? 'pdf' : 'image');
      })
      .catch(() => setImageError(true));
  }, [imageUrl]);

  const createAnnotation = useCreateAnnotation(pnidId);
  const updateAnnotation = useUpdateAnnotation(pnidId);
  const deleteAnnotation = useDeleteAnnotation(pnidId);
  const placeEntity = usePlaceEntity(pnidId);

  // Zoom controls
  const handleZoomIn = () => setZoom(z => Math.min(z * 1.25, 5));
  const handleZoomOut = () => setZoom(z => Math.max(z / 1.25, 0.25));
  const handleZoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.min(Math.max(z * delta, 0.25), 5));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // Pan behavior:
  // - Always allow middle mouse drag.
  // - In workspace, left click is reserved for selection/drawing.
  // - Optional: hold Alt + left drag to pan.
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const resolvedTool = embedded
    ? (workspaceMode?.drawMode ? (workspaceMode?.activeTool || 'rectangle') : 'select')
    : (effectiveEditMode ? activeTool : 'select');

  const handlePanStart = useCallback((e) => {
    // In workspace draw mode, never start panning on left click; let Konva consume drag-to-draw.
    if (workspaceMode?.drawMode && e.button === 0) {
      return;
    }
    const allowLeftPan = !!e.altKey && e.button === 0;
    if (e.button === 1 || allowLeftPan) {
      isPanning.current = true;
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      e.preventDefault();
    }
  }, [workspaceMode?.drawMode, pan]);

  const handlePanMove = useCallback((e) => {
    if (isPanning.current) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
    }
  }, []);

  const handlePanEnd = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Create annotation from canvas — either save directly or show LinkDialog
  const handleCreateAnnotation = useCallback((annotationData) => {
    if (embedded && workspaceMode?.onCreateDrawingAnnotation) {
      workspaceMode.onCreateDrawingAnnotation(annotationData);
      return;
    }
    const data = {
      ...annotationData,
      color: activeColor,
      strokeWidth: activeStroke,
      _category: activeCategory, // track which category was active
    };

    // Determine if we should prompt for entity linking
    // Connection mode always needs linking; categories with entity intent show LinkDialog
    const isConnection = annotationData.metadata?.isConnection;
    const needsLink = isConnection || (activeCategory && activeCategory !== 'general');

    if (needsLink) {
      // Show link dialog for equipment/instrument/piping/valve categories
      setPendingAnnotation(data);
    } else {
      // Save directly without linking (general annotations)
      createAnnotation.mutate({
        annotationType: data.annotationType || 'highlight',
        shape: data.shape,
        xPct: data.xPct,
        yPct: data.yPct,
        wPct: data.wPct,
        hPct: data.hPct,
        x2Pct: data.x2Pct,
        y2Pct: data.y2Pct,
        color: data.color,
        strokeWidth: data.strokeWidth,
        text: data.text || null,
        metadata: data.metadata || {},
      });
    }
  }, [embedded, workspaceMode, activeColor, activeStroke, activeCategory, createAnnotation]);

  // Called when user selects/creates entity in LinkDialog
  const handleLinkEntity = useCallback((linkData) => {
    if (!pendingAnnotation) return;
    placeEntity.mutate({
      ...linkData,
      xPct: pendingAnnotation.xPct,
      yPct: pendingAnnotation.yPct,
      wPct: pendingAnnotation.wPct,
      hPct: pendingAnnotation.hPct,
      x2Pct: pendingAnnotation.x2Pct,
      y2Pct: pendingAnnotation.y2Pct,
      shape: pendingAnnotation.shape,
      color: pendingAnnotation.color,
      strokeWidth: pendingAnnotation.strokeWidth,
    });
    setPendingAnnotation(null);
    setActiveTool('select');
  }, [pendingAnnotation, placeEntity]);

  const handleCancelLink = useCallback(() => {
    setPendingAnnotation(null);
    setActiveTool('select');
  }, []);

  // Accept an OCR-suggested position — auto-place the entity at the suggested coordinates
  const handleAcceptSuggestion = useCallback((suggestion) => {
    if (String(suggestion?.entityId || '').startsWith('ai-')) return;
    placeEntity.mutate({
      entityType: suggestion.entityType,
      entityId: suggestion.entityId,
      xPct: suggestion.suggestedXPct,
      yPct: suggestion.suggestedYPct,
      wPct: suggestion.suggestedWPct || 4,
      hPct: suggestion.suggestedHPct || 3,
      shape: suggestion.entityType === 'instrument' ? 'circle' : 'rectangle',
      color: suggestion.entityType === 'instrument' ? '#F39C12' : '#3BE494',
      strokeWidth: 2,
    });
  }, [placeEntity]);

  const mergedSuggestions = useMemo(() => {
    const base = effectiveEditMode && hasOcrResults ? (ocrSuggestions || []) : [];
    const pilot = workspaceMode?.aiSuggestions || [];
    return [...base, ...pilot];
  }, [effectiveEditMode, hasOcrResults, ocrSuggestions, workspaceMode?.aiSuggestions]);

  const handleSelectAnnotation = useCallback((ann, additive = false) => {
    setSelectedAnnotation(ann);
    if (workspaceMode?.onEntitySelect && ann?.linkedEntityId) {
      workspaceMode.onEntitySelect({
        id: ann.linkedEntityId,
        entityType: ann.linkedEntityType,
      });
    }
    if (workspaceMode?.onSelectionChange && ann?.id) {
      if (additive) {
        const current = Array.isArray(workspaceMode.selectedAnnotationIds) ? workspaceMode.selectedAnnotationIds : [];
        const next = current.includes(ann.id) ? current.filter(id => id !== ann.id) : [...current, ann.id];
        workspaceMode.onSelectionChange(next);
      } else {
        workspaceMode.onSelectionChange([ann.id]);
      }
    }
  }, [workspaceMode]);

  const handleDeleteAnnotation = useCallback((annotationId) => {
    // Block deletion of approved annotations
    const ann = annotations.find(a => a.id === annotationId);
    if (ann?.approvalStatus === 'approved') return;
    deleteAnnotation.mutate(annotationId);
    if (selectedAnnotation?.id === annotationId) setSelectedAnnotation(null);
  }, [deleteAnnotation, selectedAnnotation, annotations]);

  const handleUpdateAnnotation = useCallback((annotationId, data) => {
    // Block updates to approved annotations
    const ann = annotations.find(a => a.id === annotationId);
    if (ann?.approvalStatus === 'approved') return;
    updateAnnotation.mutate({ annotationId, ...data });
  }, [updateAnnotation, annotations]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      if (smartIdentMode) {
        switch (e.key) {
          case 'l': case 'L':
            setSmartIdentCategory('piping');
            setSmartIdentTool('line');
            setSelectedSmartSegment(null);
            break;
          case 't': case 'T':
            setSmartIdentCategory('piping');
            setSmartIdentTool('trace');
            setSelectedSmartSegment(null);
            break;
          case 'v': case 'V':
            setSmartIdentTool('select');
            break;
          case 'Escape': {
            const stage = smartDrawStageRef.current;
            if (stage?.hasInProgressDraw?.()) {
              if (smartIdentTool === 'trace' && stage?.popTracePoint?.()) break;
              stage?.cancelInProgressDraw?.();
              break;
            }
            setSelectedSmartSegment(null);
            break;
          }
          case 'z':
          case 'Z':
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              if (e.shiftKey) handleSmartIdentRedo();
              else handleSmartIdentUndo();
            }
            break;
          case 'y':
          case 'Y':
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              handleSmartIdentRedo();
            }
            break;
          case 'Delete': case 'Backspace':
            if (selectedSmartSegment) {
              e.preventDefault();
              handleSmartSegmentDelete(selectedSmartSegment.id);
            }
            break;
          default:
            break;
        }
        return;
      }

      switch (e.key) {
        case 'e': case 'E':
          setEditMode(m => {
            const next = !m;
            if (next && !activeCategory) {
              setActiveCategory('general');
              setActiveTool('rectangle');
            }
            return next;
          });
          break;
        case 'Escape':
          if (effectiveEditMode) { setActiveTool('select'); setActiveCategory(null); setSelectedAnnotation(null); workspaceMode?.onClearSelection?.(); }
          break;
        case 'Delete': case 'Backspace':
          if (effectiveEditMode && selectedAnnotation) handleDeleteAnnotation(selectedAnnotation.id);
          break;
        default:
          if (!effectiveEditMode) break;
          switch (e.key) {
            case 'v': case 'V': setActiveTool('select'); setActiveCategory(null); break;
            case 'p': case 'P': setActiveTool('pin'); if (!activeCategory) setActiveCategory('general'); break;
            case 'l': case 'L': setActiveTool('line'); if (!activeCategory) setActiveCategory('general'); break;
            case 'r': case 'R': setActiveTool('rectangle'); if (!activeCategory) setActiveCategory('general'); break;
            case 'c': case 'C': setActiveTool('circle'); if (!activeCategory) setActiveCategory('general'); break;
            case 'd': case 'D': setActiveTool('diamond'); if (!activeCategory) setActiveCategory('general'); break;
          }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [effectiveEditMode, smartIdentMode, selectedAnnotation, selectedSmartSegment, smartIdentTool, handleDeleteAnnotation, handleSmartSegmentDelete, handleSmartIdentUndo, handleSmartIdentRedo, activeCategory, workspaceMode]);

  // Workspace mode: handle placement clicks on the canvas
  const handleCanvasClick = useCallback((e) => {
    if (!workspaceMode?.placementMode || !workspaceMode?.onCanvasPlacement) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Convert click position to percentage of drawing
    const rawX = (e.clientX - rect.left - pan.x) / zoom;
    const rawY = (e.clientY - rect.top - pan.y) / zoom;
    const xPct = (rawX / drawingSize.width) * 100;
    const yPct = (rawY / drawingSize.height) * 100;
    if (xPct >= 0 && xPct <= 100 && yPct >= 0 && yPct <= 100) {
      workspaceMode.onCanvasPlacement(xPct, yPct);
    }
  }, [workspaceMode, pan, zoom, drawingSize]);

  // Workspace mode: pan to highlighted entity
  useEffect(() => {
    if (!workspaceMode?.panToEntity || !overlay) return;
    const entityId = workspaceMode.highlightEntityId;
    if (!entityId) return;
    const pos = findEntityPosition(overlay, entityId);
    if (pos) {
      // Pan to center the entity in the viewport
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const targetZoom = zoom < 0.8 ? 1 : zoom;
        const entityPx = {
          x: (pos.xPct / 100) * drawingSize.width,
          y: (pos.yPct / 100) * drawingSize.height,
        };
        setPan({
          x: rect.width / 2 - entityPx.x * targetZoom,
          y: rect.height / 2 - entityPx.y * targetZoom,
        });
        if (targetZoom !== zoom) setZoom(targetZoom);
      }
    }
    // Clear highlight after panning
    const timer = setTimeout(() => workspaceMode.onClearHighlight?.(), 2000);
    return () => clearTimeout(timer);
  }, [workspaceMode?.highlightEntityId, overlay]);

  return (
    <div className="flex flex-col h-full w-full bg-md-surface">
      {/* Header — compact in embedded workspace mode */}
      <div className={`flex items-center px-3 ${embedded ? 'py-1' : 'py-2'} bg-md-surface-container border-b border-md-outline-variant/30 gap-3 shrink-0`}>
        {!embedded && <>
          <button onClick={onClose} className="text-md-on-surface-variant hover:text-md-on-surface text-sm">
            &larr; Back
          </button>
          <div className="h-4 w-px bg-md-outline-variant/30" />
        </>}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="min-w-0 shrink">
            <span className="text-sm font-bold text-md-on-surface truncate">{drawingNumber}</span>
            {pnidTitle && <span className="text-xs text-md-on-surface-variant ml-2 truncate">{pnidTitle}</span>}
          </div>
          <PnidTagSearch
            pnidId={pnidId}
            overlay={overlay}
            smartIdentSegments={relationshipSegments}
            onSelectTag={handleTagSearchSelect}
            className="flex-1 max-w-md hidden sm:block"
          />
        </div>
        <span className="text-[10px] text-md-on-surface-variant">
          {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
        </span>

        {/* OCR & AI badges — hidden in embedded workspace mode */}
        {!embedded && <>
          {/* OCR Notification Badge */}
          {ocrNotif?.hasOcrResults && ocrNotif.pendingReview > 0 && (
            <button
              onClick={() => setShowOcrReview(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-md-full text-[10px] font-bold transition-all animate-pulse hover:animate-none"
              style={{ background: '#E67E2225', color: '#E67E22', border: '1px solid #E67E2240' }}
              title={`${ocrNotif.pendingReview} OCR extractions pending review (${ocrNotif.readyToApprove} ready to auto-approve)`}
            >
              <span className="material-symbols-outlined text-[14px]">document_scanner</span>
              <span>{ocrNotif.pendingReview} OCR pending</span>
              {ocrNotif.readyToApprove > 0 && (
                <span className="px-1 py-0.5 rounded-md-full bg-green-600/20 text-green-400 text-[9px]">
                  {ocrNotif.readyToApprove} ready
                </span>
              )}
            </button>
          )}

          {ocrNotif?.hasOcrResults && ocrNotif.pendingReview === 0 && ocrNotif.approved > 0 && (
            <span
              className="flex items-center gap-1 px-2 py-1 rounded-md-full text-[10px] font-semibold"
              style={{ background: '#3BE49415', color: '#3BE494' }}
              title={`${ocrNotif.approved} OCR annotations applied`}
            >
              <span className="material-symbols-outlined text-[12px]">check_circle</span>
              OCR applied
            </span>
          )}

          {/* AI Assistance Mode Badge with tier counts */}
          {hasOcrResults ? (
            <span
              className="flex items-center gap-1 px-2 py-1 rounded-md-full text-[9px] font-bold"
              style={{ background: '#3BE49415', color: '#3BE494', border: '1px solid #3BE49430' }}
              title="OCR bounding boxes available — AI can suggest entity positions during drafting"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              AI Positioning
              {ocrSuggestions?.length > 0 && (
                <span style={{ opacity: 0.7 }}>
                  ({ocrSuggestions.filter(s => s.tier === 'auto').length} auto, {ocrSuggestions.filter(s => s.tier === 'ghost').length} suggest)
                </span>
              )}
            </span>
          ) : (
            <span
              className="flex items-center gap-1 px-2 py-1 rounded-md-full text-[9px] font-semibold"
              style={{ background: '#919A9B15', color: '#919A9B' }}
              title="No OCR data with coordinates — manual entity placement only"
            >
              Manual Only
            </span>
          )}
        </>}

        {/* Auto-Place All button — batch-place high-confidence entities */}
        {editMode && ocrSuggestions?.some(s => s.tier === 'auto') && (
          <button
            onClick={() => {
              ocrSuggestions
                .filter(s => s.tier === 'auto')
                .forEach(sug => handleAcceptSuggestion(sug));
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold transition-colors hover:opacity-80"
            style={{ background: '#3BE49425', color: '#3BE494', border: '1px solid #3BE49440' }}
            title="Auto-place all high-confidence entities at their OCR-detected positions"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Auto-Place All ({ocrSuggestions.filter(s => s.tier === 'auto').length})
          </button>
        )}

        {/* Smart Identification toggle */}
        {canUseSmartAnnotation && (
        <button
          onClick={handleSmartIdentToggle}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-colors"
          style={{
            background: smartIdentMode ? `${SMART_IDENT_COLORS.boundary}25` : 'transparent',
            color: smartIdentMode ? SMART_IDENT_COLORS.boundary : md.onSurfaceVariant,
            border: `1px solid ${smartIdentMode ? SMART_IDENT_COLORS.boundary : md.outlineVariant}`,
          }}
          title="Draw lines &amp; ISA symbols on the P&amp;ID, assign to equipment/lines"
        >
          <span className="material-symbols-outlined text-[14px]">draw</span>
          Smart Identification
          {smartIdentMode && smartIdentSegments.length > 0 && (
            <span className="opacity-70">({smartIdentSegments.filter(s => s.linkedEntityId).length}/{smartIdentSegments.length})</span>
          )}
        </button>
        )}

        {canUseSmartAnnotation && smartIdentMode && (
          <button
            onClick={handleSmartIdentReset}
            className="text-[9px] px-2 py-1 rounded"
            style={{ color: md.onSurfaceVariant, border: `1px solid ${md.outlineVariant}` }}
          >
            New session
          </button>
        )}

        {/* Flow Hierarchy (viewable outside Smart Identification) */}
        {!smartIdentMode && (
          <button
            onClick={() => setShowHierarchyStandalone(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-colors"
            style={{
              background: 'transparent',
              color: md.onSurfaceVariant,
              border: `1px solid ${md.outlineVariant}`,
            }}
            title="View the parent-child flow hierarchy for this P&ID"
          >
            <span className="material-symbols-outlined text-[14px]">account_tree</span>
            Hierarchy
            {relationshipSegments.length > 0 && (
              <span className="opacity-70">({relationshipSegments.length})</span>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowAnimatedFlow((v) => !v)}
          disabled={flowLineSegments.length === 0}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: showAnimatedFlow ? 'rgba(59,228,148,0.18)' : 'transparent',
            color: showAnimatedFlow ? '#3BE494' : md.onSurfaceVariant,
            border: `1px solid ${showAnimatedFlow ? 'rgba(59,228,148,0.45)' : md.outlineVariant}`,
          }}
          title={
            flowLineSegments.length === 0
              ? 'No flow lines yet — draw lines in Smart Identification first'
              : 'Animate process flow along identified lines'
          }
        >
          <span className="material-symbols-outlined text-[14px]">air</span>
          {showAnimatedFlow ? 'Hide Flow' : 'Show Flow'}
          {flowLineSegments.length > 0 && (
            <span className="opacity-70">({flowLineSegments.length})</span>
          )}
        </button>

        {/* Edit / View mode toggle */}
        {!embedded && (
          <button
            onClick={() => {
              setEditMode(m => {
                const next = !m;
                if (next && !activeCategory) {
                  setActiveCategory('general');
                  setActiveTool('rectangle');
                }
                return next;
              });
            }}
            className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
              editMode
                ? 'bg-md-primary text-md-on-primary'
                : 'bg-md-surface-container-high text-md-on-surface-variant hover:text-md-on-surface'
            }`}
          >
            {editMode ? 'Editing' : 'View'}
          </button>
        )}
        {/* Zoom + Page navigation */}
        <div className="flex items-center gap-1.5">
          <button onClick={handleZoomOut} className="text-md-on-surface-variant hover:text-md-on-surface px-1 text-sm font-bold">&minus;</button>
          <span className="text-[10px] text-md-primary px-2 py-0.5 bg-md-primary/10 rounded min-w-[40px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={handleZoomIn} className="text-md-on-surface-variant hover:text-md-on-surface px-1 text-sm font-bold">+</button>
          <button onClick={handleZoomReset} className="text-[9px] text-md-on-surface-variant hover:text-md-on-surface px-1">Fit</button>
        </div>
        {/* Multi-sheet page navigation (PDF only) */}
        {contentType === 'pdf' && pdfPageCount > 1 && (
          <div className="flex items-center gap-1 border-l border-md-outline-variant/30 pl-2">
            <button
              onClick={() => setPdfPage(p => Math.max(1, p - 1))}
              disabled={pdfPage <= 1}
              className="text-md-on-surface-variant hover:text-md-on-surface disabled:opacity-30 text-xs px-1"
            >
              &lsaquo;
            </button>
            <span className="text-[10px] text-md-on-surface-variant">
              Sheet <span className="font-bold text-md-on-surface">{pdfPage}</span> / {pdfPageCount}
            </span>
            <button
              onClick={() => setPdfPage(p => Math.min(pdfPageCount, p + 1))}
              disabled={pdfPage >= pdfPageCount}
              className="text-md-on-surface-variant hover:text-md-on-surface disabled:opacity-30 text-xs px-1"
            >
              &rsaquo;
            </button>
          </div>
        )}
        {contentType === 'pdf' && pdfPageCount === 1 && (
          <span className="text-[10px] text-md-on-surface-variant border-l border-md-outline-variant/30 pl-2">
            Sheet 1 / 1
          </span>
        )}
      </div>

      <div className="px-3 py-2 bg-md-surface-container border-b border-md-outline-variant/20 sm:hidden shrink-0">
        <PnidTagSearch
          pnidId={pnidId}
          overlay={overlay}
          smartIdentSegments={relationshipSegments}
          onSelectTag={handleTagSearchSelect}
        />
      </div>

      {/* Toolbar — only in edit mode */}
      {!embedded && editMode && (
        <AnnotationToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          activeColor={activeColor}
          onColorChange={setActiveColor}
          activeStroke={activeStroke}
          onStrokeChange={setActiveStroke}
          showOverlay={showOverlay}
          onToggleOverlay={() => setShowOverlay(!showOverlay)}
          showAnnotations={showAnnotations}
          onToggleAnnotations={() => setShowAnnotations(!showAnnotations)}
          showLabels={showLabels}
          onToggleLabels={() => setShowLabels(!showLabels)}
          overlayFilter={overlayFilter}
          onOverlayFilterChange={setOverlayFilter}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          onRunOcr={handleRunOcr}
          ocrLoading={ocrLoading}
          hasOcrResults={hasOcrResults}
          selectedAnnotation={selectedAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          showSymbolPicker={showSymbolPicker}
          onToggleSymbolPicker={() => setShowSymbolPicker((v) => !v)}
        />
      )}

      {smartIdentMode && (
        <SmartIdentDrawToolbar
          activeTool={smartIdentTool}
          activeCategory={smartIdentCategory}
          onToolChange={setSmartIdentTool}
          onCategoryChange={setSmartIdentCategory}
          onViewRelationships={() => setShowSmartIdentRelationships(true)}
          onOpenSymbolPicker={() => setShowSymbolPicker((v) => !v)}
          symbolPickerOpen={showSymbolPicker}
          segmentCount={smartIdentSegments.length}
          selectedSegment={selectedSmartSegment}
          onDeleteSegment={handleSmartSegmentDelete}
          deletingSegment={deleteSmartSegment.isPending}
          onRunIsolation={() => handleRunIsolation(selectedSmartSegment)}
          isolationActive={!!isolationState?.active}
          onClearIsolation={handleClearIsolation}
          canUndo={smartIdentHistory.canUndo}
          canRedo={smartIdentHistory.canRedo}
          onUndo={handleSmartIdentUndo}
          onRedo={handleSmartIdentRedo}
        />
      )}

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {(smartIdentMode || editMode) && (
          <SmartIdentSymbolPicker
            open={showSymbolPicker}
            onClose={() => setShowSymbolPicker(false)}
            activeTool={smartIdentMode ? smartIdentTool : activeTool}
            onSelectSymbol={(sym) => {
              if (smartIdentMode) {
                if (sym.categoryId) setSmartIdentCategory(sym.categoryId);
                setSmartIdentTool(sym.id);
              } else {
                if (sym.categoryId) setActiveCategory(sym.categoryId);
                setActiveTool(sym.id);
              }
            }}
          />
        )}
        {/* Canvas area */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          style={{
            backgroundColor: '#F5F7F7',
            cursor: smartIdentMode
              ? (smartIdentTool === 'select' ? 'default' : 'crosshair')
              : workspaceMode?.placementMode
                ? 'crosshair'
                : workspaceMode?.drawMode
                  ? 'crosshair'
                  : effectiveEditMode
                    ? (resolvedTool === 'select' ? 'default' : 'crosshair')
                    : 'grab',
          }}
          onClick={workspaceMode?.placementMode ? handleCanvasClick : undefined}
          onMouseDown={handlePanStart}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanEnd}
          onMouseLeave={handlePanEnd}
        >
          {tagSearchSelection && (
            <PnidTagRelationCard
              selectedTag={tagSearchSelection}
              relations={tagSearchRelations}
              onNavigateToEntity={handleTagRelationNavigate}
              onClose={clearTagSearchHighlight}
            />
          )}
          <div
            className="absolute inset-0 origin-top-left"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            {/* P&ID drawing area — sized to match actual PDF/image dimensions */}
            <div className="relative" style={{ width: `${drawingSize.width}px`, height: `${drawingSize.height}px`, minWidth: '1200px', minHeight: '800px' }}>
              {/* P&ID file from storage (supports PDF and images) */}
              {imageUrl && !imageError && contentType === 'pdf' ? (
                <PdfCanvas
                  url={imageUrl}
                  page={pdfPage}
                  onPageCount={(n) => setPdfPageCount(n)}
                  onLoaded={() => setImageLoaded(true)}
                  onError={() => setImageError(true)}
                  onDimensions={(dims) => setDrawingSize({ width: Math.max(dims.width, 1200), height: Math.max(dims.height, 800) })}
                  style={{ pointerEvents: 'none' }}
                />
              ) : imageUrl && !imageError && contentType === 'image' ? (
                <img
                  src={imageUrl}
                  alt={drawingNumber || 'P&ID Drawing'}
                  className="absolute inset-0 w-full h-full"
                  style={{ objectFit: 'contain', minWidth: '1200px', minHeight: '800px', pointerEvents: 'none' }}
                  onLoad={(e) => {
                    setImageLoaded(true);
                    const img = e.target;
                    if (img.naturalWidth > 0) {
                      setDrawingSize({ width: Math.max(img.naturalWidth, 1200), height: Math.max(img.naturalHeight, 800) });
                    }
                  }}
                  onError={() => setImageError(true)}
                />
              ) : imageUrl && !contentType && !imageError ? (
                <div className="absolute inset-0 flex items-center justify-center" style={{ minWidth: '1200px', minHeight: '800px' }}>
                  <span className="text-md-on-surface-variant text-body-md">Loading drawing...</span>
                </div>
              ) : (
                /* Grid fallback when no image available */
                <svg className="absolute inset-0 w-full h-full" style={{ minWidth: '1200px', minHeight: '800px' }}>
                  <defs>
                    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#E0E0E0" strokeWidth="0.5" />
                    </pattern>
                    <pattern id="gridLarge" width="250" height="250" patternUnits="userSpaceOnUse">
                      <rect width="250" height="250" fill="url(#grid)" />
                      <path d="M 250 0 L 0 0 0 250" fill="none" stroke="#C0C0C0" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#gridLarge)" />
                  {/* Title block */}
                  <rect x="70%" y="85%" width="28%" height="13%" fill="white" stroke="#333" strokeWidth="1.5" />
                  <text x="72%" y="89%" fontSize="10" fill="#666">DRAWING NO.</text>
                  <text x="72%" y="93%" fontSize="14" fontWeight="bold" fill="#333">{drawingNumber || 'No Drawing'}</text>
                  <text x="72%" y="97%" fontSize="9" fill="#666">{pnidTitle || ''}</text>
                  <text x="88%" y="89%" fontSize="10" fill="#666">REV</text>
                  <text x="92%" y="89%" fontSize="10" fill="#666">STATUS</text>
                  {imageError && (
                    <text x="50%" y="50%" textAnchor="middle" fontSize="14" fill="#999">Image failed to load</text>
                  )}
                </svg>
              )}

              {/* Overlay layer — equipment/instrument/line positions from DB */}
              {showOverlay && overlay && (
                <OverlayLayer
                  overlay={overlay}
                  filter={overlayFilter}
                  systemColors={SYSTEM_TYPE_COLORS}
                  annotations={annotations}
                  hideLinkedEntities={!!embedded}
                  showUnpositionedLineList={workspaceMode?.showUnpositionedLineList ?? true}
                  displayMode={workspaceMode?.overlayDisplayMode || 'both'}
                  selectedEntityId={workspaceMode?.selectedEntityId || (selectedAnnotation?._isOverlayEntity ? selectedAnnotation.entity?.id : null)}
                  highlightEntityId={effectiveHighlightId}
                  relatedHighlightIds={tagSearchRelatedIds}
                  onEntityClick={(entityType, entity) => {
                    if (workspaceMode?.onEntitySelect) {
                      workspaceMode.onEntitySelect({ ...entity, entityType });
                    }
                    setSelectedAnnotation({
                      _isOverlayEntity: true,
                      entityType,
                      entity,
                    });
                  }}
                  onSheetNavigate={workspaceMode?.onSheetNavigate}
                />
              )}

              {/* Annotation canvas — Konva.js overlay for user-drawn annotations */}
              {showAnnotations && !smartIdentMode && (
                <KonvaAnnotationStage
                  annotations={annotations}
                  activeTool={resolvedTool}
                  activeColor={activeColor}
                  activeStroke={activeStroke}
                  selectedAnnotation={effectiveEditMode ? selectedAnnotation : null}
                  selectedAnnotationIds={workspaceMode?.selectedAnnotationIds || []}
                  onCreateAnnotation={effectiveEditMode ? handleCreateAnnotation : () => {}}
                  onSelectAnnotation={effectiveEditMode ? handleSelectAnnotation : () => {}}
                  onSelectionChange={workspaceMode?.onSelectionChange}
                  onUpdateAnnotation={effectiveEditMode ? handleUpdateAnnotation : undefined}
                  ocrSuggestions={mergedSuggestions}
                  onAcceptSuggestion={effectiveEditMode ? handleAcceptSuggestion : null}
                  editMode={effectiveEditMode}
                  showLabels={showLabels}
                  zoom={zoom}
                />
              )}

              {smartIdentMode && smartIdentSession?.id && (
                <SmartIdentificationDrawStage
                  ref={smartDrawStageRef}
                  stageWidth={drawingSize.width}
                  stageHeight={drawingSize.height}
                  active={smartIdentMode}
                  activeTool={smartIdentTool}
                  activeCategory={smartIdentCategory}
                  segments={smartIdentSegments}
                  selectedSegmentId={selectedSmartSegment?.id}
                  guideLines={guideLines}
                  entitySnapPoints={entitySnapPoints}
                  snapEnabled={snapEnabled}
                  onSegmentCreated={handleSmartSegmentCreated}
                  onSegmentSelect={handleSmartSegmentSelect}
                  onSegmentGeometryChange={handleSmartSegmentGeometryChange}
                  isolationState={isolationState}
                  showFlowArrows
                />
              )}

              {showAnimatedFlow && flowLineSegments.length > 0 && (
                <FlowAnimationOverlay
                  segments={flowLineSegments}
                  stageWidth={drawingSize.width}
                  stageHeight={drawingSize.height}
                  active={showAnimatedFlow}
                />
              )}
            </div>
          </div>

          {smartIdentMode && showSmartIdentPanel && !showSmartIdentRelationships && (
            <SmartIdentStatusPanel
              session={smartIdentSession}
              segments={smartIdentSegments}
              snapEnabled={snapEnabled}
              loadGuideLines={loadGuideLines}
              saveError={smartIdentSaveError}
              saving={addSmartSegment.isPending}
              selectedSegment={selectedSmartSegment}
              activeTool={smartIdentTool}
              onDeleteSelected={selectedSmartSegment ? () => handleSmartSegmentDelete(selectedSmartSegment.id) : undefined}
              onToggleSnap={setSnapEnabled}
              onDismiss={() => setShowSmartIdentPanel(false)}
              onViewRelationships={() => setShowSmartIdentRelationships(true)}
            />
          )}

          {smartIdentMode && showSmartIdentRelationships && (
            <SmartIdentRelationshipsView
              segments={smartIdentSegments}
              pnidTitle={pnidTitle}
              drawingNumber={drawingNumber}
              onClose={() => setShowSmartIdentRelationships(false)}
              onSelectSegment={(seg) => {
                setSelectedSmartSegment(seg);
                setShowSmartIdentRelationships(false);
              }}
            />
          )}

          {!smartIdentMode && showHierarchyStandalone && (
            <SmartIdentRelationshipsView
              segments={relationshipSegments}
              pnidTitle={pnidTitle}
              drawingNumber={drawingNumber}
              onClose={() => setShowHierarchyStandalone(false)}
              onSelectSegment={(seg) => {
                if (seg?.linkedEntityId) {
                  handleTagRelationNavigate(seg.linkedEntityId, seg.linkedEntityType);
                }
                setShowHierarchyStandalone(false);
              }}
            />
          )}

          {smartIdentMode && (loadingSmartSessions || !smartIdentSession) && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-md-surface-container/95 rounded-lg px-6 py-4 shadow-xl text-center text-sm">
              Preparing draw session…
            </div>
          )}

          {smartIdentMode && smartIdentTool === 'select' && selectedSmartSegment && !showSmartIdentRelationships && (
            <SegmentAssignPanel
              pnidId={pnidId}
              segment={selectedSmartSegment}
              segments={smartIdentSegments}
              onAssign={handleSmartSegmentAssign}
              onDelete={handleSmartSegmentDelete}
              onClose={() => setSelectedSmartSegment(null)}
              onReverseFlow={handleReverseFlow}
              onRunIsolation={handleRunIsolation}
              onCreateEntity={handleCreateSmartEntity}
              assigning={assignSegment.isPending || createSmartIdentEntity.isPending}
              deleting={deleteSmartSegment.isPending}
            />
          )}

          {smartIdentMode && isolationResult && !showSmartIdentRelationships && (
            <SmartIdentIsolationPanel
              isolationResult={isolationResult}
              onClose={handleClearIsolation}
              onClear={handleClearIsolation}
              onSelectSegment={(seg) => {
                setSelectedSmartSegment(seg);
              }}
            />
          )}

          {/* Loading indicator */}
          {(loadingAnnotations || loadingOverlay) && (
            <div className="absolute top-3 right-3 text-xs text-md-on-surface-variant bg-md-surface-container/90 px-2 py-1 rounded">
              Loading...
            </div>
          )}
        </div>

        {/* Right panel — entity registry (hidden in workspace mode) */}
        {!embedded && rightPanelOpen && (
          <AnnotationPanel
            pnidId={pnidId}
            annotations={annotations}
            overlay={overlay}
            selectedAnnotation={selectedAnnotation}
            onSelectAnnotation={handleSelectAnnotation}
            onDeleteAnnotation={editMode ? handleDeleteAnnotation : undefined}
            onUpdateAnnotation={editMode ? handleUpdateAnnotation : undefined}
            editMode={editMode}
            activeCategory={activeCategory}
            onCollapse={() => setRightPanelOpen(false)}
          />
        )}
        {!embedded && !rightPanelOpen && (
          <button
            type="button"
            onClick={() => setRightPanelOpen(true)}
            className="shrink-0 w-8 self-stretch bg-md-surface-container border-l border-md-outline-variant/30 flex flex-col items-center pt-3 gap-2 text-md-on-surface-variant hover:text-md-primary hover:bg-md-surface-container-high transition-colors"
            title="Expand Registry / Repository"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            <span
              className="text-[9px] font-bold uppercase tracking-wider"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
              Registry
            </span>
          </button>
        )}
      </div>

      {/* OCR Review Panel — full-screen overlay */}
      {showOcrReview && (
        <OcrReviewPanel
          pnidId={pnidId}
          onClose={() => setShowOcrReview(false)}
        />
      )}

      {/* OCR Loading indicator */}
      {ocrLoading && !showOcrReview && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-md-surface-container/95 rounded-lg px-6 py-4 shadow-xl border border-md-outline-variant/30 text-center">
          <div className="text-sm font-bold text-md-on-surface mb-1">Running OCR...</div>
          <div className="text-xs text-md-on-surface-variant">Extracting tags from P&ID drawing</div>
          <div className="mt-2 h-1 bg-md-outline-variant/30 rounded overflow-hidden">
            <div className="h-full bg-md-primary rounded animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Link Dialog — shown when user draws a shape, before placing */}
      {pendingAnnotation && (
        <LinkDialog
          pnidId={pnidId}
          defaultTab={
            pendingAnnotation._category === 'equipment' || pendingAnnotation._category === 'valve' ? 'equipment'
            : pendingAnnotation._category === 'instrument' ? 'instrument'
            : pendingAnnotation._category === 'piping' ? 'line'
            : undefined
          }
          onLink={handleLinkEntity}
          onCancel={handleCancelLink}
          onSkip={() => {
            // Save annotation without entity link
            createAnnotation.mutate({
              annotationType: pendingAnnotation.annotationType || 'highlight',
              shape: pendingAnnotation.shape,
              xPct: pendingAnnotation.xPct,
              yPct: pendingAnnotation.yPct,
              wPct: pendingAnnotation.wPct,
              hPct: pendingAnnotation.hPct,
              x2Pct: pendingAnnotation.x2Pct,
              y2Pct: pendingAnnotation.y2Pct,
              color: pendingAnnotation.color,
              strokeWidth: pendingAnnotation.strokeWidth,
              text: pendingAnnotation.text || null,
              metadata: pendingAnnotation.metadata || {},
            });
            setPendingAnnotation(null);
            setActiveTool('select');
          }}
        />
      )}
    </div>
  );
}
