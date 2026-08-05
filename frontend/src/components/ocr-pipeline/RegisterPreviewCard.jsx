import { useState, useMemo } from 'react';
import {
  useLineRegisterPreview,
  useEquipmentRegisterPreview,
  useInstrumentRegisterPreview,
  useSyncReviewToExtractions,
} from '../../hooks/useOcrPipelineV2';

const API = import.meta.env.VITE_API_URL || '/api/v1';

/**
 * Unified register preview — Lines / Equipment / Instruments tabs,
 * each with Matched / Not in Register / Gaps sub-tabs + CSV export.
 */

const ENTITY_TABS = [
  { key: 'line',       label: 'Lines',       color: '#2D33E0', icon: 'route' },
  { key: 'equipment',  label: 'Equipment',   color: '#3BE494', icon: 'precision_manufacturing' },
  { key: 'instrument', label: 'Instruments', color: '#F39C12', icon: 'sensors' },
];

const SECTION_STYLES = {
  matched:   { color: '#4FE2B0', label: 'Matched',              icon: 'check_circle' },
  unmatched: { color: '#FFB068', label: 'OCR not in register',  icon: 'warning' },
  gaps:      { color: '#8AB4FF', label: 'On P&ID, not in OCR',  icon: 'link_off' },
};

function usePreviewByType(type, batchId, enabled) {
  const line = useLineRegisterPreview(batchId, { enabled: type === 'line' && enabled });
  const equip = useEquipmentRegisterPreview(batchId, { enabled: type === 'equipment' && enabled });
  const instr = useInstrumentRegisterPreview(batchId, { enabled: type === 'instrument' && enabled });
  if (type === 'line') return line;
  if (type === 'equipment') return equip;
  return instr;
}

// ─── CSV download helper (frontend-generated from JSON) ─────────────────

