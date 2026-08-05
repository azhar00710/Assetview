import { memo } from 'react';
import { Circle, Arrow } from 'react-konva';
import { pct } from './KonvaShapeRenderer';

/**
 * Renders connection mode indicators:
 * - Snap circle at source entity center when dragging
 * - Drawing preview arrow from source to cursor
 */
function KonvaConnectionMode({ drawing, connectionFrom, stageWidth, stageHeight }) {
  if (!connectionFrom || !drawing) return null;

  const cx = pct(drawing.x1, stageWidth);
  const cy = pct(drawing.y1, stageHeight);

  return (
    <>
      {/* Snap indicator at source entity */}
      <Circle
        x={cx}
        y={cy}
        radius={6}
        fill="transparent"
        stroke="#3BE494"
        strokeWidth={2}
        opacity={0.8}
      />
    </>
  );
}

export default memo(KonvaConnectionMode);
