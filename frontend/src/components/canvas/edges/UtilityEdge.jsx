import { memo } from 'react';
import { getSmoothStepPath, BaseEdge } from '@xyflow/react';
import { md, alpha } from '../../../lib/theme';

/** Utility service edge — thin dotted line (ISA 5.1) */
function UtilityEdge({
  id,
  sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
  data,
  style,
  selected,
}) {
  const { highlighted, dimmed } = data || {};

  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        ...style,
        stroke: selected ? md.primary : '#8AB4FF',
        strokeWidth: highlighted ? 3 : selected ? 2 : 1.5,
        strokeDasharray: '3 3',
        opacity: dimmed ? 0.3 : 1,
        transition: 'stroke 0.2s, opacity 0.2s',
      }}
    />
  );
}

export default memo(UtilityEdge);
