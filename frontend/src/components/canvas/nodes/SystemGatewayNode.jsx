import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { systemColor, alpha } from '../../../lib/theme';

/**
 * SystemGatewayNode — ISA 5.1 off-page connector.
 *
 * Pentagon/flag shape pointing in flow direction.
 * Contains target system code and references the P&ID sheet
 * where the line continues.
 *
 * Supports:
 * - "Trace Across Systems" action via onTraceAcross callback
 * - Pulsing animation when on a cross-system trace path
 */

function SystemGatewayNode({ data, selected }) {
  const {
    targetSystemName, targetSystemCode, targetSystemType, targetSystemId,
    targetPnidNumber, highlighted, dimmed, onNavigate, onTraceAcross,
    direction, isXref, ownerSystemColor,
    traceContinuation, pulseAnimation, glowColor,
  } = data;

  const clr = targetSystemType ? systemColor(targetSystemType) : '#555';
  const nodeOpacity = dimmed ? 0.2 : 1;
  const strokeColor = '#1A1A1A';

  const label = targetSystemCode || targetSystemName || 'SYS';
  const sheetRef = targetPnidNumber ? `→ ${targetPnidNumber}` : '';

  // Pentagon flag dimensions
  const w = 90;
  const h = 40;
  const arrowDepth = 14;

  // Flag pointing right (default) or left
  const pointsRight = direction !== 'left';

  const rightPoints = `0,0 ${w - arrowDepth},0 ${w},${h / 2} ${w - arrowDepth},${h} 0,${h}`;
  const leftPoints = `${arrowDepth},0 ${w},0 ${w},${h} ${arrowDepth},${h} 0,${h / 2}`;
  const points = pointsRight ? rightPoints : leftPoints;

  const isPulsing = pulseAnimation || traceContinuation;
  const effectiveGlow = glowColor || clr;

  const boxShadow = highlighted || isPulsing
    ? `drop-shadow(0 0 6px ${alpha(effectiveGlow, 0.5)})`
    : 'none';

  const handleClick = () => {
    if (onTraceAcross) {
      onTraceAcross(targetSystemId);
    } else if (onNavigate) {
      onNavigate(targetSystemId);
    }
  };

  return (
    <div
      style={{
        opacity: nodeOpacity,
        cursor: (onNavigate || onTraceAcross) ? 'pointer' : 'default',
        transition: 'opacity 0.2s',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        animation: isPulsing ? 'gatewayPulse 1.5s ease-in-out infinite' : undefined,
      }}
      onClick={handleClick}
    >
      {/* Left handle */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: strokeColor,
          width: 6,
          height: 6,
          border: 'none',
          top: '50%',
          left: -3,
        }}
      />

      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ filter: boxShadow }}
      >
        <polygon
          points={points}
          stroke={selected ? '#2D33E0' : isPulsing ? effectiveGlow : strokeColor}
          strokeWidth={isPulsing ? 2.5 : 1.5}
          fill={isPulsing ? alpha(effectiveGlow, 0.1) : 'white'}
        />
        {/* System code label */}
        <text
          x={pointsRight ? (w - arrowDepth) / 2 : arrowDepth + (w - arrowDepth) / 2}
          y={sheetRef ? h / 2 - 3 : h / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={isPulsing ? effectiveGlow : strokeColor}
          fontSize={10}
          fontWeight={700}
          fontFamily="monospace"
        >
          {label}
        </text>
        {/* Sheet reference */}
        {sheetRef && (
          <text
            x={pointsRight ? (w - arrowDepth) / 2 : arrowDepth + (w - arrowDepth) / 2}
            y={h / 2 + 9}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#777"
            fontSize={7}
            fontFamily="monospace"
          >
            {sheetRef}
          </text>
        )}
      </svg>

      {/* "Trace across" label when on trace path */}
      {isPulsing && (
        <div
          style={{
            fontSize: 7,
            color: effectiveGlow,
            fontWeight: 600,
            textAlign: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          Trace continues →
        </div>
      )}

      {/* Right handle */}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: strokeColor,
          width: 6,
          height: 6,
          border: 'none',
          top: '50%',
          right: -3,
        }}
      />

      <style>{`
        @keyframes gatewayPulse {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 4px ${alpha(effectiveGlow, 0.3)}); }
          50% { transform: scale(1.05); filter: drop-shadow(0 0 10px ${alpha(effectiveGlow, 0.6)}); }
        }
      `}</style>
    </div>
  );
}

export default memo(SystemGatewayNode, (prev, next) =>
  prev.data === next.data && prev.selected === next.selected
);
