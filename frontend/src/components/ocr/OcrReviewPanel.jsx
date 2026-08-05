import { useState, useMemo, useCallback } from 'react';
import { md, systemColor } from '../../lib/theme';
import { useOcrResults, useOcrApprove, useOcrApproveAll } from '../../hooks/useOcr';
import { useLinkableEntities } from '../../hooks/useAnnotations';
import OcrCanvasOverlay from './OcrCanvasOverlay';

const TAG_TYPE_COLORS = {
  equipment: systemColor('process'),
  instrument: systemColor('instrument'),
  line: systemColor('utility'),
  unknown: '#919A9B',
};

const TAG_TYPE_LABELS = {
  equipment: 'Equipment',
  instrument: 'Instrument',
  line: 'Line',
  unknown: 'Unknown',
};

const STATUS_ICONS = {
  pending: '\u25CB',
  approved: '\u2714',
  rejected: '\u2718',
};

export default function OcrReviewPanel({ pnidId, onClose }) {
  const { data: ocrData, isLoading, refetch } = useOcrResults(pnidId);
  const { data: linkableEntities } = useLinkableEntities(pnidId);
  const approveMutation = useOcrApprove(pnidId);
  const approveAllMutation = useOcrApproveAll(pnidId);

  const [selectedExtraction, setSelectedExtraction] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [linkDialogOpen, setLinkDialogOpen] = useState(null);
  const [searchEntity, setSearchEntity] = useState('');

  const extractions = ocrData?.extractions || [];
  const summary = ocrData?.summary || {};

  const filtered = useMemo(() => {
    let items = extractions;
    if (filterType !== 'all') {
      items = items.filter(e => e.tagType === filterType);
    }
    if (filterStatus !== 'all') {
      items = items.filter(e => e.status === filterStatus);
    }
    return items;
  }, [extractions, filterType, filterStatus]);

  const handleApprove = useCallback((ids) => {
    approveMutation.mutate({ extractionIds: ids, action: 'approve' });
  }, [approveMutation]);

  const handleReject = useCallback((ids) => {
    approveMutation.mutate({ extractionIds: ids, action: 'reject' });
  }, [approveMutation]);

  const handleApproveAll = useCallback(() => {
    approveAllMutation.mutate({ minConfidence: 0.9 });
  }, [approveAllMutation]);

  // Link dialog: search through linkable entities
  const filteredLinkEntities = useMemo(() => {
    if (!linkDialogOpen || !linkableEntities) return [];
    const type = linkDialogOpen.tagType;
    const q = searchEntity.toLowerCase();
    let items = [];

    if (type === 'equipment') {
      items = linkableEntities.equipment || [];
    } else if (type === 'instrument') {
      items = linkableEntities.instruments || [];
    } else if (type === 'line') {
      items = (linkableEntities.lines || []).map(l => ({ ...l, tag: l.lineNumber }));
    } else {
      items = [
        ...(linkableEntities.equipment || []),
        ...(linkableEntities.instruments || []),
        ...(linkableEntities.lines || []).map(l => ({ ...l, tag: l.lineNumber })),
      ];
    }

    if (q) {
      items = items.filter(i =>
        (i.tag || i.lineNumber || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
      );
    }
    return items;
  }, [linkDialogOpen, linkableEntities, searchEntity]);

  if (isLoading) {
    return (
      <div className="absolute inset-0 z-50 bg-md-surface/95 flex items-center justify-center">
        <div className="text-md-on-surface-variant">Loading OCR results...</div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex bg-md-surface/98">
      {/* Left: Canvas with OCR bounding boxes */}
      <div className="flex-1 relative overflow-hidden" style={{ backgroundColor: '#F5F7F7' }}>
        {/* Title bar */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center px-3 py-2 bg-md-surface-container/95 border-b border-md-outline-variant/30 gap-2">
          <button onClick={onClose} className="text-md-on-surface-variant hover:text-md-on-surface text-sm">
            &larr; Back
          </button>
          <div className="h-4 w-px bg-md-outline-variant/30" />
          <span className="text-sm font-bold text-md-on-surface">OCR Review</span>
          <span className="text-xs text-md-on-surface-variant">
            {summary.total || 0} tags found
          </span>
          <div className="flex-1" />

          {/* Bulk actions */}
          {summary.pending > 0 && (
            <>
              <button
                onClick={handleApproveAll}
                disabled={approveAllMutation.isPending}
                className="px-3 py-1 text-xs font-semibold rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors disabled:opacity-50"
              >
                {approveAllMutation.isPending ? 'Approving...' : `Approve All Matched (\u226590%)`}
              </button>
              <button
                onClick={() => {
                  const pendingUnmatched = extractions
                    .filter(e => e.status === 'pending' && !e.matchedEntityId)
                    .map(e => e.id);
                  if (pendingUnmatched.length > 0) handleReject(pendingUnmatched);
                }}
                className="px-3 py-1 text-xs font-semibold rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
              >
                Reject Unmatched
              </button>
            </>
          )}
        </div>

        {/* Canvas area with OCR bounding boxes */}
        <div className="absolute inset-0 pt-10">
          <OcrCanvasOverlay
            extractions={filtered}
            selectedId={selectedExtraction?.id}
            onSelect={setSelectedExtraction}
          />
        </div>
      </div>

      {/* Right: Tag list */}
      <div className="w-[380px] flex flex-col bg-md-surface-container border-l border-md-outline-variant/30 overflow-hidden">
        {/* Summary */}
        <div className="px-3 py-2 border-b border-md-outline-variant/30 bg-md-surface-container-high/50">
          <div className="text-xs font-bold text-md-on-surface mb-1">Extraction Summary</div>
          <div className="grid grid-cols-4 gap-1 text-center">
            {['equipment', 'instrument', 'line', 'unknown'].map(type => (
              <div key={type} className="text-[10px]">
                <div className="font-bold text-sm" style={{ color: TAG_TYPE_COLORS[type] }}>
                  {summary.byType?.[type] || 0}
                </div>
                <div className="text-md-on-surface-variant">{TAG_TYPE_LABELS[type]}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-1 text-[10px] text-md-on-surface-variant">
            <span className="text-green-400">{summary.matched || 0} matched</span>
            <span className="text-amber-400">{summary.unmatched || 0} unmatched</span>
            <span className="text-md-on-surface-variant">{summary.approved || 0} approved</span>
          </div>
        </div>

        {/* Filters */}
        <div className="px-3 py-1.5 border-b border-md-outline-variant/30 flex gap-1 flex-wrap">
          <span className="text-[10px] text-md-on-surface-variant mr-1 self-center">Type:</span>
          {['all', 'equipment', 'instrument', 'line', 'unknown'].map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                filterType === t ? 'bg-white/10 text-white' : 'text-md-on-surface-variant hover:text-md-on-surface'
              }`}
            >
              {t === 'all' ? 'All' : TAG_TYPE_LABELS[t]}
            </button>
          ))}
          <div className="w-px h-4 bg-md-outline-variant/30 mx-1 self-center" />
          <span className="text-[10px] text-md-on-surface-variant mr-1 self-center">Status:</span>
          {['all', 'pending', 'approved', 'rejected'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                filterStatus === s ? 'bg-white/10 text-white' : 'text-md-on-surface-variant hover:text-md-on-surface'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Extraction list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-4 text-center text-sm text-md-on-surface-variant">
              No extractions found
            </div>
          )}

          {filtered.map(ext => {
            const isSelected = selectedExtraction?.id === ext.id;
            const color = TAG_TYPE_COLORS[ext.tagType];
            const isMatched = !!ext.matchedEntityId;
            const isHighConf = ext.matchConfidence >= 0.9;

            return (
              <div
                key={ext.id}
                className={`px-3 py-2 border-b border-md-outline-variant/10 cursor-pointer transition-colors ${
                  isSelected ? 'bg-md-primary/10' : 'hover:bg-md-on-surface/5'
                }`}
                onClick={() => setSelectedExtraction(ext)}
              >
                <div className="flex items-center gap-2">
                  {/* Status icon */}
                  <span className={`text-xs ${
                    ext.status === 'approved' ? 'text-green-400' :
                    ext.status === 'rejected' ? 'text-red-400' :
                    'text-md-on-surface-variant'
                  }`}>
                    {STATUS_ICONS[ext.status] || '\u25CB'}
                  </span>

                  {/* Tag type indicator */}
                  <span
                    className="w-1.5 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />

                  {/* Extracted text */}
                  <span className="text-sm font-bold font-mono flex-1 truncate" style={{ color }}>
                    {ext.extractedText}
                  </span>

                  {/* Match confidence */}
                  {isMatched && (
                    <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${
                      isHighConf ? 'bg-green-600/20 text-green-400' : 'bg-amber-600/20 text-amber-400'
                    }`}>
                      {Math.round(ext.matchConfidence * 100)}%
                    </span>
                  )}
                </div>

                {/* Match info */}
                {isMatched ? (
                  <div className="mt-1 pl-6 text-[10px] text-md-on-surface-variant">
                    <span className="text-green-400/80">
                      {'\u2192'} {ext.matchedEntity?.tag || ext.matchedEntity?.line_number || 'matched'}
                    </span>
                    {ext.matchedEntity?.description && (
                      <span className="ml-1 truncate">{ext.matchedEntity.description}</span>
                    )}
                    <span className="ml-1 text-md-on-surface-variant/50">({ext.matchMethod})</span>
                  </div>
                ) : (
                  <div className="mt-1 pl-6 text-[10px] text-red-400/80">No match in database</div>
                )}

                {/* Type + OCR confidence */}
                <div className="mt-0.5 pl-6 flex items-center gap-2 text-[9px] text-md-on-surface-variant">
                  <span className="px-1 py-0.5 rounded" style={{ backgroundColor: color + '20', color }}>
                    {TAG_TYPE_LABELS[ext.tagType]}
                  </span>
                  <span>OCR: {Math.round(ext.confidence * 100)}%</span>
                </div>

                {/* Action buttons (for pending) */}
                {ext.status === 'pending' && (
                  <div className="mt-1.5 pl-6 flex gap-1.5">
                    {isMatched && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleApprove([ext.id]); }}
                        className="px-2 py-0.5 text-[10px] font-semibold rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors"
                      >
                        Approve
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLinkDialogOpen(ext);
                        setSearchEntity('');
                      }}
                      className="px-2 py-0.5 text-[10px] font-semibold rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
                    >
                      {isMatched ? 'Re-link' : 'Link'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReject([ext.id]); }}
                      className="px-2 py-0.5 text-[10px] font-semibold rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Link dialog — select entity from DB */}
      {linkDialogOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-[400px] max-h-[500px] bg-md-surface-container rounded-lg shadow-xl border border-md-outline-variant/30 flex flex-col">
            <div className="px-4 py-3 border-b border-md-outline-variant/30 flex items-center gap-2">
              <span className="text-sm font-bold text-md-on-surface">
                Link "{linkDialogOpen.extractedText}" to:
              </span>
              <div className="flex-1" />
              <button
                onClick={() => setLinkDialogOpen(null)}
                className="text-md-on-surface-variant hover:text-md-on-surface"
              >
                <span className="text-lg">&times;</span>
              </button>
            </div>

            <div className="px-4 py-2">
              <input
                value={searchEntity}
                onChange={e => setSearchEntity(e.target.value)}
                placeholder="Search entities..."
                className="md-input w-full px-3 py-1.5 text-sm"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {filteredLinkEntities.map(entity => (
                <button
                  key={entity.id}
                  onClick={() => {
                    const API_URL = import.meta.env.VITE_API_URL || '/api/v1';
                    fetch(`${API_URL}/ocr/extractions/${linkDialogOpen.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ matchedEntityId: entity.id }),
                    }).then(() => {
                      refetch();
                      setLinkDialogOpen(null);
                    });
                  }}
                  className="w-full text-left px-3 py-2 rounded hover:bg-md-on-surface/5 transition-colors flex items-center gap-2"
                >
                  <span className="text-sm font-bold font-mono text-md-primary">{entity.tag || entity.lineNumber}</span>
                  <span className="text-xs text-md-on-surface-variant truncate flex-1">
                    {entity.type || entity.service || ''} {entity.description || ''}
                  </span>
                </button>
              ))}
              {filteredLinkEntities.length === 0 && (
                <div className="p-4 text-center text-sm text-md-on-surface-variant">
                  No matching entities found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
