import { memo, useState, useCallback } from 'react';
import { getSmoothStepPath, BaseEdge, EdgeLabelRenderer } from '@xyflow/react';
import { md, systemColor, alpha } from '../../../lib/theme';

const SYS_TYPE_COLORS = {
  process: '#3BE494',
  utility: '#2D33E0',
  safety: '#E74C3C',
  instrument: '#F39C12',
};

function BoundaryEdge({
  id, sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
  data, style, selected,
}) {
  const {
    targetSystemType, targetSystemCode, highlighted, dimmed, lineTag,
    edgeCount, connections, color: dataColor,
  } = data || {};
  const [showTooltip, setShowTooltip] = useState(false);

  const baseColor = dataColor
    || (targetSystemType ? (SYS_TYPE_COLORS[targetSystemType] || systemColor(targetSystemType)) : md.tertiary);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  });

  const strokeColor = selected ? md.primary : baseColor;
  const strokeWidth = highlighted ? 6 : selected ? 2.5 : 2;
  const glowFilter = highlighted
    ? `drop-shadow(0 0 4px ${alpha(baseColor, 0.6)})`
    : undefined;

  const label = edgeCount
    ? `${edgeCount} connection${edgeCount !== 1 ? 's' : ''}`
    : lineTag || targetSystemCode || '';

  const handleLabelClick = useCallback((e) => {
    e.stopPropagation();
    if (connections?.length) {
      setShowTooltip((v) => !v);
    }
  }, [connections]);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray: '8 4',
          opacity: dimmed ? 0.3 : 0.65,
          filter: glowFilter,
          transition: 'stroke 0.3s ease, opacity 0.3s ease',
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              fontSize: 8,
              fontWeight: 600,
              fontFamily: 'monospace',
              color: strokeColor,
              background: 'rgba(255,255,255,0.92)',
              padding: '2px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              border: `1px solid ${alpha(strokeColor, 0.3)}`,
              opacity: dimmed ? 0.3 : 0.85,
              cursor: connections?.length ? 'pointer' : 'default',
            }}
            onClick={handleLabelClick}
          >
            {label}
          </div>

          {/* Tooltip: list of connections across this boundary */}
          {showTooltip && connections?.length > 0 && (
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, 4px) translate(${labelX}px, ${labelY}px)`,
                pointerEvents: 'all',
                background: '#111D14',
                border: `1px solid ${alpha(strokeColor, 0.4)}`,
                borderRadius: 6,
                padding: '6px 10px',
                zIndex: 100,
                maxHeight: 160,
                overflowY: 'auto',
                minWidth: 160,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: 9, fontWeight: 700, color: strokeColor, marginBottom: 4 }}>
                Cross-System Connections
              </div>
              {connections.slice(0, 10).map((c, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 9,
                    color: '#D3DFE2',
                    fontFamily: 'monospace',
                    padding: '1px 0',
                    display: 'flex',
                    gap: 4,
                  }}
                >
                  <span>{c.fromTag || '?'}</span>
                  <span style={{ color: '#919A9B' }}>&rarr;</span>
                  <span>{c.toTag || '?'}</span>
                </div>
              ))}
              {connections.length > 10 && (
                <div style={{ fontSize: 8, color: '#919A9B', marginTop: 2 }}>
                  +{connections.length - 10} more
                </div>
              )}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(BoundaryEdge);
