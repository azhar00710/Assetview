import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { md, alpha } from '../../../lib/theme';

/**
 * TeeNode — Pipe junction (tee fitting) for multi-line branching.
 *
 * A filled circle with 3 handles:
 *   - Left (target): main pipe inlet
 *   - Right (source): main pipe outlet (continuation)
 *   - Bottom (source): branch pipe takeoff
 *   - Top (source): optional top branch
 *
 * Used where branch lines (drain, hydraulic, gas lift) split from main production flowline.
 */
function TeeNode({ data, selected }) {
  const { highlighted, dimmed } = data || {};
  const clr = '#1A1A1A';
  const nodeOpacity = dimmed ? 0.3 : 1;

  const bg = selected ? md.primary : highlighted ? alpha(clr, 0.8) : clr;
  const borderClr = selected ? md.primary : clr;
  const glowShadow = highlighted
    ? `0 0 8px ${alpha(md.primary, 0.6)}`
    : 'none';

  const hStyle = { background: 'transparent', border: 'none', width: 6, height: 6 };

  return (
    <div style={{
      width: 14, height: 14, borderRadius: '50%',
      background: bg, border: `2px solid ${borderClr}`,
      boxShadow: glowShadow, opacity: nodeOpacity,
      transition: 'background 0.3s ease, opacity 0.3s ease',
    }}>
      <Handle type="target" position={Position.Left} style={hStyle} />
      <Handle type="source" position={Position.Right} style={hStyle} />
      <Handle type="source" id="bottom" position={Position.Bottom} style={hStyle} />
      <Handle type="source" id="top" position={Position.Top} style={hStyle} />
    </div>
  );
}

export default memo(TeeNode);
