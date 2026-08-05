import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer } from 'react-konva';
import KonvaShapeRenderer, { CONNECTION_COLORS, pct, PID_SYMBOLS } from './KonvaShapeRenderer';
import KonvaDrawingPreview from './KonvaDrawingPreview';
import KonvaConnectionMode from './KonvaConnectionMode';
import KonvaOcrGhosts from './KonvaOcrGhosts';

// ── Connection mode helpers ──
const SNAP_THRESHOLD = 5; // percentage distance for entity snapping

function distPct(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function annCenter(ann) {
  if (ann.shape === 'line') {
    return { x: ((ann.xPct || 0) + (ann.x2Pct || 0)) / 2, y: ((ann.yPct || 0) + (ann.y2Pct || 0)) / 2 };
  }
  return {
    x: (ann.xPct || 0) + (ann.wPct || 0) / 2,
    y: (ann.yPct || 0) + (ann.hPct || 0) / 2,
  };
}

function findNearestLinkedAnnotation(x, y, annotations) {
  let best = null;
  let bestDist = Infinity;
  for (const ann of annotations) {
    if (!ann.linkedEntityId && !ann.linked_entity_id) continue;
    const c = annCenter(ann);
    const d = distPct(x, y, c.x, c.y);
    if (d < bestDist && d <= SNAP_THRESHOLD) {
      bestDist = d;
      best = ann;
    }
  }
  return best;
}

/**
 * Convert stage pointer position to percentage coordinates.
 */
function toPercent(pointerPos, stageWidth, stageHeight) {
  const x = (pointerPos.x / stageWidth) * 100;
  const y = (pointerPos.y / stageHeight) * 100;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

// Default stage dimensions match the P&ID drawing area
const STAGE_WIDTH = 1200;
const STAGE_HEIGHT = 800;

export default function KonvaAnnotationStage({
  annotations,
  activeTool,
  activeColor,
  activeStroke,
  selectedAnnotation,
  selectedAnnotationIds = [],
  onCreateAnnotation,
  onSelectAnnotation,
  onSelectionChange,
  onUpdateAnnotation,
  ocrSuggestions,
  onAcceptSuggestion,
  editMode,
  showLabels,
  zoom,
}) {
  const stageRef = useRef(null);
  const containerRef = useRef(null);
  const [drawing, setDrawing] = useState(null);
  const [connectionFrom, setConnectionFrom] = useState(null);
  const [connectionType, setConnectionType] = useState(null);
  const [pendingConnection, setPendingConnection] = useState(null);
  const [stageSize, setStageSize] = useState({ width: STAGE_WIDTH, height: STAGE_HEIGHT });
  const [pickerPos, setPickerPos] = useState(null);

  // Drag-to-move state for selected annotation
  const [dragging, setDragging] = useState(null); // { annId, startPt, origAnn }
  const [selectionBox, setSelectionBox] = useState(null);
  const selectedIdSet = useMemo(() => new Set(selectedAnnotationIds || []), [selectedAnnotationIds]);

  const isSymbolTool = activeTool?.startsWith('sym_');
  const isConnectionTool = activeTool === 'connection';
  const isDrawingTool = activeTool && activeTool !== 'select';
  const isSelectMode = activeTool === 'select';

  // Measure container to set stage size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setStageSize({
            width: Math.max(width, STAGE_WIDTH),
            height: Math.max(height, STAGE_HEIGHT),
          });
        }
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleMouseDown = useCallback((e) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const pt = toPercent(pos, stageSize.width, stageSize.height);

    // Select mode: start dragging if clicking on the selected annotation
    if (isSelectMode) {
      const clickedOnShape = e.target !== stage;
      if (!clickedOnShape) {
        if (e.evt.shiftKey) {
          setSelectionBox({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
        } else {
          onSelectionChange?.([]);
        }
        return;
      }
      if (selectedAnnotation && onUpdateAnnotation) {
        // Start drag
        setDragging({
          annId: selectedAnnotation.id,
          startPt: pt,
          origAnn: selectedAnnotation,
        });
      }
      return;
    }

    // Pin — single click
    if (activeTool === 'pin') {
      onCreateAnnotation({
        annotationType: 'pin',
        shape: 'pin',
        xPct: pt.x,
        yPct: pt.y,
        text: '',
      });
      return;
    }

    // P&ID Symbol — single click
    if (isSymbolTool) {
      const sym = PID_SYMBOLS[activeTool];
      if (sym) {
        onCreateAnnotation({
          annotationType: 'symbol',
          shape: activeTool,
          xPct: pt.x - 2,
          yPct: pt.y - 2,
          wPct: 4,
          hPct: 4,
          text: sym.abbr,
          metadata: { symbolId: activeTool, label: sym.label },
        });
      }
      return;
    }

    // Connection mode
    if (isConnectionTool) {
      const nearest = findNearestLinkedAnnotation(pt.x, pt.y, annotations);
      if (nearest) {
        const c = annCenter(nearest);
        setConnectionFrom(nearest);
        setDrawing({
          shape: 'connection',
          x1: c.x,
          y1: c.y,
          x2: pt.x,
          y2: pt.y,
        });
      }
      return;
    }

    // Drag-draw shapes
    setDrawing({
      shape: activeTool,
      x1: pt.x,
      y1: pt.y,
      x2: pt.x,
      y2: pt.y,
    });
  }, [activeTool, isSymbolTool, isConnectionTool, isSelectMode, annotations, selectedAnnotation, onCreateAnnotation, onUpdateAnnotation, stageSize]);

  const handleMouseMove = useCallback((e) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const pt = toPercent(pos, stageSize.width, stageSize.height);

    // Handle drag-to-move
    if (dragging) {
      const dx = pt.x - dragging.startPt.x;
      const dy = pt.y - dragging.startPt.y;
      // Update in real-time for visual feedback via the annotation itself
      // We'll commit on mouseUp
      setDragging(prev => ({ ...prev, dx, dy }));
      return;
    }

    if (!drawing) return;
    if (selectionBox) {
      setSelectionBox(prev => ({ ...prev, x2: pt.x, y2: pt.y }));
      return;
    }
    setDrawing(prev => ({ ...prev, x2: pt.x, y2: pt.y }));
  }, [drawing, dragging, selectionBox, stageSize]);

  const handleMouseUp = useCallback((e) => {
    // Handle drag-to-move commit
    if (dragging && dragging.dx != null && onUpdateAnnotation) {
      const { origAnn, dx, dy } = dragging;
      // Only save if moved more than 0.5%
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const idsToMove = selectedIdSet.size > 1 ? Array.from(selectedIdSet) : [origAnn.id];
        const byId = new Map(annotations.map(a => [a.id, a]));
        idsToMove.forEach(id => {
          const ann = byId.get(id);
          if (!ann) return;
          const update = {
            xPct: (ann.xPct || 0) + dx,
            yPct: (ann.yPct || 0) + dy,
          };
          if (ann.shape === 'line' && ann.x2Pct != null) {
            update.x2Pct = ann.x2Pct + dx;
            update.y2Pct = ann.y2Pct + dy;
          }
          onUpdateAnnotation(id, update);
        });
      }
      setDragging(null);
      return;
    }
    setDragging(null);

    if (selectionBox) {
      const minX = Math.min(selectionBox.x1, selectionBox.x2);
      const maxX = Math.max(selectionBox.x1, selectionBox.x2);
      const minY = Math.min(selectionBox.y1, selectionBox.y2);
      const maxY = Math.max(selectionBox.y1, selectionBox.y2);
      const picked = annotations.filter(a => {
        const cx = (a.xPct || 0) + (a.wPct || 0) / 2;
        const cy = (a.yPct || 0) + (a.hPct || 0) / 2;
        return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
      }).map(a => a.id);
      if (picked.length) onSelectionChange?.(picked);
      setSelectionBox(null);
      return;
    }

    if (!drawing) return;
    const { shape, x1, y1, x2, y2 } = drawing;

    // Connection mode — find target entity
    if (shape === 'connection' && connectionFrom) {
      const nearest = findNearestLinkedAnnotation(x2, y2, annotations);
      if (nearest && (nearest.linkedEntityId || nearest.linked_entity_id) !== (connectionFrom.linkedEntityId || connectionFrom.linked_entity_id)) {
        const toCenter = annCenter(nearest);

        // Calculate picker position in screen pixels
        const stage = stageRef.current;
        if (stage) {
          const midX = pct((x1 + toCenter.x) / 2, stageSize.width);
          const midY = pct((y1 + toCenter.y) / 2, stageSize.height);
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (containerRect) {
            setPickerPos({
              left: midX + containerRect.left,
              top: midY + containerRect.top,
            });
          }
        }

        setPendingConnection({
          from: connectionFrom,
          to: nearest,
          fromCenter: { x: x1, y: y1 },
          toCenter,
        });
        setConnectionType('picker');
      }
      setDrawing(null);
      setConnectionFrom(null);
      return;
    }

    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    if (shape !== 'line' && dx < 1 && dy < 1) {
      setDrawing(null);
      return;
    }
    if (shape === 'line' && dx < 0.5 && dy < 0.5) {
      setDrawing(null);
      return;
    }

    if (shape === 'line') {
      onCreateAnnotation({
        annotationType: 'highlight',
        shape: 'line',
        xPct: x1,
        yPct: y1,
        x2Pct: x2,
        y2Pct: y2,
      });
    } else {
      const minX = Math.min(x1, x2);
      const minY = Math.min(y1, y2);
      onCreateAnnotation({
        annotationType: 'highlight',
        shape,
        xPct: minX,
        yPct: minY,
        wPct: dx,
        hPct: dy,
      });
    }
    setDrawing(null);
  }, [drawing, dragging, selectionBox, connectionFrom, annotations, selectedIdSet, onCreateAnnotation, onUpdateAnnotation, onSelectionChange, stageSize]);

  const handleSelectConnectionType = useCallback((type) => {
    if (!pendingConnection) return;
    const { from, to, fromCenter, toCenter } = pendingConnection;
    const fromEntityId = from.linkedEntityId || from.linked_entity_id;
    const toEntityId = to.linkedEntityId || to.linked_entity_id;

    onCreateAnnotation({
      annotationType: 'highlight',
      shape: 'line',
      xPct: fromCenter.x,
      yPct: fromCenter.y,
      x2Pct: toCenter.x,
      y2Pct: toCenter.y,
      color: CONNECTION_COLORS[type] || '#3BE494',
      strokeWidth: 3,
      metadata: {
        isConnection: true,
        fromEntityId,
        toEntityId,
        connectionType: type,
      },
    });

    setPendingConnection(null);
    setConnectionType(null);
    setPickerPos(null);
  }, [pendingConnection, onCreateAnnotation]);

  // Dismiss picker on escape
  useEffect(() => {
    if (connectionType !== 'picker') return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        setPendingConnection(null);
        setConnectionType(null);
        setPickerPos(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [connectionType]);

  // Compute drag offset for the selected annotation (visual only, committed on mouseUp)
  const dragOffset = dragging ? { dx: dragging.dx || 0, dy: dragging.dy || 0 } : null;

  // Determine if the stage should capture events:
  // - Drawing tools: always (for creating shapes)
  // - Select mode: always (so annotations are clickable/selectable)
  // - View mode: never
  const stageActive = editMode && (isDrawingTool || isSelectMode);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        width: '100%',
        height: '100%',
        minWidth: `${STAGE_WIDTH}px`,
        minHeight: `${STAGE_HEIGHT}px`,
        pointerEvents: stageActive ? 'all' : 'none',
      }}
    >
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { if (drawing) setDrawing(null); if (dragging) setDragging(null); if (selectionBox) setSelectionBox(null); }}
        style={{ cursor: isDrawingTool ? 'crosshair' : (isSelectMode ? 'default' : 'default') }}
      >
        <Layer>
          {/* OCR ghost suggestions */}
          <KonvaOcrGhosts
            suggestions={ocrSuggestions}
            onAccept={onAcceptSuggestion}
            stageWidth={stageSize.width}
            stageHeight={stageSize.height}
          />

          {/* Existing annotations */}
          {annotations.map(ann => (
            <KonvaShapeRenderer
              key={ann.id}
              annotation={ann}
              isSelected={selectedIdSet.has(ann.id) || selectedAnnotation?.id === ann.id}
              onClick={(item, evt) => {
                const rawEvt = evt?.evt;
                const additive = !!(rawEvt?.shiftKey || rawEvt?.ctrlKey || rawEvt?.metaKey);
                onSelectAnnotation?.(item, additive);
              }}
              interactive={isSelectMode}
              stageWidth={stageSize.width}
              stageHeight={stageSize.height}
              showLabel={showLabels !== false}
              dragOffset={(selectedIdSet.has(ann.id) || selectedAnnotation?.id === ann.id) ? dragOffset : null}
            />
          ))}

          {selectionBox && (
            <KonvaDrawingPreview
              drawing={{ shape: 'rectangle', x1: selectionBox.x1, y1: selectionBox.y1, x2: selectionBox.x2, y2: selectionBox.y2 }}
              color="#2D33E0"
              strokeWidth={1}
              stageWidth={stageSize.width}
              stageHeight={stageSize.height}
            />
          )}

          {/* Drawing preview */}
          {drawing && (
            <KonvaDrawingPreview
              drawing={drawing}
              color={drawing.shape === 'connection' ? '#3BE494' : activeColor}
              strokeWidth={drawing.shape === 'connection' ? 3 : activeStroke}
              stageWidth={stageSize.width}
              stageHeight={stageSize.height}
            />
          )}

          {/* Connection snap indicator */}
          <KonvaConnectionMode
            drawing={drawing}
            connectionFrom={connectionFrom}
            stageWidth={stageSize.width}
            stageHeight={stageSize.height}
          />
        </Layer>
      </Stage>

      {/* Source badges (AI / M) — HTML overlay on linked annotations */}
      {showLabels !== false && annotations.filter(a => a.linkedEntityId).map(ann => {
        const source = ann.metadata?.source;
        const isAI =
          source === 'ocr' ||
          source === 'bulk_link' ||
          ann.metadata?.generatedFromOcr === true ||
          !!ann.metadata?.extraction_id;
        const x = pct(ann.xPct, stageSize.width);
        const y = pct(ann.yPct, stageSize.height);
        return (
          <div
            key={`badge-${ann.id}`}
            style={{
              position: 'absolute',
              left: x - 2,
              top: y - 2,
              transform: 'translate(-100%, -100%)',
              fontSize: 7,
              fontWeight: 700,
              padding: '1px 3px',
              borderRadius: 2,
              background: isAI ? 'rgba(243, 156, 18, 0.85)' : 'rgba(138, 180, 255, 0.85)',
              color: '#fff',
              pointerEvents: 'none',
              letterSpacing: '0.5px',
              lineHeight: 1,
            }}
          >
            {isAI ? 'AI' : 'M'}
          </div>
        );
      })}

      {/* Connection type picker — HTML overlay (better for interactive buttons than Konva) */}
      {connectionType === 'picker' && pendingConnection && pickerPos && (
        <div
          style={{
            position: 'fixed',
            left: pickerPos.left - 40,
            top: pickerPos.top - 20,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            background: '#1a1a2e',
            borderRadius: 6,
            padding: 4,
            border: '1px solid #333',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          {Object.entries(CONNECTION_COLORS).map(([type, color]) => (
            <button
              key={type}
              onClick={(e) => { e.stopPropagation(); handleSelectConnectionType(type); }}
              style={{
                background: 'transparent',
                border: `1px solid ${color}`,
                borderRadius: 3,
                color,
                fontSize: 9,
                fontWeight: 600,
                padding: '3px 8px',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
              onMouseEnter={(e) => { e.target.style.background = color + '30'; }}
              onMouseLeave={(e) => { e.target.style.background = 'transparent'; }}
            >
              {type}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
