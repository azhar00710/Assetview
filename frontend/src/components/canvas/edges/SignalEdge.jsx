import { memo } from 'react';
import { getSmoothStepPath, BaseEdge } from '@xyflow/react';
import { md, alpha } from '../../../lib/theme';

const SIGNAL_COLOR = md.tertiary;

function SignalEdge({
  id, sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
  data, style, selected,
}) {
  const { highlighted, dimmed } = data || {};

  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  });

  const strokeColor = selected ? md.primary : SIGNAL_COLOR;
  const strokeWidth = highlighted ? 4.5 : selected ? 2 : 1.5;
  const glowFilter = highlighted
    ? `drop-shadow(0 0 4px ${alpha(SIGNAL_COLOR, 0.6)})`
    : undefined;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        ...style,
        stroke: strokeColor,
        strokeWidth,
        strokeDasharray: highlighted ? '6 3 2 3' : '6 3',
        opacity: dimmed ? 0.3 : 1,
        filter: glowFilter,
        transition: 'stroke 0.2s, opacity 0.2s',
      }}
    />
  );
}

export default memo(SignalEdge);
