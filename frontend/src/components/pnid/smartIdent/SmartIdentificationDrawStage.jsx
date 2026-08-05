import { useState, useCallback, useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Line, Rect, Circle, Group, Ellipse, Arrow, Text } from 'react-konva';
import { SMART_IDENT_COLORS, segmentStrokeColor } from '../../../hooks/useSmartIdentification';
import { resolveSnapPoint } from './lineSnapEngine';
import { toolCategoryForTool, toolColor } from './SmartIdentDrawToolbar';
import { getPidSymbol } from './pidSymbolCatalog';
import SymbolTransformShape from './SymbolTransformShape';
import LineEndpointHandles from './LineEndpointHandles';
import { flowArrowPoints, getFlowDirection } from './flowDirection';

function toStage(xPct, yPct, w, h) {
  return { x: (xPct / 100) * w, y: (yPct / 100) * h };
}

function toPct(x, y, w, h) {
  return { xPct: Math.round((x / w) * 10000) / 100, yPct: Math.round((y / h) * 10000) / 100 };
}

function segmentTypeForTool(tool) {
  if (tool === 'line' || tool === 'trace') return 'line';
  if (tool === 'circle') return 'circle';
  if (tool === 'diamond') return 'rect';
  if (tool?.startsWith('sym_')) return 'symbol';
  if (tool === 'rectangle') return 'rect';
  return 'unknown';
}

function geometryFromDraw(tool, x1, y1, x2, y2) {
  if (tool === 'line') {
    return {
      points: [{ xPct: x1, yPct: y1 }, { xPct: x2, yPct: y2 }],
      xPct: Math.min(x1, x2),
      yPct: Math.min(y1, y2),
      wPct: Math.abs(x2 - x1) || 0.1,
      hPct: Math.abs(y2 - y1) || 0.1,
    };
  }
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (tool === 'circle') {
    const cx = minX + w / 2;
    const cy = minY + h / 2;
    return {
      points: [{ xPct: cx, yPct: cy }],
      xPct: minX,
      yPct: minY,
      wPct: Math.max(w, 0.8),
      hPct: Math.max(h, 0.8),
      radiusPct: Math.max(w, h) / 2,
    };
  }
  return {
    points: [{ xPct: minX, yPct: minY }, { xPct: minX + w, yPct: minY + h }],
    xPct: minX,
    yPct: minY,
    wPct: Math.max(w, 0.6),
    hPct: Math.max(h, 0.6),
  };
}

function geometryFromTrace(points) {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.xPct);
  const ys = points.map((p) => p.yPct);
  return {
    points,
    xPct: Math.min(...xs),
    yPct: Math.min(...ys),
    wPct: Math.max(...xs) - Math.min(...xs) || 0.1,
    hPct: Math.max(...ys) - Math.min(...ys) || 0.1,
  };
}

function samePctPoint(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.xPct === b.xPct && a.yPct === b.yPct;
}

function selectSegment(seg, onSelect, e) {
  e.cancelBubble = true;
  onSelect?.(seg);
}

function FlowArrow({ segment, stageWidth, stageHeight, color }) {
  const arrow = flowArrowPoints(segment, stageWidth, stageHeight);
  if (!arrow) return null;
  const { cx, cy, angle, size } = arrow;
  const tipX = cx + Math.cos(angle) * size;
  const tipY = cy + Math.sin(angle) * size;
  const tailX = cx - Math.cos(angle) * size * 0.6;
  const tailY = cy - Math.sin(angle) * size * 0.6;
  return (
    <Arrow
      points={[tailX, tailY, tipX, tipY]}
      stroke={color}
      fill={color}
      strokeWidth={2}
      pointerLength={size * 0.55}
      pointerWidth={size * 0.45}
      opacity={0.92}
      listening={false}
    />
  );
}

function FlowOriginDot({ segment, stageWidth, stageHeight, color }) {
  const pts = segment.geometry?.points || [];
  if (pts.length < 2) return null;
  const dir = getFlowDirection(segment);
  const from = pts[dir.fromIdx];
  const c = toStage(from.xPct, from.yPct, stageWidth, stageHeight);
  return (
    <Circle
      x={c.x}
      y={c.y}
      radius={5}
      fill={color}
      stroke="#fff"
      strokeWidth={1.5}
      opacity={0.9}
      listening={false}
    />
  );
}

