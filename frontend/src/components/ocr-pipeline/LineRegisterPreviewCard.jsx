import { useState, useMemo } from 'react';
import { useLineRegisterPreview, useSyncReviewToExtractions } from '../../hooks/useOcrPipelineV2';

/**
 * Stage 1 — Line register preview (read-only).
 * M3-aligned: same surface/outline/typography patterns as BatchReviewPanel + ImportPreview.
 */
const SUMMARY_STYLES = {
  matched: { color: '#4FE2B0', label: 'Matched', icon: 'check_circle' },
  unmatched: { color: '#FFB068', label: 'OCR not in register', icon: 'warning' },
  gaps: { color: '#8AB4FF', label: 'On P&ID, not in OCR', icon: 'link_off' },
  total: { color: '#BFC9C5', label: 'OCR line tags', icon: 'route' },
};

export default function LineRegisterPreviewCard({ batchId }) {
  const [requested, setRequested] = useState(false);
  const syncReview = useSyncReviewToExtractions(batchId);
  const { data, isLoading, isError, error, refetch, isFetching } = useLineRegisterPreview(batchId, {
    enabled: requested,
  });

  const [section, setSection] = useState('matched');

  const summary = data?.summary;

  const tabs = useMemo(() => [
    { key: 'matched', count: summary?.matchedToRegister ?? 0, ...SUMMARY_STYLES.matched },
    { key: 'unmatched', count: summary?.unmatchedOcrLines ?? 0, ...SUMMARY_STYLES.unmatched },
    { key: 'gaps', count: summary?.registerLinesNotSeenInOcr ?? 0, ...SUMMARY_STYLES.gaps },
  ], [summary]);

  return (
    <div
      className="rounded-md-lg border border-md-outline-variant/20 overflow-hidden"
      style={{ background: 'var(--md-surface-container-low, rgba(26,37,33,0.5))' }}
    >
      <div
        className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-md-outline-variant/15"
        style={{ background: 'var(--md-surface-container-high, rgba(36,51,48,0.35))' }}
      >
        <span className="material-symbols-outlined text-[18px]" style={{ color: 'var(--md-primary)' }}>
          compare_arrows
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-label-sm font-bold text-md-on-surface">Line register preview</div>
          <div className="text-[10px] text-md-on-surface-variant leading-snug">
            Compares <span className="font-mono">ocr_extraction</span> line tags (with OCR coordinates) to the register.
            Save review first, then <span className="font-semibold text-md-on-surface">write approved tags to the DB</span> so
            geometry comes from your cleaned/review JSON — not from the line list alone.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => syncReview.mutate()}
            disabled={syncReview.isPending || !batchId}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
            style={{
              color: '#E8EAED',
              border: '1px solid var(--md-outline-variant)',
              background: 'var(--md-surface-container-high, rgba(36,51,48,0.5))',
            }}
            title="Inserts/updates ocr_extraction from approved + edited review tags, using position_pct as bbox"
          >
            <span className={`material-symbols-outlined text-[14px] ${syncReview.isPending ? 'animate-spin' : ''}`}>
              {syncReview.isPending ? 'progress_activity' : 'save'}
            </span>
            Write OCR tags to DB
          </button>
          {!requested ? (
            <button
              type="button"
              onClick={() => setRequested(true)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
              style={{
                color: 'var(--md-primary)',
                background: 'var(--md-primary-container)',
              }}
            >
              Run preview
            </button>
          ) : (
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
              style={{
                color: 'var(--md-on-surface-variant)',
                border: '1px solid var(--md-outline-variant)',
              }}
            >
              <span className={`material-symbols-outlined text-[14px] ${isFetching ? 'animate-spin' : ''}`}>
                {isFetching ? 'progress_activity' : 'refresh'}
              </span>
              Refresh
            </button>
          )}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {!requested && (
          <p className="text-[11px] text-md-on-surface-variant">
            If preview shows zeros, click <span className="font-semibold">Write OCR tags to DB</span> first — it copies
            approved/edited review tags into <span className="font-mono">ocr_extraction</span> with bbox from the OCR pipeline.
            Existing register links (<span className="font-mono">matched_entity_id</span>) are kept when updating the same text.
          </p>
        )}

        {syncReview.isSuccess && (
          <p className="text-[10px] text-[#3BE494]">
            Synced: +{syncReview.data?.upserted ?? 0} new, {syncReview.data?.updated ?? 0} updated rows.
          </p>
        )}
        {syncReview.isError && (
          <p className="text-[10px] text-red-400">{syncReview.error?.message}</p>
        )}

        {requested && isLoading && (
          <div className="flex items-center gap-2 text-[11px] text-md-on-surface-variant py-4 justify-center">
            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            Building preview…
          </div>
        )}

        {requested && isError && (
          <div className="text-[11px] text-md-error px-1 py-2 rounded-lg border border-red-500/20 bg-red-500/5">
            {error?.message || 'Preview failed'}
          </div>
        )}

        {data && !isLoading && (
          <>
            <div className="flex flex-wrap items-center gap-3 px-0.5">
              <span className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2 h-2 rounded-full" style={{ background: SUMMARY_STYLES.total.color }} />
                <span style={{ color: SUMMARY_STYLES.total.color }} className="font-medium">
                  {summary.ocrLineExtractions} {SUMMARY_STYLES.total.label}
                </span>
              </span>
              {tabs.map(t => (
                <span key={t.key} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                  <span style={{ color: t.color }} className="font-medium">
                    {t.count} {t.label}
                  </span>
                </span>
              ))}
            </div>

            <div className="flex gap-1 border-b border-md-outline-variant/15 pb-2">
              {tabs.map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setSection(t.key)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors"
                  style={{
                    color: section === t.key ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
                    background: section === t.key ? 'var(--md-primary-container)' : 'transparent',
                  }}
                >
                  <span className="material-symbols-outlined text-[14px]">{t.icon}</span>
                  {t.label} ({t.count})
                </button>
              ))}
            </div>

            {section === 'matched' && (
              <PreviewTable
                empty="No OCR line tags matched the register."
                columns={['Drawing', 'Extracted', 'System', 'Line #', 'Source']}
                rows={data.matched.map(m => [
                  m.drawingNumber,
                  m.extractedText,
                  m.systemCode || '—',
                  m.lineNumber,
                  m.matchSource === 'matched_entity_id' ? 'Entity link' : 'Text match',
                ])}
              />
            )}
            {section === 'unmatched' && (
              <PreviewTable
                empty="Every OCR line tag matched a platform line (or there were no line extractions)."
                columns={['Drawing', 'Extracted', 'Conf', 'BBox %']}
                rows={data.unmatchedOcr.map(u => [
                  u.drawingNumber,
                  u.extractedText,
                  u.confidence != null ? `${Math.round(u.confidence * 100)}%` : '—',
                  u.bboxXPct != null && u.bboxYPct != null ? `${u.bboxXPct}, ${u.bboxYPct}` : '—',
                ])}
              />
            )}
            {section === 'gaps' && (
              <PreviewTable
                empty="No pnid_line rows on these sheets without a matching OCR line tag."
                columns={['Drawing', 'System', 'Line #', 'Note']}
                rows={data.registerNotInOcr.map(r => [
                  r.drawingNumber,
                  r.systemCode || '—',
                  r.lineNumber,
                  r.hint,
                ])}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PreviewTable({ columns, rows, empty }) {
  if (!rows.length) {
    return <p className="text-[11px] text-md-on-surface-variant italic py-3 text-center">{empty}</p>;
  }
  return (
    <div className="max-h-56 overflow-auto rounded-lg border border-md-outline-variant/15">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-md-on-surface-variant bg-md-surface-container-high/40 border-b border-md-outline-variant/15">
            {columns.map(c => (
              <th key={c} className="px-2 py-1.5 font-semibold">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-md-outline-variant/10 hover:bg-md-primary/5">
              {cells.map((cell, j) => (
                <td key={j} className="px-2 py-1 text-md-on-surface font-mono">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
