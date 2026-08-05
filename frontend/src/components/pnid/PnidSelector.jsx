import { useState, useMemo } from 'react';

const STATUS_BADGE = {
  as_built: { color: 'bg-md-primary/20 text-md-primary', label: 'As-Built' },
  approved: { color: 'bg-md-secondary/20 text-md-secondary', label: 'Approved' },
  draft: { color: 'bg-md-tertiary/20 text-md-tertiary', label: 'Draft' },
  issued_for_construction: { color: 'bg-md-secondary/20 text-md-secondary', label: 'IFC' },
  issued_for_review: { color: 'bg-md-tertiary/20 text-md-tertiary', label: 'IFR' },
  superseded: { color: 'bg-md-on-surface-variant/20 text-md-on-surface-variant', label: 'Superseded' },
};

export default function PnidSelector({ pnids, loading, onSelect }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = useMemo(() => {
    if (!pnids) return [];
    return pnids.filter(p => {
      const matchSearch = !search ||
        p.drawingNumber?.toLowerCase().includes(search.toLowerCase()) ||
        p.title?.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || p.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [pnids, search, statusFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-md-on-surface-variant text-sm">Loading P&IDs...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-md-outline-variant/30">
        <h2 className="text-lg font-bold text-md-on-surface mb-2">P&ID Drawings</h2>
        <p className="text-xs text-md-on-surface-variant mb-3">Select a P&ID to open the annotation viewer</p>
        <input
          type="text"
          placeholder="Search by drawing number or title..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-md-surface-container-high border border-md-outline-variant/30 rounded px-3 py-1.5 text-sm text-md-on-surface placeholder-md-on-surface-variant"
        />
        <div className="flex gap-1 mt-2">
          {['all', 'as_built', 'approved', 'draft'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-0.5 text-[10px] rounded ${
                statusFilter === s ? 'bg-md-primary/20 text-md-primary' : 'text-md-on-surface-variant hover:text-md-on-surface'
              }`}
            >
              {s === 'all' ? 'All' : STATUS_BADGE[s]?.label || s}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(pnid => {
            const badge = STATUS_BADGE[pnid.status] || STATUS_BADGE.draft;
            return (
              <button
                key={pnid.id}
                onClick={() => onSelect(pnid)}
                className="text-left bg-md-surface-container-high border border-md-outline-variant/30 rounded-lg p-3 hover:border-md-primary/30 hover:bg-md-surface-container-highest transition-all group"
              >
                {/* Drawing thumbnail placeholder */}
                <div className="w-full h-24 bg-md-surface-container/50 rounded mb-2 flex items-center justify-center">
                  <span className="text-3xl opacity-30 group-hover:opacity-50 transition-opacity">
                    {pnid.hasImage ? '📐' : '📄'}
                  </span>
                </div>
                <p className="text-xs font-bold text-md-on-surface font-mono truncate">{pnid.drawingNumber}</p>
                <p className="text-[10px] text-md-on-surface-variant truncate mt-0.5">{pnid.title}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-[8px] px-1.5 py-0.5 rounded ${badge.color}`}>
                    {badge.label}
                  </span>
                  {pnid.revision && (
                    <span className="text-[8px] text-md-on-surface-variant">Rev {pnid.revision}</span>
                  )}
                  {pnid.primarySystemCode && (
                    <span className="text-[8px] text-md-primary ml-auto">{pnid.primarySystemCode}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-md-on-surface-variant text-sm">No P&IDs found</p>
            {search && <p className="text-md-on-surface-variant text-xs mt-1">Try a different search term</p>}
          </div>
        )}
      </div>
    </div>
  );
}