function FlowSequenceBadge({ segment, stageWidth, stageHeight }) {
  const seq = segment.metadata?.flowSequence;
  if (!seq) return null;
  const c = segmentCentroidStage(segment, stageWidth, stageHeight);
  const label = String(seq);
  const w = Math.max(18, label.length * 9 + 8);
  return (
    <Group x={c.x + 10} y={c.y - 14} listening={false}>
      <Rect
        width={w}
        height={18}
        cornerRadius={9}
        fill="#1a2332"
        stroke={SMART_IDENT_COLORS.instrument}
        strokeWidth={1.5}
        opacity={0.95}
        shadowColor="#000"
        shadowBlur={4}
        shadowOpacity={0.35}
      />
      <Text
        text={label}
        fontSize={10}
        fontStyle="bold"
        fill={SMART_IDENT_COLORS.instrument}
        width={w}
        height={18}
        align="center"
        verticalAlign="middle"
      />
    </Group>
  );
}

function segmentCentroidStage(seg, stageWidth, stageHeight) {
  const pts = seg.geometry?.points || [];
  if (pts.length) {
    const cx = pts.reduce((s, p) => s + p.xPct, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.yPct, 0) / pts.length;
    return toStage(cx, cy, stageWidth, stageHeight);
  }
  const g = seg.geometry || {};
  return toStage((g.xPct || 0) + (g.wPct || 0) / 2, (g.yPct || 0) + (g.hPct || 0) / 2, stageWidth, stageHeight);
}

function IsolationHighlight({ segment, stageWidth, stageHeight, kind }) {
  const color = kind === 'boundary' ? '#E74C3C' : '#F39C12';
  const pts = segment.geometry?.points || [];

  if (segment.segmentType === 'line' && pts.length >= 2) {
    const flat = pts.flatMap((p) => {
      const c = toStage(p.xPct, p.yPct, stageWidth, stageHeight);
      return [c.x, c.y];
    });
    return (
      <Line
        points={flat}
        stroke={color}
        strokeWidth={kind === 'boundary' ? 8 : 6}
        opacity={0.35}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />
    );
  }

  const c = segmentCentroidStage(segment, stageWidth, stageHeight);
  return (
    <Circle
      x={c.x}
      y={c.y}
      radius={kind === 'boundary' ? 22 : 18}
      stroke={color}
      strokeWidth={3}
      dash={kind === 'boundary' ? undefined : [6, 4]}
      opacity={0.5}
      fill={`${color}20`}
      listening={false}
    />
  );
}

function SelectionHalo({ x, y, w, h, radius }) {
  if (radius != null) {
    return (
      <Circle
        x={x}
        y={y}
        radius={radius + 8}
        stroke={SMART_IDENT_COLORS.selected}
        strokeWidth={2}
        dash={[5, 4]}
        listening={false}
      />
    );
  }
  return (
    <Rect
      x={x - 6}
      y={y - 6}
      width={w + 12}
      height={h + 12}
      stroke={SMART_IDENT_COLORS.selected}
      strokeWidth={2}
      dash={[5, 4]}
      cornerRadius={4}
      listening={false}
    />
  );
}

function renderSymbolShape(seg, stageWidth, stageHeight, selected, onSelect, editable, onGeometryChange) {
  return (
    <SymbolTransformShape
      key={seg.id}
      seg={seg}
      stageWidth={stageWidth}
      stageHeight={stageHeight}
      selected={selected}
      editable={editable}
      onSelect={onSelect}
      onGeometryChange={onGeometryChange}
    />
  );
}

