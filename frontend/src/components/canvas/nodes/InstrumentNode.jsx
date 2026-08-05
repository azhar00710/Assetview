import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { alpha } from '../../../lib/theme';

/**
 * InstrumentNode — ISA 5.1 instrument bubble.
 *
 * Circle with ISA letter code (e.g. "PT") in top half,
 * loop number in bottom half, divided by horizontal line.
 * Bubble style determined by mounting location (field/panel/DCS/safety).
 * Handle on top for signal-line connection.
 * ~44×44 circle.
 */

function InstrumentNode({ data, selected }) {
  const {
    tag, instrumentType, iType, loopNumber, location,
    isXref, highlighted, dimmed,
    ownerSystemColor, zoomLevel, range, scadaTag,
  } = data;

  const nodeOpacity = dimmed ? 0.3 : isXref ? 0.65 : 1;
  const strokeColor = '#1A1A1A';
  const diameter = 44;
  const r = diameter / 2;

  // Derive ISA letter code (first 2-3 chars like "PT", "FT", "LT")
  const typeStr = instrumentType || iType || tag || '';
  const isaCode = typeStr.replace(/[-\d]/g, '').slice(0, 3).toUpperCase();

  // Derive loop number from tag (digits after the letter code)
  const loop = loopNumber || (tag || '').replace(/[^\d]/g, '') || '';

  // Determine mounting style
  const loc = (location || '').toLowerCase();
  const isSafety = loc === 'safety' || loc === 'sis';
  const isDCS = loc.includes('dcs') || loc.includes('scada');

  const boxShadow = highlighted
    ? `0 0 10px ${alpha('#F39C12', 0.5)}, 0 0 4px ${alpha('#F39C12', 0.3)}`
    : 'none';

  return (
    <div
      style={{
        opacity: nodeOpacity,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transition: 'opacity 0.2s, box-shadow 0.2s',
        position: 'relative',
      }}
    >
      {/* Top handle — signal line connection */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: strokeColor,
          width: 5,
          height: 5,
          border: 'none',
          top: -3,
        }}
      />

      {/* ISA bubble */}
      <svg
        width={diameter}
        height={diameter}
        viewBox={`0 0 ${diameter} ${diameter}`}
        style={{
          filter: boxShadow !== 'none'
            ? `drop-shadow(0 0 6px ${alpha('#F39C12', 0.4)})`
            : 'none',
        }}
      >
        {/* Outer circle */}
        <circle
          cx={r}
          cy={r}
          r={r - 2}
          stroke={selected ? '#2D33E0' : strokeColor}
          strokeWidth={1.5}
          fill="white"
        />

        {/* Safety: double circle (inner ring) */}
        {isSafety && (
          <circle
            cx={r}
            cy={r}
            r={r - 5}
            stroke={strokeColor}
            strokeWidth={1}
            fill="none"
          />
        )}

        {/* Horizontal dividing line */}
        <line
          x1={2 + (isSafety ? 3 : 0)}
          y1={r}
          x2={diameter - 2 - (isSafety ? 3 : 0)}
          y2={r}
          stroke={strokeColor}
          strokeWidth={1.2}
          strokeDasharray={isDCS ? '3 2' : 'none'}
        />

        {/* ISA letter code — top half */}
        <text
          x={r}
          y={r - 4}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={strokeColor}
          fontSize={10}
          fontWeight={700}
          fontFamily="monospace"
        >
          {isaCode}
        </text>

        {/* Loop number — bottom half */}
        <text
          x={r}
          y={r + 9}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={strokeColor}
          fontSize={8}
          fontFamily="monospace"
        >
          {loop}
        </text>
      </svg>

      {/* DETAIL zoom: show range and SCADA tag */}
      {zoomLevel === 'DETAIL' && (range || scadaTag) && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          marginTop: 1, gap: 0,
        }}>
          {range && (
            <span style={{
              fontSize: 7, color: '#555', fontFamily: 'monospace',
              whiteSpace: 'nowrap', lineHeight: 1.1,
            }}>
              {range}
            </span>
          )}
          {scadaTag && (
            <span style={{
              fontSize: 7, color: '#777', fontFamily: 'monospace',
              whiteSpace: 'nowrap', lineHeight: 1.1,
            }}>
              {scadaTag}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(InstrumentNode, (prev, next) =>
  prev.data === next.data && prev.selected === next.selected
);
