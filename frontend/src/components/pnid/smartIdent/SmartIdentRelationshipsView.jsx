import { useMemo } from 'react';
import { md } from '../../../lib/theme';
import { SMART_IDENT_COLORS, segmentStrokeColor } from '../../../hooks/useSmartIdentification';
import {
  buildSegmentHierarchy,
  hierarchyStats,
  segmentLabel,
  segmentSubtitle,
} from './segmentHierarchy';

function typeIcon(segment) {
  const t = segment.linkedEntityType || segment.metadata?.category || segment.segmentType;
  if (t === 'line' || t === 'piping') return 'linear_scale';
  if (t === 'equipment') return 'precision_manufacturing';
  if (t === 'instrument') return 'speed';
  if (t === 'valve') return 'valve';
  if (segment.segmentType === 'symbol') return 'category';
  return 'crop_square';
}

function TreeNode({ node, depth = 0, onSelectSegment }) {
  const { segment, children } = node;
  const assigned = !!segment.linkedEntityId;
  const color = segmentStrokeColor(segment, false);

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelectSegment?.(segment)}
        className="w-full text-left flex items-center gap-2 py-2 px-3 rounded-lg transition-colors hover:opacity-90"
        style={{
          marginLeft: depth * 20,
          width: `calc(100% - ${depth * 20}px)`,
          background: md.surfaceContainerHigh,
          border: `1px solid ${assigned ? `${color}35` : md.outlineVariant}`,
          borderLeft: `3px solid ${color}`,
        }}
      >
        <span
          className="material-symbols-outlined text-[18px] shrink-0"
          style={{ color: assigned ? color : md.onSurfaceVariant }}
        >
          {typeIcon(segment)}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="text-sm font-semibold truncate"
            style={{ color: assigned ? md.onSurface : md.onSurfaceVariant }}
          >
            {segmentLabel(segment)}
          </div>
          <div className="text-[10px] truncate" style={{ color: md.onSurfaceVariant }}>
            {segmentSubtitle(segment)}
          </div>
        </div>
        {children.length > 0 && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
            style={{ background: `${color}20`, color }}
          >
            {children.length} downstream
          </span>
        )}
        {segment.metadata?.flowSequence != null && (
          <span
            className="text-[9px] font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0"
            style={{ background: `${SMART_IDENT_COLORS.instrument}25`, color: SMART_IDENT_COLORS.instrument }}
          >
            {segment.metadata.flowSequence}
          </span>
        )}
        {!assigned && (
          <span className="text-[9px] italic shrink-0" style={{ color: md.onSurfaceVariant }}>
            unassigned
          </span>
        )}
      </button>
      {children.length > 0 && (
        <div className="mt-1 space-y-1">
          {children.map((child) => (
            <TreeNode
              key={child.segment.id}
              node={child}
              depth={depth + 1}
              onSelectSegment={onSelectSegment}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Full-screen hierarchy of smart-ident segments and parent-child links.
 */
export default function SmartIdentRelationshipsView({
  segments = [],
  pnidTitle,
  drawingNumber,
  onClose,
  onSelectSegment,
}) {
  const tree = useMemo(() => buildSegmentHierarchy(segments), [segments]);
  const stats = useMemo(() => hierarchyStats(segments), [segments]);
  const unassigned = useMemo(
    () => segments.filter((s) => !s.linkedEntityId),
    [segments],
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: 'linear-gradient(180deg, #152018 0%, #0d1612 100%)' }}
    >
      <header
        className="shrink-0 flex items-center justify-between gap-4 px-5 py-4 border-b"
        style={{ borderColor: 'rgba(59,228,148,0.15)', background: 'rgba(30,42,36,0.95)' }}
      >
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]" style={{ color: SMART_IDENT_COLORS.boundary }}>account_tree</span>
            Flow Hierarchy
          </h2>
          <p className="text-xs mt-1 text-white/50">
            {drawingNumber || pnidTitle || 'P&ID'}
            {' · '}
            {stats.total} shapes · {stats.assigned} assigned · sorted by flow direction
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{
            background: md.surfaceContainerHigh,
            color: md.onSurface,
            border: `1px solid ${md.outlineVariant}`,
          }}
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
          Back to drawing
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {segments.length === 0 ? (
          <div
            className="max-w-md mx-auto text-center py-16 rounded-xl"
            style={{ background: md.surfaceContainer, border: `1px solid ${md.outlineVariant}` }}
          >
            <span
              className="material-symbols-outlined text-[48px] opacity-40"
              style={{ color: md.onSurfaceVariant }}
            >
              account_tree
            </span>
            <p className="mt-3 text-sm font-semibold" style={{ color: md.onSurface }}>
              No shapes yet
            </p>
            <p className="mt-1 text-xs px-6" style={{ color: md.onSurfaceVariant }}>
              Draw lines and symbols on the P&ID, assign tags, and set optional parent links.
              They will appear here as a hierarchy.
            </p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Summary chips */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Total', value: stats.total, color: md.onSurface },
                { label: 'Assigned', value: stats.assigned, color: SMART_IDENT_COLORS.boundary },
                { label: 'With parent', value: stats.withParent, color: SMART_IDENT_COLORS.line },
                { label: 'Root items', value: stats.roots, color: SMART_IDENT_COLORS.equipment },
              ].map((chip) => (
                <div
                  key={chip.label}
                  className="px-3 py-1.5 rounded-lg text-xs"
                  style={{ background: md.surfaceContainerHigh, border: `1px solid ${md.outlineVariant}` }}
                >
                  <span style={{ color: md.onSurfaceVariant }}>{chip.label}: </span>
                  <span className="font-bold" style={{ color: chip.color }}>{chip.value}</span>
                </div>
              ))}
            </div>

            {/* Hierarchy */}
            <section>
              <h3
                className="text-xs font-bold uppercase tracking-wide mb-3 flex items-center gap-2"
                style={{ color: md.onSurfaceVariant }}
              >
                <span className="material-symbols-outlined text-[16px]">account_tree</span>
                Hierarchy
              </h3>
              {tree.length === 0 ? (
                <p className="text-xs" style={{ color: md.onSurfaceVariant }}>
                  No root segments found.
                </p>
              ) : (
                <div className="space-y-2">
                  {tree.map((node) => (
                    <TreeNode
                      key={node.segment.id}
                      node={node}
                      onSelectSegment={onSelectSegment}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Unassigned flat list */}
            {unassigned.length > 0 && (
              <section>
                <h3
                  className="text-xs font-bold uppercase tracking-wide mb-3 flex items-center gap-2"
                  style={{ color: md.onSurfaceVariant }}
                >
                  <span className="material-symbols-outlined text-[16px]">label_off</span>
                  Unassigned ({unassigned.length})
                </h3>
                <div className="space-y-1">
                  {unassigned.map((seg) => (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => onSelectSegment?.(seg)}
                      className="w-full text-left flex items-center gap-2 py-2 px-3 rounded-lg"
                      style={{
                        background: md.surfaceContainerHigh,
                        border: `1px dashed ${md.outlineVariant}`,
                        color: md.onSurfaceVariant,
                      }}
                    >
                      <span className="material-symbols-outlined text-[16px]">{typeIcon(seg)}</span>
                      <span className="text-sm">{segmentLabel(seg)}</span>
                      <span className="text-[10px] ml-auto">{segmentSubtitle(seg)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <p className="text-[10px] leading-relaxed pb-8" style={{ color: md.onSurfaceVariant }}>
              Click any item to jump back to the drawing and select that shape for editing.
              Parent links are set in the assign panel when you pick an optional parent segment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
