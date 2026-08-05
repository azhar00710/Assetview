import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { md, alpha } from '../../../lib/theme';

function CollapsedGroupNode({ data, selected }) {
  const {
    systemCode, systemName, systemType, color,
    eqCount = 0, lineCount = 0, instCount = 0, pnidCount = 0,
    onExpand, systemId, highlighted, dimmed,
  } = data;

  const typeLabel = {
    process: 'PROCESS', utility: 'UTILITY',
    safety: 'SAFETY', instrument: 'INSTR',
  }[systemType] || 'SYSTEM';

  const totalItems = eqCount + lineCount + instCount;
  const nodeOpacity = dimmed ? 0.3 : 1;

  const glowShadow = highlighted
    ? `0 0 16px ${alpha(color, 0.5)}, 0 0 6px ${alpha(color, 0.3)}`
    : selected
      ? `0 0 12px ${alpha(color, 0.3)}`
      : `0 2px 8px rgba(0,0,0,0.3)`;

  return (
    <div
      className="relative cursor-pointer select-none"
      style={{
        width: 220, height: 120, borderRadius: 12,
        background: md.surfaceContainer,
        border: `2px solid ${selected ? color : alpha(color, 0.4)}`,
        boxShadow: glowShadow, opacity: nodeOpacity,
        transition: 'border-color 0.2s, box-shadow 0.2s, opacity 0.2s',
      }}
      onClick={() => onExpand?.(systemId)}
    >
      <div style={{
        position: 'absolute', top: -10, right: 12, background: color,
        color: md.onPrimary, fontSize: 9, fontWeight: 700,
        letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 4,
      }}>
        {typeLabel}
      </div>
      <div style={{ padding: '14px 14px 6px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: color, lineHeight: 1.2 }}>
          {systemCode}
        </div>
        <div style={{
          fontSize: 10, color: md.onSurfaceVariant, marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190,
        }}>
          {systemName}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '4px 14px', alignItems: 'center' }}>
        <CountBadge count={eqCount} label="eq" color={color} />
        <CountBadge count={lineCount} label="ln" color={md.tertiary} />
        <CountBadge count={instCount} label="inst" color={md.secondary} />
        <CountBadge count={pnidCount} label="P&ID" color={md.secondary} />
      </div>
      <div style={{
        position: 'absolute', bottom: 0, left: 12, right: 12, height: 3,
        borderRadius: '0 0 4px 4px', background: alpha(color, 0.15), overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(totalItems * 5, 100)}%`, height: '100%',
          background: alpha(color, 0.6), borderRadius: 2,
        }} />
      </div>
      <div style={{
        position: 'absolute', bottom: 8, right: 10,
        fontSize: 10, color: md.onSurfaceVariant, opacity: 0.6,
      }}>
        Click to expand
      </div>
      <Handle type="target" position={Position.Left} style={handleStyle(color)} />
      <Handle type="source" position={Position.Right} style={handleStyle(color)} />
    </div>
  );
}

function CountBadge({ count, label, color }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
      background: alpha(color, 0.15), color: color, whiteSpace: 'nowrap',
    }}>
      {count} {label}
    </span>
  );
}

function handleStyle(color) {
  return { width: 6, height: 6, background: color, border: 'none' };
}

export default memo(CollapsedGroupNode);
