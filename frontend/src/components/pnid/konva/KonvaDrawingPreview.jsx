import { memo } from 'react';
import { Rect, Ellipse, Line, Arrow } from 'react-konva';
import { pct } from './KonvaShapeRenderer';

/**
 * Temporary shapes rendered during drag-draw.
 * All coordinates in percentage, converted via stageWidth/stageHeight.
 */
function KonvaDrawingPreview({ drawing, color, strokeWidth, stageWidth, stageHeight }) {
  const { shape, x1, y1, x2, y2 } = drawing;
  const px1 = pct(x1, stageWidth);
  const py1 = pct(y1, stageHeight);
  const px2 = pct(x2, stageWidth);
  const py2 = pct(y2, stageHeight);
  const minX = Math.min(px1, px2);
  const minY = Math.min(py1, py2);
  const w = Math.abs(px2 - px1);
  const h = Math.abs(py2 - py1);

  switch (shape) {
    case 'connection':
      return (
        <Arrow
          points={[px1, py1, px2, py2]}
          stroke={color}
          strokeWidth={3}
          dash={[6, 3]}
          opacity={0.7}
          lineCap="round"
          pointerLength={8}
          pointerWidth={6}
          fill={color}
        />
      );
    case 'line':
      return (
        <Line
          points={[px1, py1, px2, py2]}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={[6, 3]}
          opacity={0.7}
          lineCap="round"
        />
      );
    case 'rectangle':
      return (
        <Rect
          x={minX} y={minY} width={w} height={h}
          fill={color} opacity={0.16}
          stroke={color} strokeWidth={strokeWidth}
          dash={[6, 3]}
          cornerRadius={2}
        />
      );
    case 'circle':
      return (
        <Ellipse
          x={minX + w / 2} y={minY + h / 2}
          radiusX={w / 2} radiusY={h / 2}
          fill={color} opacity={0.16}
          stroke={color} strokeWidth={strokeWidth}
          dash={[6, 3]}
        />
      );
    case 'diamond': {
      const cx = minX + w / 2;
      const cy = minY + h / 2;
      const hw = w / 2;
      const hh = h / 2;
      return (
        <Line
          points={[cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy]}
          closed
          fill={color} opacity={0.16}
          stroke={color} strokeWidth={strokeWidth}
          dash={[4, 4]}
        />
      );
    }
    default:
      return null;
  }
}

export default memo(KonvaDrawingPreview);