function csvEscape(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildCsvContent(data, sectionKey, entityType) {
  const rows = [];

  if (sectionKey === 'matched' || sectionKey === 'all') {
    rows.push(['Drawing', 'Extracted Text', 'System', 'Register Tag', 'Context', 'Match Source', 'Confidence'].map(csvEscape).join(','));
    for (const m of (data.matched || [])) {
      rows.push([
        m.drawingNumber, m.extractedText, m.systemCode || '',
        m.registerTag || m.lineNumber || '', m.contextValue || '',
        m.matchSource === 'matched_entity_id' ? 'Entity link' : 'Text match',
        m.confidence != null ? Math.round(m.confidence * 100) + '%' : '',
      ].map(csvEscape).join(','));
    }
  }

  if (sectionKey === 'unmatched' || sectionKey === 'all') {
    if (rows.length) rows.push('');
    rows.push(['Drawing', 'Extracted Text', 'Confidence', 'BBox X%', 'BBox Y%', 'Hint'].map(csvEscape).join(','));
    for (const u of (data.unmatchedOcr || [])) {
      rows.push([
        u.drawingNumber, u.extractedText,
        u.confidence != null ? Math.round(u.confidence * 100) + '%' : '',
        u.bboxXPct ?? '', u.bboxYPct ?? '', u.hint || '',
      ].map(csvEscape).join(','));
    }
  }

  if (sectionKey === 'gaps' || sectionKey === 'all') {
    if (rows.length) rows.push('');
    rows.push(['Drawing', 'System', 'Register Tag', 'Context', 'Note'].map(csvEscape).join(','));
    for (const g of (data.registerNotInOcr || [])) {
      rows.push([
        g.drawingNumber, g.systemCode || '',
        g.registerTag || g.lineNumber || '', g.contextValue || '', g.hint || '',
      ].map(csvEscape).join(','));
    }
  }

  return rows.join('\n') + '\n';
}

// ─── Main Component ─────────────────────────────────────────────────────

export default function RegisterPreviewCard({ batchId }) {
  const [activeEntity, setActiveEntity] = useState('line');
  const [requestedTypes, setRequestedTypes] = useState({});
  const [section, setSection] = useState('matched');
  const syncReview = useSyncReviewToExtractions(batchId);

  const isRequested = !!requestedTypes[activeEntity];
  const { data, isLoading, isError, error, refetch, isFetching } = usePreviewByType(
    activeEntity, batchId, isRequested,
  );

  const handleRequest = () => {
    setRequestedTypes(prev => ({ ...prev, [activeEntity]: true }));
  };

  // Normalize data shape (line preview uses slightly different field names)
  const normalizedData = useMemo(() => {
    if (!data) return null;
    // Line preview returns lineNumber/lineId; unified returns registerTag/entityId
    // Handle both shapes
    return {
      summary: {
        ocrExtractions: data.summary?.ocrExtractions ?? data.summary?.ocrLineExtractions ?? 0,
        matchedToRegister: data.summary?.matchedToRegister ?? 0,
        unmatchedOcr: data.summary?.unmatchedOcr ?? data.summary?.unmatchedOcrLines ?? 0,
        registerNotInOcr: data.summary?.registerNotInOcr ?? data.summary?.registerLinesNotSeenInOcr ?? 0,
      },
      matched: (data.matched || []).map(m => ({
        ...m,
        registerTag: m.registerTag || m.lineNumber || '—',
        contextValue: m.contextValue ?? null,
      })),
      unmatchedOcr: data.unmatchedOcr || [],
      registerNotInOcr: (data.registerNotInOcr || []).map(g => ({
        ...g,
        registerTag: g.registerTag || g.lineNumber || '—',
        contextValue: g.contextValue ?? null,
      })),
    };
  }, [data]);

  const summary = normalizedData?.summary;

  const sectionTabs = useMemo(() => [
    { key: 'matched', count: summary?.matchedToRegister ?? 0, ...SECTION_STYLES.matched },
    { key: 'unmatched', count: summary?.unmatchedOcr ?? 0, ...SECTION_STYLES.unmatched },
    { key: 'gaps', count: summary?.registerNotInOcr ?? 0, ...SECTION_STYLES.gaps },
  ], [summary]);

  const entityTab = ENTITY_TABS.find(t => t.key === activeEntity);
  const showContext = activeEntity !== 'line';

  return (
    <div
      className="rounded-md-lg border border-md-outline-variant/20 overflow-hidden"
      style={{ background: 'var(--md-surface-container-low, rgba(26,37,33,0.5))' }}
    >
      {/* ─── Header ─── */}
      <div
        className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-md-outline-variant/15"
        style={{ background: 'var(--md-surface-container-high, rgba(36,51,48,0.35))' }}
      >
        <span className="material-symbols-outlined text-[18px]" style={{ color: 'var(--md-primary)' }}>
          compare_arrows
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-label-sm font-bold text-md-on-surface">Register comparison preview</div>
          <div className="text-[10px] text-md-on-surface-variant leading-snug">
            Compares OCR-extracted tags against your existing registers (lines, equipment, instruments).
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
            title="Write approved/edited review tags to ocr_extraction with bbox from OCR pipeline"
          >
            <span className={`material-symbols-outlined text-[14px] ${syncReview.isPending ? 'animate-spin' : ''}`}>
              {syncReview.isPending ? 'progress_activity' : 'save'}
            </span>
            Write OCR tags to DB
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Sync result messages */}
        {syncReview.isSuccess && (
          <p className="text-[10px] text-[#3BE494]">
            Synced: +{syncReview.data?.upserted ?? 0} new, {syncReview.data?.updated ?? 0} updated rows.
            {syncReview.data?.pnidLinked > 0 && ` (${syncReview.data.pnidLinked} P&ID links resolved)`}
          </p>
        )}
        {syncReview.isError && (
          <p className="text-[10px] text-red-400">{syncReview.error?.message}</p>
        )}

        {/* ─── Entity Type Tabs ─── */}
        <div className="flex gap-1 border-b border-md-outline-variant/15 pb-2">
          {ENTITY_TABS.map(tab => {
            const isActive = activeEntity === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => { setActiveEntity(tab.key); setSection('matched'); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
                style={{
                  color: isActive ? tab.color : 'var(--md-on-surface-variant)',
                  background: isActive ? `${tab.color}15` : 'transparent',
                  borderBottom: isActive ? `2px solid ${tab.color}` : '2px solid transparent',
                }}
              >
                <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ─── Run / Refresh buttons ─── */}
        <div className="flex items-center gap-2">
          {!isRequested ? (
            <button
              type="button"
              onClick={handleRequest}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
              style={{ color: entityTab.color, background: `${entityTab.color}20` }}
            >
              Run {entityTab.label} preview
            </button>
          ) : (
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
              style={{ color: 'var(--md-on-surface-variant)', border: '1px solid var(--md-outline-variant)' }}
            >
              <span className={`material-symbols-outlined text-[14px] ${isFetching ? 'animate-spin' : ''}`}>
                {isFetching ? 'progress_activity' : 'refresh'}
              </span>
              Refresh
            </button>
          )}

          {/* CSV export */}
          {normalizedData && !isLoading && (
            <button
              type="button"
              onClick={() => {
                const csv = buildCsvContent(normalizedData, 'all', activeEntity);
                downloadCsv(csv, `${activeEntity}-register-preview.csv`);
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
              style={{ color: 'var(--md-on-surface-variant)', border: '1px solid var(--md-outline-variant)' }}
              title="Download all sections as CSV"
            >
              <span className="material-symbols-outlined text-[14px]">download</span>
              Export CSV
            </button>
          )}
        </div>

        {/* ─── Loading / Error ─── */}
        {isRequested && isLoading && (
          <div className="flex items-center gap-2 text-[11px] text-md-on-surface-variant py-4 justify-center">
            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            Building {entityTab.label.toLowerCase()} preview...
          </div>
        )}
        {isRequested && isError && (
          <div className="text-[11px] text-md-error px-1 py-2 rounded-lg border border-red-500/20 bg-red-500/5">
            {error?.message || 'Preview failed'}
          </div>
        )}

        {/* ─── Results ─── */}
        {normalizedData && !isLoading && (
          <>
            {/* Summary pills */}
            <div className="flex flex-wrap items-center gap-3 px-0.5">
              <span className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2 h-2 rounded-full" style={{ background: entityTab.color }} />
                <span style={{ color: entityTab.color }} className="font-medium">
                  {summary.ocrExtractions} OCR {entityTab.label.toLowerCase()} tags
                </span>
              </span>
              {sectionTabs.map(t => (
                <span key={t.key} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                  <span style={{ color: t.color }} className="font-medium">
                    {t.count} {t.label}
                  </span>
                </span>
              ))}
            </div>

            {/* Section sub-tabs */}
            <div className="flex gap-1 border-b border-md-outline-variant/15 pb-2">
              {sectionTabs.map(t => (
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

              {/* Per-section CSV */}
              <button
                type="button"
                onClick={() => {
                  const csv = buildCsvContent(normalizedData, section, activeEntity);
                  downloadCsv(csv, `${activeEntity}-${section}.csv`);
                }}
                className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-colors"
                style={{ color: 'var(--md-on-surface-variant)' }}
                title={`Download ${section} as CSV`}
              >
                <span className="material-symbols-outlined text-[12px]">download</span>
                CSV
              </button>
            </div>

            {/* Tables */}
            {section === 'matched' && (
              <PreviewTable
                empty={`No OCR ${entityTab.label.toLowerCase()} tags matched the register.`}
                columns={showContext
                  ? ['Drawing', 'Extracted', 'System', 'Tag', 'Type', 'Source']
                  : ['Drawing', 'Extracted', 'System', 'Line #', 'Source']
                }
                rows={normalizedData.matched.map(m => {
                  const base = [
                    m.drawingNumber,
                    m.extractedText,
                    m.systemCode || '—',
                    m.registerTag,
                  ];
                  if (showContext) base.push(m.contextValue || '—');
                  base.push(m.matchSource === 'matched_entity_id' ? 'Entity link' : 'Text match');
                  return base;
                })}
              />
            )}
            {section === 'unmatched' && (
              <PreviewTable
                empty={`Every OCR ${entityTab.label.toLowerCase()} tag matched the register (or none were extracted).`}
                columns={['Drawing', 'Extracted', 'Conf', 'BBox %']}
                rows={normalizedData.unmatchedOcr.map(u => [
                  u.drawingNumber,
                  u.extractedText,
                  u.confidence != null ? `${Math.round(u.confidence * 100)}%` : '—',
                  u.bboxXPct != null && u.bboxYPct != null ? `${u.bboxXPct}, ${u.bboxYPct}` : '—',
                ])}
              />
            )}
            {section === 'gaps' && (
              <PreviewTable
                empty={`No ${entityTab.label.toLowerCase()} linked on these P&IDs are missing from OCR.`}
                columns={showContext
                  ? ['Drawing', 'System', 'Tag', 'Type', 'Note']
                  : ['Drawing', 'System', 'Line #', 'Note']
                }
                rows={normalizedData.registerNotInOcr.map(r => {
                  const base = [r.drawingNumber, r.systemCode || '—', r.registerTag];
                  if (showContext) base.push(r.contextValue || '—');
                  base.push(r.hint);
                  return base;
                })}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Shared table component ─────────────────────────────────────────────

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
