import { useState, useMemo } from 'react';

const API = import.meta.env.VITE_API_URL || '/api/v1';

const KIND_COLORS = {
  equipment: { fill: 'rgba(59,228,148,0.15)', stroke: '#3BE494', label: 'Equipment' },
  instrument: { fill: 'rgba(243,156,18,0.15)', stroke: '#F39C12', label: 'Instruments' },
  line: { fill: 'rgba(45,51,224,0.15)', stroke: '#2D33E0', label: 'Lines' },
  system: { fill: 'rgba(168,85,247,0.15)', stroke: '#A855F7', label: 'Systems' },
};

const ACTION_ICONS = {
  link_pnid: { icon: 'link', color: '#3BE494' },
  create_entity: { icon: 'add_circle', color: '#8AB4FF' },
  unlink_pnid: { icon: 'link_off', color: '#FFB068' },
};

/**
 * StagingCoordinatePreview — Shows P&ID thumbnail with bbox overlays for staging items.
 * Grouped by P&ID, filtered by entity kind. Color-coded by entity type.
 */
export default function StagingCoordinatePreview({ items, onClose }) {
  const [activeKind, setActiveKind] = useState('all');
  const [hoveredId, setHoveredId] = useState(null);

  // Group items by P&ID
  const byPnid = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      if (!item.pnidId) continue;
      // Only show items with bbox coordinates
      const bbox = item.payload?.position_pct || item.payload?.positionPct;
      if (!bbox && !item.payload?.x_pct) continue;
      if (!map.has(item.pnidId)) map.set(item.pnidId, []);
      map.get(item.pnidId).push(item);
    }
    return map;
  }, [items]);

  const pnidIds = useMemo(() => [...byPnid.keys()], [byPnid]);
  const [activePnid, setActivePnid] = useState(() => pnidIds[0] || null);

  const visibleItems = useMemo(() => {
    const all = byPnid.get(activePnid) || [];
    if (activeKind === 'all') return all;
    return all.filter(i => i.entityKind === activeKind);
  }, [byPnid, activePnid, activeKind]);

  const kindCounts = useMemo(() => {
    const all = byPnid.get(activePnid) || [];
    const counts = { all: all.length };
    for (const item of all) {
      counts[item.entityKind] = (counts[item.entityKind] || 0) + 1;
    }
    return counts;
  }, [byPnid, activePnid]);

  if (pnidIds.length === 0) {
    return (
      <div className="p-4 text-[11px] text-md-on-surface-variant">
        No staging items with coordinates to preview.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-[#F39C12]">preview</span>
          <span className="text-label-sm font-bold text-md-on-surface">Coordinate Preview</span>
          <span className="text-[10px] text-md-on-surface-variant">
            {visibleItems.length} tags on {pnidIds.length} P&ID(s)
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="md-icon-btn w-6 h-6">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>

      {/* P&ID selector (if multiple) */}
      {pnidIds.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {pnidIds.map(pid => (
            <button
              key={pid}
              onClick={() => setActivePnid(pid)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                activePnid === pid
                  ? 'bg-md-primary/20 text-md-primary font-bold'
                  : 'text-md-on-surface-variant hover:bg-md-surface-container-high'
              }`}
            >
              {pid.slice(0, 8)}… ({byPnid.get(pid)?.length || 0})
            </button>
          ))}
        </div>
      )}

      {/* Kind filter */}
      <div className="flex gap-1">
        <button
          onClick={() => setActiveKind('all')}
          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
            activeKind === 'all' ? 'bg-white/10 text-md-on-surface' : 'text-md-on-surface-variant'
          }`}
        >
          All ({kindCounts.all || 0})
        </button>
        {Object.entries(KIND_COLORS).map(([kind, cfg]) => (
          kindCounts[kind] > 0 && (
            <button
              key={kind}
              onClick={() => setActiveKind(kind)}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                activeKind === kind ? `bg-[${cfg.stroke}]/20` : ''
              }`}
              style={{ color: activeKind === kind ? cfg.stroke : 'var(--md-on-surface-variant)' }}
            >
              {cfg.label} ({kindCounts[kind]})
            </button>
          )
        ))}
      </div>

      {/* P&ID image with bbox overlays */}
      {activePnid && (
        <div
          className="relative rounded-lg overflow-hidden border border-md-outline-variant/20"
          style={{ background: '#F5F7F7', minHeight: 300 }}
        >
          <img
            src={`${API}/pnids/${activePnid}/file`}
            alt="P&ID"
            className="w-full h-auto"
            style={{ display: 'block' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />

          {/* Bbox overlays */}
          {visibleItems.map(item => {
            const bbox = item.payload?.position_pct || item.payload?.positionPct || {};
            const x = bbox.x_pct ?? bbox.xPct ?? 0;
            const y = bbox.y_pct ?? bbox.yPct ?? 0;
            const w = bbox.w_pct ?? bbox.wPct ?? 0;
            const h = bbox.h_pct ?? bbox.hPct ?? 0;
            if (!x && !y) return null;

            const kindColor = KIND_COLORS[item.entityKind] || KIND_COLORS.equipment;
            const actionInfo = ACTION_ICONS[item.actionType] || ACTION_ICONS.link_pnid;
            const isHovered = hoveredId === item.id;
            const tagText = item.payload?.tagText || item.payload?.tag_text || '—';

            return (
              <div
                key={item.id}
                className="absolute transition-all cursor-pointer"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: w > 0 ? `${w}%` : '4%',
                  height: h > 0 ? `${h}%` : '2%',
                  background: isHovered ? kindColor.fill.replace('0.15', '0.35') : kindColor.fill,
                  border: `2px solid ${kindColor.stroke}`,
                  borderRadius: 2,
                  zIndex: isHovered ? 50 : 10,
                }}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Tag label */}
                <div
                  className="absolute -top-5 left-0 whitespace-nowrap px-1 py-0.5 rounded text-[8px] font-bold"
                  style={{
                    background: kindColor.stroke,
                    color: '#fff',
                    opacity: isHovered ? 1 : 0.85,
                  }}
                >
                  <span className="material-symbols-outlined text-[8px] mr-0.5" style={{ verticalAlign: 'middle' }}>
                    {actionInfo.icon}
                  </span>
                  {tagText}
                </div>

                {/* Hover tooltip */}
                {isHovered && (
                  <div
                    className="absolute top-full left-0 mt-1 p-2 rounded-md shadow-lg z-50 text-[9px] space-y-0.5 min-w-[140px]"
                    style={{ background: 'rgba(17,29,20,0.95)', color: '#D3DFE2' }}
                  >
                    <div className="font-bold" style={{ color: kindColor.stroke }}>{tagText}</div>
                    <div>Kind: {item.entityKind}</div>
                    <div>Action: <span style={{ color: actionInfo.color }}>
                      {item.actionType === 'link_pnid' ? 'Link existing'
                        : item.actionType === 'create_entity' ? 'Create new'
                          : 'Unlink / remove'}
                    </span></div>
                    <div>Position: ({x.toFixed(1)}%, {y.toFixed(1)}%)</div>
                    {item.payload?.confidence != null && (
                      <div>Confidence: {(item.payload.confidence * 100).toFixed(0)}%</div>
                    )}
                    <div>Status: {item.status}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[9px] text-md-on-surface-variant">
        {Object.entries(KIND_COLORS).map(([kind, cfg]) => (
          <div key={kind} className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm border" style={{ background: cfg.fill, borderColor: cfg.stroke }} />
            <span>{cfg.label}</span>
          </div>
        ))}
        <span className="opacity-50">|</span>
        {Object.entries(ACTION_ICONS).map(([action, cfg]) => (
          <div key={action} className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[10px]" style={{ color: cfg.color }}>{cfg.icon}</span>
            <span>{action === 'link_pnid' ? 'Link' : action === 'create_entity' ? 'Create' : 'Unlink'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
