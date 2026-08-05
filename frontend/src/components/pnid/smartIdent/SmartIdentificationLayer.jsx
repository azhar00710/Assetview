import { useState, useRef, useCallback, useMemo } from 'react';
import { Stage, Layer, Line, Rect, Circle } from 'react-konva';
import { SMART_IDENT_COLORS, segmentStrokeColor } from '../../../hooks/useSmartIdentification';
import { filterDisplaySegments } from './smartIdentSnap';

function toStageCoords(xPct, yPct, w, h) {
  return { x: (xPct / 100) * w, y: (yPct / 100) * h };
}

function toPercent(x, y, w, h) {
  return {
    xPct: Math.round((x / w) * 10000) / 100,
    yPct: Math.round((y / h) * 10000) / 100,
  };
}

/**
 * Konva overlay for Smart Identification.
 * Canvas is fully transparent — P&ID stays visible underneath.
 */
export default function SmartIdentificationLayer({
  stageWidth,
  stageHeight,
  active,
  phase,
  segments = [],
  selectedSegmentId,
  onBoundaryComplete,
  onSegmentSelect,
  detecting = false,
  boundary,
  showPipeLines = false,
}) {
  const [drawing, setDrawing] = useState(null);
  const stageRef = useRef(null);

  const visibleSegments = useMemo(
    () => filterDisplaySegments(segments, { showPipeLines }),
    [segments, showPipeLines]
  );

  const handleMouseDown = useCallback((e) => {
    if (!active || phase !== 'boundary' || detecting) return;
    if (e.target !== e.target.getStage()) return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;
    setDrawing({ startX: pos.x, startY: pos.y, x: pos.x, y: pos.y, w: 0, h: 0 });
  }, [active, phase, detecting]);

  const handleMouseMove = useCallback((e) => {
    if (!drawing) return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;
    setDrawing({
      ...drawing,
      x: Math.min(drawing.startX, pos.x),
      y: Math.min(drawing.startY, pos.y),
      w: Math.abs(pos.x - drawing.startX),
      h: Math.abs(pos.y - drawing.startY),
    });
  }, [drawing]);

  const handleMouseUp = useCallback(() => {
    if (!drawing || !stageWidth || !stageHeight) return;
    const minSize = 20;
    if (drawing.w >= minSize && drawing.h >= minSize) {
      const tl = toPercent(drawing.x, drawing.y, stageWidth, stageHeight);
      const br = toPercent(drawing.x + drawing.w, drawing.y + drawing.h, stageWidth, stageHeight);
      onBoundaryComplete?.({
        xPct: tl.xPct,
        yPct: tl.yPct,
        wPct: Math.max(0.5, br.xPct - tl.xPct),
        hPct: Math.max(0.5, br.yPct - tl.yPct),
      });
    }
    setDrawing(null);
  }, [drawing, stageWidth, stageHeight, onBoundaryComplete]);

  if (!active) return null;

  const renderSegment = (seg) => {
    const selected = seg.id === selectedSegmentId;
    const assigned = !!seg.linkedEntityId;
    const color = segmentStrokeColor(seg, selected);
    const strokeWidth = selected ? 3 : assigned ? 2 : 1.2;
    const opacity = selected ? 1 : assigned ? 0.9 : 0.55;
    const dash = assigned ? undefined : [5, 4];
    const points = seg.geometry?.points || [];

    if (seg.segmentType === 'line' && points.length >= 2) {
      const flat = points.flatMap((p) => {
        const c = toStageCoords(p.xPct, p.yPct, stageWidth, stageHeight);
        return [c.x, c.y];
      });
      return (
        <Line
          key={seg.id}
          points={flat}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={dash}
          opacity={opacity}
          lineCap="round"
          hitStrokeWidth={14}
          onClick={() => onSegmentSelect?.(seg)}
          onTap={() => onSegmentSelect?.(seg)}
        />
      );
    }

    if (seg.segmentType === 'circle' && points.length >= 1) {
      const center = toStageCoords(points[0].xPct, points[0].yPct, stageWidth, stageHeight);
      const r = ((seg.geometry?.radiusPct || 0.5) / 100) * stageWidth;
      return (
        <Circle
          key={seg.id}
          x={center.x}
          y={center.y}
          radius={Math.max(4, r)}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={dash}
          opacity={opacity}
          fill={selected ? `${color}18` : 'transparent'}
          onClick={() => onSegmentSelect?.(seg)}
          onTap={() => onSegmentSelect?.(seg)}
        />
      );
    }

    const g = seg.geometry || {};
    const tl = toStageCoords(g.xPct || 0, g.yPct || 0, stageWidth, stageHeight);
    const w = ((g.wPct || 1) / 100) * stageWidth;
    const h = ((g.hPct || 1) / 100) * stageHeight;

    return (
      <Rect
        key={seg.id}
        x={tl.x}
        y={tl.y}
        width={Math.max(4, w)}
        height={Math.max(4, h)}
        stroke={color}
        strokeWidth={strokeWidth}
        dash={dash}
        opacity={opacity}
        fill={selected ? `${color}12` : 'transparent'}
        onClick={() => onSegmentSelect?.(seg)}
        onTap={() => onSegmentSelect?.(seg)}
      />
    );
  };

  const renderParentLink = (seg) => {
    if (!seg.parentSegmentId) return null;
    const parent = segments.find((s) => s.id === seg.parentSegmentId);
    if (!parent) return null;

    const childPts = seg.geometry?.points || [];
    const parentPts = parent.geometry?.points || [];
    if (!childPts.length || !parentPts.length) return null;

    const c0 = toStageCoords(childPts[0].xPct, childPts[0].yPct, stageWidth, stageHeight);
    const p0 = toStageCoords(parentPts[0].xPct, parentPts[0].yPct, stageWidth, stageHeight);

    return (
      <Line
        key={`link-${seg.id}`}
        points={[c0.x, c0.y, p0.x, p0.y]}
        stroke={SMART_IDENT_COLORS.unassigned}
        strokeWidth={1}
        dash={[3, 3]}
        opacity={0.35}
        listening={false}
      />
    );
  };

  const boundaryRect = boundary && !drawing ? (() => {
    const tl = toStageCoords(boundary.xPct, boundary.yPct, stageWidth, stageHeight);
    return {
      x: tl.x,
      y: tl.y,
      w: (boundary.wPct / 100) * stageWidth,
      h: (boundary.hPct / 100) * stageHeight,
    };
  })() : null;

  return (
    <Stage
      ref={stageRef}
      width={stageWidth}
      height={stageHeight}
      className="smart-ident-stage"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 25,
        pointerEvents: active ? 'auto' : 'none',
        background: 'transparent',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
    >
      <Layer>
        {/* Subtle boundary outline only — no fill over the drawing */}
        {boundaryRect && phase === 'segments' && (
          <Rect
            x={boundaryRect.x}
            y={boundaryRect.y}
            width={boundaryRect.w}
            height={boundaryRect.h}
            stroke={SMART_IDENT_COLORS.boundary}
            strokeWidth={1}
            dash={[6, 4]}
            opacity={0.6}
            listening={false}
          />
        )}

        {boundaryRect && phase === 'boundary' && (
          <Rect
            x={boundaryRect.x}
            y={boundaryRect.y}
            width={boundaryRect.w}
            height={boundaryRect.h}
            stroke={SMART_IDENT_COLORS.boundary}
            strokeWidth={1.5}
            dash={[8, 4]}
            listening={false}
          />
        )}

        {drawing && (
          <Rect
            x={drawing.x}
            y={drawing.y}
            width={drawing.w}
            height={drawing.h}
            stroke={SMART_IDENT_COLORS.boundary}
            strokeWidth={2}
            dash={[4, 4]}
            listening={false}
          />
        )}

        {phase === 'segments' && visibleSegments.map(renderParentLink)}
        {phase === 'segments' && visibleSegments.map(renderSegment)}
      </Layer>
    </Stage>
  );
}