function renderSegment(
  seg,
  stageWidth,
  stageHeight,
  selected,
  onSelect,
  editable,
  onGeometryChange,
  isolationState,
  showFlowArrows = true,
  snapEnabled = true,
  guideLines = [],
  allSegments = [],
  entitySnapPoints = [],
) {
  const affected = isolationState?.affectedIds?.includes(seg.id);
  const boundary = isolationState?.boundaryIds?.includes(seg.id);
  const isolationActive = !!isolationState?.active;
  const dimmed = isolationActive && !affected && !boundary && seg.id !== isolationState?.shutdownId;

  if (seg.segmentType === 'symbol' || seg.metadata?.symbolId) {
    return (
      <Group key={seg.id} opacity={dimmed ? 0.25 : 1}>
        {affected && <IsolationHighlight segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} kind="affected" />}
        {boundary && <IsolationHighlight segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} kind="boundary" />}
        {renderSymbolShape(seg, stageWidth, stageHeight, selected, onSelect, editable, onGeometryChange)}
        <FlowSequenceBadge segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} />
      </Group>
    );
  }

  const color = segmentStrokeColor(seg, selected);
  const assigned = !!seg.linkedEntityId;
  const strokeWidth = selected ? 3.5 : assigned ? 2.5 : 2;
  const opacity = dimmed ? 0.2 : assigned ? 0.95 : 0.8;
  const points = seg.geometry?.points || [];
  const isLine = seg.segmentType === 'line';

  if (isLine && points.length >= 2) {
    const flat = points.flatMap((p) => {
      const c = toStage(p.xPct, p.yPct, stageWidth, stageHeight);
      return [c.x, c.y];
    });
    return (
      <Group key={seg.id} opacity={dimmed ? 0.25 : 1}>
        {affected && <IsolationHighlight segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} kind="affected" />}
        {boundary && <IsolationHighlight segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} kind="boundary" />}
        {selected && (
          <Line
            points={flat}
            stroke={SMART_IDENT_COLORS.selected}
            strokeWidth={strokeWidth + 6}
            opacity={0.35}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        )}
        <Line
          points={flat}
          stroke={color}
          strokeWidth={strokeWidth}
          opacity={opacity}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={22}
          onClick={(e) => selectSegment(seg, onSelect, e)}
          onTap={(e) => selectSegment(seg, onSelect, e)}
          onMouseDown={(e) => selectSegment(seg, onSelect, e)}
        />
        <FlowOriginDot segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} color={color} />
        {showFlowArrows && (
          <FlowArrow segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} color={color} />
        )}
        <LineEndpointHandles
          seg={seg}
          stageWidth={stageWidth}
          stageHeight={stageHeight}
          selected={selected}
          editable={editable}
          snapEnabled={snapEnabled}
          guideLines={guideLines}
          segments={allSegments}
          entitySnapPoints={entitySnapPoints}
          onGeometryChange={onGeometryChange}
        />
      </Group>
    );
  }

  if (seg.segmentType === 'circle' && points.length >= 1) {
    const center = toStage(points[0].xPct, points[0].yPct, stageWidth, stageHeight);
    const r = Math.max(8, ((seg.geometry?.radiusPct || 0.4) / 100) * stageWidth);
    return (
      <Group key={seg.id} opacity={dimmed ? 0.25 : 1}>
        {affected && <IsolationHighlight segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} kind="affected" />}
        {boundary && <IsolationHighlight segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} kind="boundary" />}
        {selected && <SelectionHalo x={center.x} y={center.y} radius={r} />}
        <Circle
          x={center.x}
          y={center.y}
          radius={r}
          stroke={color}
          strokeWidth={strokeWidth}
          opacity={opacity}
          fill={selected ? `${color}18` : 'transparent'}
          hitStrokeWidth={20}
          onClick={(e) => selectSegment(seg, onSelect, e)}
          onTap={(e) => selectSegment(seg, onSelect, e)}
          onMouseDown={(e) => selectSegment(seg, onSelect, e)}
        />
        <FlowSequenceBadge segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} />
      </Group>
    );
  }

  const g = seg.geometry || {};
  const tl = toStage(g.xPct, g.yPct, stageWidth, stageHeight);
  const w = Math.max(12, ((g.wPct || 1) / 100) * stageWidth);
  const h = Math.max(12, ((g.hPct || 1) / 100) * stageHeight);

  if (seg.segmentType === 'rect' && seg.metadata?.shape === 'diamond') {
    const cx = tl.x + w / 2;
    const cy = tl.y + h / 2;
    return (
      <Group key={seg.id} opacity={dimmed ? 0.25 : 1}>
        {affected && <IsolationHighlight segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} kind="affected" />}
        {boundary && <IsolationHighlight segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} kind="boundary" />}
        {selected && <SelectionHalo x={tl.x} y={tl.y} w={w} h={h} />}
        <Line
          points={[cx, tl.y, tl.x + w, cy, cx, tl.y + h, tl.x, cy, cx, tl.y]}
          closed
          stroke={color}
          strokeWidth={strokeWidth}
          opacity={opacity}
          fill={selected ? `${color}15` : 'transparent'}
          hitStrokeWidth={16}
          onClick={(e) => selectSegment(seg, onSelect, e)}
          onTap={(e) => selectSegment(seg, onSelect, e)}
          onMouseDown={(e) => selectSegment(seg, onSelect, e)}
        />
        <FlowSequenceBadge segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} />
      </Group>
    );
  }

  return (
    <Group key={seg.id} opacity={dimmed ? 0.25 : 1}>
      {affected && <IsolationHighlight segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} kind="affected" />}
      {boundary && <IsolationHighlight segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} kind="boundary" />}
      {selected && <SelectionHalo x={tl.x} y={tl.y} w={w} h={h} />}
      <Rect
        x={tl.x}
        y={tl.y}
        width={w}
        height={h}
        stroke={color}
        strokeWidth={strokeWidth}
        opacity={opacity}
        fill="transparent"
        hitStrokeWidth={16}
        onClick={(e) => selectSegment(seg, onSelect, e)}
        onTap={(e) => selectSegment(seg, onSelect, e)}
        onMouseDown={(e) => selectSegment(seg, onSelect, e)}
      />
      <FlowSequenceBadge segment={seg} stageWidth={stageWidth} stageHeight={stageHeight} />
    </Group>
  );
}

