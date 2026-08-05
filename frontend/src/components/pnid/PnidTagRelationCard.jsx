import { ENTITY_COLORS_MAP } from './pnidTagSearchUtils';

export default function PnidTagRelationCard({
  selectedTag,
  relations,
  onNavigateToEntity,
  onClose,
}) {
  if (!selectedTag) return null;

  const color = ENTITY_COLORS_MAP[selectedTag.entityType] || '#D3DFE2';
  const hasRelations = relations && (relations.parent || relations.children?.length > 0);

  return (
    <div
      className="absolute bottom-4 left-4 z-40 w-72 rounded-xl shadow-2xl overflow-hidden"
      style={{ background: '#111D14', border: '1px solid rgba(59,228,148,0.25)' }}
    >
      <div className="px-3 py-2.5 flex items-start justify-between gap-2 border-b border-white/10">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-bold text-white truncate">{selectedTag.tag}</span>
            <span
              className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded shrink-0"
              style={{ background: `${color}20`, color }}
            >
              {selectedTag.entityType}
            </span>
          </div>
          <div className="text-[10px] text-white/50 mt-0.5">
            {selectedTag.hasPosition ? 'Highlighted on sheet' : 'Linked but not positioned on this sheet'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-white/10"
        >
          <span className="material-symbols-outlined text-[16px] text-white/50">close</span>
        </button>
      </div>

      {hasRelations ? (
        <div className="px-3 py-2.5 space-y-2 text-[11px]">
          {relations.parent && (
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-white/40 mb-1">Parent</div>
              <RelationRow
                ref_={relations.parent}
                onNavigate={onNavigateToEntity}
              />
            </div>
          )}
          {relations.children?.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-white/40 mb-1">
                Children ({relations.children.length})
              </div>
              <div className="space-y-1">
                {relations.children.map((child) => (
                  <RelationRow
                    key={child.segmentId}
                    ref_={child}
                    onNavigate={onNavigateToEntity}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-3 text-[10px] text-white/40 italic">
          No parent-child relationship defined for this tag.
        </div>
      )}
    </div>
  );
}

function RelationRow({ ref_, onNavigate }) {
  const canNavigate = !!ref_.entityId;
  const color = ENTITY_COLORS_MAP[ref_.entityType] || '#919A9B';

  return (
    <button
      type="button"
      disabled={!canNavigate}
      onClick={() => canNavigate && onNavigate?.(ref_.entityId, ref_.entityType)}
      className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
        canNavigate ? 'hover:bg-white/5 cursor-pointer' : 'opacity-60 cursor-default'
      }`}
      style={{ border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <span className="material-symbols-outlined text-[14px]" style={{ color }}>
        {ref_.entityType === 'line' ? 'linear_scale' : ref_.entityType === 'instrument' ? 'speed' : 'precision_manufacturing'}
      </span>
      <span className="flex-1 truncate text-white/85 font-medium">{ref_.label}</span>
      {ref_.flowSequence != null && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/60">
          #{ref_.flowSequence}
        </span>
      )}
    </button>
  );
}
