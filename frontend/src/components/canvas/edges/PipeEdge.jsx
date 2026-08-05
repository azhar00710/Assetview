import { memo } from 'react';
import { getSmoothStepPath, BaseEdge, EdgeLabelRenderer } from '@xyflow/react';
import { md, systemColor, alpha } from '../../../lib/theme';

function PipeEdge({
  id, sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
  data, style, selected, markerEnd,
}) {
  const {
    nominalSize, service, systemType,
    highlighted, dimmed,
    lineName, size, lineTag,
  } = data || {};

  const baseColor = systemType ? systemColor(systemType) : (style?.stroke || md.tertiary);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  });

  // Full P&ID line number label: e.g. 4"-PV019-002
  const label = lineTag || lineName || (size && service ? `${size}-${service}` : (nominalSize || service || ''));

  const strokeColor = selected ? md.primary : highlighted ? baseColor : baseColor;
  const strokeWidth = highlighted ? 6 : selected ? 3 : 2;
  const dashArray = highlighted ? '8 4' : undefined;
  const glowFilter = highlighted
    ? `drop-shadow(0 0 4px ${alpha(baseColor, 0.6)})`
    : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd || 'url(#pipe-arrow)'}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray: dashArray,
          opacity: dimmed ? 0.3 : 1,
          filter: glowFilter,
          transition: 'stroke 0.2s, stroke-width 0.2s, opacity 0.2s',
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'none', fontSize: 9, fontWeight: 600,
            fontFamily: '"Courier New", Courier, monospace',
            color: '#1a1a1a',
            background: '#FFFFFF',
            padding: '1px 6px',
            borderRadius: 8, whiteSpace: 'nowrap',
            border: '1px solid #ccc',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
            letterSpacing: '0.02em',
          }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(PipeEdge);