export default forwardRef(function SmartIdentificationDrawStage({
  stageWidth,
  stageHeight,
  active,
  activeTool,
  activeCategory,
  segments = [],
  selectedSegmentId,
  guideLines = [],
  entitySnapPoints = [],
  snapEnabled = true,
  onSegmentCreated,
  onSegmentSelect,
  onSegmentGeometryChange,
  isolationState = null,
  showFlowArrows = true,
}, ref) {
  const [drawing, setDrawing] = useState(null);
  const [tracePoints, setTracePoints] = useState([]);
  const [snapIndicator, setSnapIndicator] = useState(null);
  const snapIndicatorRef = useRef(null);

  useImperativeHandle(ref, () => ({
    /** Cancel in-progress line drag or trace polyline. Returns true if something was discarded. */
    cancelInProgressDraw() {
      const hadDrawing = !!drawing;
      const hadTrace = tracePoints.length > 0;
      if (hadDrawing) setDrawing(null);
      if (hadTrace) setTracePoints([]);
      if (hadDrawing || hadTrace) {
        snapIndicatorRef.current = null;
        setSnapIndicator(null);
      }
      return hadDrawing || hadTrace;
    },
    /** Remove last trace vertex while tracing. */
    popTracePoint() {
      if (tracePoints.length === 0) return false;
      setTracePoints((prev) => prev.slice(0, -1));
      snapIndicatorRef.current = null;
      setSnapIndicator(null);
      return true;
    },
    hasInProgressDraw() {
      return !!drawing || tracePoints.length > 0;
    },
  }), [drawing, tracePoints]);

  const isSelect = activeTool === 'select';
  const isSymbol = activeTool?.startsWith('sym_');
  const isLine = activeTool === 'line';
  const isTrace = activeTool === 'trace';
  const isDragShape = !isSelect && !isSymbol && !isTrace && activeTool !== 'pin';

  const strokeColor = toolColor(activeCategory || toolCategoryForTool(activeTool));

  useEffect(() => {
    if (activeTool !== 'trace') setTracePoints([]);
  }, [activeTool]);

  useEffect(() => {
    if (!active) {
      snapIndicatorRef.current = null;
      setSnapIndicator(null);
    }
  }, [active]);

  const snapContext = useMemo(
    () => ({ guideLines, segments, entityPoints: entitySnapPoints }),
    [guideLines, segments, entitySnapPoints]
  );

  const applySnap = useCallback((cursor, anchor = null) => {
    const { point, snap } = resolveSnapPoint({
      cursor,
      anchor,
      guideLines: snapContext.guideLines,
      segments: snapContext.segments,
      entityPoints: snapContext.entityPoints,
      snapEnabled,
      orthoEnabled: isLine || isTrace,
    });
    const nextIndicator = snap ? point : null;
    if (!samePctPoint(snapIndicatorRef.current, nextIndicator)) {
      snapIndicatorRef.current = nextIndicator;
      setSnapIndicator(nextIndicator);
    }
    return point;
  }, [snapContext, snapEnabled, isLine, isTrace]);

  const finishTrace = useCallback((points) => {
    if (points.length < 2) {
      setTracePoints([]);
      return;
    }
    const geometry = geometryFromTrace(points);
    if (!geometry) return;
    onSegmentCreated?.({
      segmentType: 'line',
      geometry,
      metadata: {
        shape: 'trace',
        category: 'piping',
        source: 'manual',
        polyline: true,
        flowDirection: { fromIdx: 0, toIdx: points.length - 1 },
      },
      displayColor: toolColor('piping'),
    });
    setTracePoints([]);
    snapIndicatorRef.current = null;
    setSnapIndicator(null);
  }, [onSegmentCreated]);

  const handleMouseDown = useCallback((e) => {
    if (!active) return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    if (isSelect) {
      if (e.target === stage) onSegmentSelect?.(null);
      return;
    }

    if (e.target !== stage) return;

    let pt = toPct(pos.x, pos.y, stageWidth, stageHeight);
    const anchor = tracePoints.length > 0 ? tracePoints[tracePoints.length - 1] : null;
    pt = applySnap(pt, anchor);

    if (isSymbol) {
      const sym = getPidSymbol(activeTool);
      const cat = toolCategoryForTool(activeTool);
      onSegmentCreated?.({
        segmentType: 'symbol',
        geometry: {
          points: [{ xPct: pt.xPct, yPct: pt.yPct }],
          xPct: pt.xPct - 1,
          yPct: pt.yPct - 1,
          wPct: 2.2,
          hPct: 2.2,
          rotationDeg: 0,
        },
        metadata: { symbolId: activeTool, label: sym?.label, category: cat, source: 'manual' },
        displayColor: toolColor(cat),
      });
      return;
    }

    if (isTrace) {
      setTracePoints((prev) => [...prev, pt]);
      return;
    }

    if (isDragShape || isLine) {
      setDrawing({ tool: activeTool, x1: pt.xPct, y1: pt.yPct, x2: pt.xPct, y2: pt.yPct });
    }
  }, [active, activeTool, isSelect, isSymbol, isDragShape, isLine, isTrace, tracePoints, stageWidth, stageHeight, applySnap, onSegmentCreated, onSegmentSelect]);

  const handleMouseMove = useCallback((e) => {
    if (isTrace && tracePoints.length > 0) {
      const stage = e.target.getStage();
      const pos = stage.getPointerPosition();
      if (!pos) return;
      let pt = toPct(pos.x, pos.y, stageWidth, stageHeight);
      pt = applySnap(pt, tracePoints[tracePoints.length - 1]);
      return;
    }
    if (!drawing) return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;
    let pt = toPct(pos.x, pos.y, stageWidth, stageHeight);
    const anchor = { xPct: drawing.x1, yPct: drawing.y1 };
    pt = applySnap(pt, anchor);
    setDrawing((d) => {
      if (!d) return d;
      if (d.x2 === pt.xPct && d.y2 === pt.yPct) return d;
      return { ...d, x2: pt.xPct, y2: pt.yPct };
    });
  }, [drawing, isTrace, tracePoints, stageWidth, stageHeight, applySnap]);

  const handleMouseUp = useCallback(() => {
    if (!drawing) return;
    const { tool, x1, y1, x2, y2 } = drawing;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (tool === 'line' && len < 0.15) {
      setDrawing(null);
      snapIndicatorRef.current = null;
      setSnapIndicator(null);
      return;
    }
    if (tool !== 'line' && len < 0.25) {
      setDrawing(null);
      snapIndicatorRef.current = null;
      setSnapIndicator(null);
      return;
    }

    const cat = activeCategory || toolCategoryForTool(tool);
    onSegmentCreated?.({
      segmentType: segmentTypeForTool(tool),
      geometry: geometryFromDraw(tool, x1, y1, x2, y2),
      metadata: {
        shape: tool,
        category: cat,
        source: 'manual',
        ...(tool === 'diamond' ? { shape: 'diamond' } : {}),
        ...(tool === 'line' ? { flowDirection: { fromIdx: 0, toIdx: 1 } } : {}),
      },
      displayColor: toolColor(cat),
    });
    setDrawing(null);
    snapIndicatorRef.current = null;
    setSnapIndicator(null);
  }, [drawing, activeCategory, onSegmentCreated]);

  const handleDblClick = useCallback(() => {
    if (isTrace && tracePoints.length >= 2) {
      finishTrace(tracePoints);
    }
  }, [isTrace, tracePoints, finishTrace]);

  if (!active) return null;

  const preview = drawing && (() => {
    const p1 = toStage(drawing.x1, drawing.y1, stageWidth, stageHeight);
    const p2 = toStage(drawing.x2, drawing.y2, stageWidth, stageHeight);
    if (drawing.tool === 'line') {
      return (
        <Line
          points={[p1.x, p1.y, p2.x, p2.y]}
          stroke={strokeColor}
          strokeWidth={2.5}
          dash={[6, 3]}
          opacity={0.85}
          lineCap="round"
        />
      );
    }
    if (drawing.tool === 'circle') {
      const minX = Math.min(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const w = Math.abs(p2.x - p1.x);
      const h = Math.abs(p2.y - p1.y);
      return (
        <Ellipse
          x={minX + w / 2}
          y={minY + h / 2}
          radiusX={w / 2}
          radiusY={h / 2}
          stroke={strokeColor}
          strokeWidth={2}
          dash={[4, 3]}
          opacity={0.7}
        />
      );
    }
    return (
      <Rect
        x={Math.min(p1.x, p2.x)}
        y={Math.min(p1.y, p2.y)}
        width={Math.abs(p2.x - p1.x)}
        height={Math.abs(p2.y - p1.y)}
        stroke={strokeColor}
        strokeWidth={2}
        dash={[4, 3]}
        opacity={0.7}
      />
    );
  })();

  const tracePreview = isTrace && tracePoints.length > 0 && (() => {
    const flat = tracePoints.flatMap((p) => {
      const c = toStage(p.xPct, p.yPct, stageWidth, stageHeight);
      return [c.x, c.y];
    });
    if (snapIndicator) {
      const c = toStage(snapIndicator.xPct, snapIndicator.yPct, stageWidth, stageHeight);
      flat.push(c.x, c.y);
    }
    return (
      <Line
        points={flat}
        stroke={strokeColor}
        strokeWidth={2.5}
        dash={[6, 3]}
        opacity={0.9}
        lineCap="round"
        lineJoin="round"
      />
    );
  })();

  const traceVertices = isTrace && tracePoints.map((p, i) => {
    const c = toStage(p.xPct, p.yPct, stageWidth, stageHeight);
    return <Circle key={`tp-${i}`} x={c.x} y={c.y} radius={4} fill={strokeColor} listening={false} />;
  });

  const snapDot = snapIndicator && !isTrace && (() => {
    const c = toStage(snapIndicator.xPct, snapIndicator.yPct, stageWidth, stageHeight);
    return (
      <Circle x={c.x} y={c.y} radius={5} stroke={SMART_IDENT_COLORS.boundary} strokeWidth={2} fill={`${SMART_IDENT_COLORS.boundary}40`} listening={false} />
    );
  })();

  return (
    <Stage
      width={stageWidth}
      height={stageHeight}
      className="smart-ident-stage"
      style={{ position: 'absolute', top: 0, left: 0, zIndex: 25, pointerEvents: 'auto', background: 'transparent', cursor: isSelect ? 'default' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDblClick={handleDblClick}
    >
      <Layer>
        {segments.map((seg) => renderSegment(
          seg,
          stageWidth,
          stageHeight,
          seg.id === selectedSegmentId,
          onSegmentSelect,
          isSelect,
          onSegmentGeometryChange,
          isolationState,
          showFlowArrows,
          snapEnabled,
          guideLines,
          segments,
          entitySnapPoints,
        ))}
        {preview}
        {tracePreview}
        {traceVertices}
        {snapDot}
      </Layer>
    </Stage>
  );
});
