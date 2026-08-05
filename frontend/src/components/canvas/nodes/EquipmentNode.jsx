import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { getEquipmentSymbol } from '../../../lib/pid-symbol-map';
import { alpha } from '../../../lib/theme';

/**
 * EquipmentNode — ISA 5.1 inline symbol on pipe.
 *
 * Renders the correct ISA SVG symbol with tag label above,
 * type label below, criticality dot, and optional SIL level.
 * Light background for P&ID canvas.
 * ~120×100px at 1x zoom.
 */

const CRITICALITY_COLORS = {
  High: '#E74C3C',
  high: '#E74C3C',
  Medium: '#F39C12',
  medium: '#F39C12',
  Low: '#3BE494',
  low: '#3BE494',
};

function EquipmentNode({ data, selected }) {
  const {
    tag, equipmentType, eqType, criticality, silLevel, sil,
    systemType, isXref, highlighted, dimmed,
    ownerSystemColor, standalone,
  } = data;

  const type = equipmentType || eqType || '';
  const SymbolComponent = getEquipmentSymbol(type);
  const nodeOpacity = dimmed ? 0.3 : isXref ? 0.65 : 1;
  const critColor = criticality ? CRITICALITY_COLORS[criticality] : null;
  const strokeColor = '#1A1A1A';
  const silLabel = silLevel || sil;

  const boxShadow = highlighted
    ? `0 0 12px ${alpha('#3BE494', 0.5)}, 0 0 4px ${alpha('#3BE494', 0.3)}`
    : 'none';

  const outline = selected ? '2px solid #2D33E0' : 'none';

  // X-Ref left border colored with owning system's color
  const xrefBorder = isXref && ownerSystemColor
    ? `3px solid ${ownerSystemColor}`
    : 'none';

  return (
    <div
      style={{
        opacity: nodeOpacity,
        width: 120,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        transition: 'opacity 0.3s ease, box-shadow 0.3s ease',
        boxShadow,
        outline,
        outlineOffset: 2,
        borderRadius: 6,
        padding: 4,
        background: standalone ? 'rgba(245,247,247,0.5)' : 'transparent',
        borderLeft: xrefBorder,
      }}
    >
      {/* Tag label — above symbol */}
      <span style={{
        fontFamily: 'monospace',
        fontSize: 11,
        fontWeight: 700,
        color: '#1A1A1A',
        letterSpacing: '0.03em',
        textAlign: 'center',
        lineHeight: 1.2,
      }}>
        {tag}
      </span>

      {/* ISA symbol centered */}
      <div style={{ position: 'relative', width: 60, height: 60 }}>
        <SymbolComponent color={strokeColor} size={60} strokeWidth={1.8} />

        {/* Left handle — centered vertically on symbol */}
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

        {/* Right handle — centered vertically on symbol */}
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
      </div>

      {/* Type label — below symbol */}
      <span style={{
        fontSize: 9,
        color: '#555',
        textAlign: 'center',
        lineHeight: 1.2,
        maxWidth: 110,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {type}
      </span>

      {/* Criticality dot + SIL level row */}
      {(critColor || silLabel) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
          {critColor && (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: critColor,
                display: 'inline-block',
                flexShrink: 0,
              }}
              title={`Criticality: ${criticality}`}
            />
          )}
          {silLabel && (
            <span style={{
              fontSize: 8,
              fontWeight: 600,
              color: '#777',
              letterSpacing: '0.02em',
            }}>
              SIL {silLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(EquipmentNode, (prev, next) =>
  prev.data === next.data && prev.selected === next.selected
);
