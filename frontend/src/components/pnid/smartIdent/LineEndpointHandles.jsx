import { useCallback } from 'react';
import { Circle, Group } from 'react-konva';
import { SMART_IDENT_COLORS } from '../../../hooks/useSmartIdentification';
import { resolveSnapPoint } from './lineSnapEngine';
import { getFlowDirection } from './flowDirection';

function toStage(xPct, yPct, w, h) {
  return { x: (xPct / 100) * w, y: (yPct / 100) * h };
}

function toPct(x, y, w, h) {
  return {
    xPct: Math.round((x / w) * 10000) / 100,
    yPct: Math.round((y / h) * 10000) / 100,
  };
}

function geometryFromPoints(points) {
  if (!points?.length) return { points: [], xPct: 0, yPct: 0, wPct: 0.1, hPct: 0.1 };
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

/**
 * Draggable vertex handles for selected line / trace segments.
 */
export default function LineEndpointHandles({
  seg,
  stageWidth,
  stageHeight,
  selected,
  editable,
  snapEnabled = true,
  guideLines = [],
  segments = [],
  entitySnapPoints = [],
  onGeometryChange,
}) {
  const points = seg.geometry?.points || [];
  const flowDir = getFlowDirection(seg);

  const handleDragMove = useCallback((idx, e) => {
    const node = e.target;
    let pt = toPct(node.x(), node.y(), stageWidth, stageHeight);
    const anchor = idx > 0 ? points[idx - 1] : points[idx + 1];
    if (snapEnabled) {
      const { point } = resolveSnapPoint({
        cursor: pt,
        anchor,
        guideLines,
        segments,
        entityPoints: entitySnapPoints,
        snapEnabled: true,
        orthoEnabled: true,
      });
      pt = point;
      node.x(toStage(pt.xPct, pt.yPct, stageWidth, stageHeight).x);
      node.y(toStage(pt.xPct, pt.yPct, stageWidth, stageHeight).y);
    }
  }, [points, stageWidth, stageHeight, snapEnabled, guideLines, segments, entitySnapPoints]);

  const handleDragEnd = useCallback((idx, e) => {
    if (!onGeometryChange) return;
    const node = e.target;
    let pt = toPct(node.x(), node.y(), stageWidth, stageHeight);
    const anchor = idx > 0 ? points[idx - 1] : points[idx + 1];
    if (snapEnabled) {
      const { point } = resolveSnapPoint({
        cursor: pt,
        anchor,
        guideLines,
        segments,
        entityPoints: entitySnapPoints,
        snapEnabled: true,
        orthoEnabled: true,
      });
      pt = point;
    }
    const nextPoints = points.map((p, i) => (i === idx ? { ...pt } : { ...p }));
    const geometry = {
      ...seg.geometry,
      ...geometryFromPoints(nextPoints),
    };
    onGeometryChange(seg, geometry, { previousGeometry: seg.geometry });
  }, [seg, points, stageWidth, stageHeight, snapEnabled, guideLines, segments, entitySnapPoints, onGeometryChange]);

  if (!selected || !editable || points.length < 2) return null;

  return (
    <Group listening>
      {points.map((p, idx) => {
        const c = toStage(p.xPct, p.yPct, stageWidth, stageHeight);
        const isFlowOrigin = idx === flowDir.fromIdx;
        const isFlowEnd = idx === flowDir.toIdx;
        const fill = isFlowOrigin
          ? SMART_IDENT_COLORS.boundary
          : isFlowEnd
            ? SMART_IDENT_COLORS.line
            : SMART_IDENT_COLORS.selected;
        return (
          <Circle
            key={`${seg.id}-pt-${idx}`}
            x={c.x}
            y={c.y}
            radius={isFlowOrigin || isFlowEnd ? 7 : 6}
            fill={fill}
            stroke="#fff"
            strokeWidth={2}
            draggable
            onMouseDown={(e) => { e.cancelBubble = true; }}
            onDragMove={(e) => handleDragMove(idx, e)}
            onDragEnd={(e) => handleDragEnd(idx, e)}
          />
        );
      })}
    </Group>
  );
}
