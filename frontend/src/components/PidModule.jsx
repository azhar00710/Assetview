import { useState, useMemo, useCallback } from 'react';
import { STC, COL, M3 } from '../data/constants';
import { usePidModulePnids, usePidModuleStats, usePnidDetail, useGenerateAnnotations, useBulkGenerateAnnotations } from '../hooks/usePidModule';
import { useDetectOcrFiles, useImportOcrFiles } from '../hooks/useOcrPipelineV2';

const ANNOTATION_STATUS_CONFIG = {
  not_annotated: { label: 'Not Annotated', color: '#899490', bg: '#89949020' },
  in_progress: { label: 'In Progress', color: '#FFD666', bg: '#FFD66620' },
  annotated: { label: 'Annotated', color: '#4FE2B0', bg: '#4FE2B020' },
  verified: { label: 'Verified', color: '#8AB4FF', bg: '#8AB4FF20' },
};

const OCR_STATUS_CONFIG = {
  pending: { label: 'Pending', color: '#899490', bg: '#89949020' },
  processing: { label: 'Processing', color: '#FFD666', bg: '#FFD66620' },
  completed: { label: 'Completed', color: '#4FE2B0', bg: '#4FE2B020' },
  failed: { label: 'Failed', color: '#FF897A', bg: '#FF897A20' },
};

export default function PidModule({ platformId, onClose, onViewPnid }) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAnnotation, setFilterAnnotation] = useState('');
  const [filterOcr, setFilterOcr] = useState('');
  const [sortCol, setSortCol] = useState('drawingNumber');
  const [sortDir, setSortDir] = useState('asc');
  const [selectedPnid, setSelectedPnid] = useState(null);
  const [showOcrDetect, setShowOcrDetect] = useState(false);

  // Bulk selection state
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [showBulkProgress, setShowBulkProgress] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const filters = useMemo(() => ({
    status: filterStatus || undefined,
    annotationStatus: filterAnnotation || undefined,
    ocrStatus: filterOcr || undefined,
    search: search || undefined,
  }), [filterStatus, filterAnnotation, filterOcr, search]);

  const { data: pnids, isLoading, refetch: refetchPnids } = usePidModulePnids(platformId, filters);
  const { data: stats, refetch: refetchStats } = usePidModuleStats(platformId);
  const { data: detectData, isLoading: detecting, refetch: runDetect } = useDetectOcrFiles(platformId);
  const importOcr = useImportOcrFiles();
  const generateAnnotations = useGenerateAnnotations(platformId);
  const bulkGenerate = useBulkGenerateAnnotations(platformId);

  const toggleCheck = useCallback((id, e) => {
    e.stopPropagation();
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!sorted.length) return;
    setCheckedIds(prev => prev.size === sorted.length ? new Set() : new Set(sorted.map(p => p.id)));
  }, []);

  const selectOcrCompleted = useCallback(() => {
    if (!sorted.length) return;
    setCheckedIds(new Set(sorted.filter(p => p.ocrStatus === 'completed').map(p => p.id)));
  }, []);

  const handleBulkGenerate = useCallback(() => {
    if (checkedIds.size === 0) return;
    setShowBulkProgress(true);
    setBulkResult(null);
    bulkGenerate.mutate(
      { pnidIds: [...checkedIds] },
      {
        onSuccess: (data) => {
          setBulkResult(data);
          setCheckedIds(new Set());
          refetchPnids();
          refetchStats();
        },
        onSettled: () => setShowBulkProgress(false),
      }
    );
  }, [checkedIds, bulkGenerate, refetchPnids, refetchStats]);

  const sorted = useMemo(() => {
    if (!pnids) return [];
    return [...pnids].sort((a, b) => {
      let va = a[sortCol] ?? '';
      let vb = b[sortCol] ?? '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [pnids, sortCol, sortDir]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span className="material-symbols-outlined text-[14px] opacity-30">unfold_more</span>;
    return <span className="material-symbols-outlined text-[14px]">{sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>;
  };

  return (
    <div className="flex flex-col h-full bg-md-surface text-md-on-surface">
      {/* Header */}
      <div className="flex items-center px-4 h-14 bg-md-surface-container shadow-md-1 gap-3 shrink-0 z-10">
        <button onClick={onClose} className="md-icon-btn w-8 h-8" title="Back to main view">
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </button>
        <span className="material-symbols-outlined text-[24px]" style={{ color: COL.pnids }}>description</span>
        <div className="flex flex-col leading-none">
          <span className="text-title-sm text-md-on-surface font-bold">P&ID Module</span>
          <span className="text-label-sm text-md-on-surface-variant">Annotation & OCR Pipeline</span>
        </div>

        <div className="w-px h-6 bg-md-outline-variant mx-2" />

        {/* Stats pills */}
        {stats && (
          <div className="flex gap-2 items-center">
            <StatPill label="Total" value={stats.total} color={COL.pnids} />
            <StatPill label="Annotated" value={stats.annotationStats?.annotated || 0} color="#4FE2B0" />
            <StatPill label="Verified" value={stats.annotationStats?.verified || 0} color="#8AB4FF" />
            <StatPill label="OCR Done" value={stats.ocrStats?.completed || 0} color="#4FE2B0" />
            {stats.ocrStats?.failed > 0 && (
              <StatPill label="OCR Failed" value={stats.ocrStats.failed} color="#FF897A" />
            )}
          </div>
        )}

        <div className="w-px h-6 bg-md-outline-variant mx-1" />

        {/* Scan Storage for OCR button */}
        <button
          onClick={() => { setShowOcrDetect(true); runDetect(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-bold transition-all hover:scale-[1.02]"
          style={{ background: '#F39C1220', color: '#F39C12', border: '1px solid #F39C1240' }}
          title="Scan storage for existing OCR output files"
        >
          <span className="material-symbols-outlined text-[16px]">manage_search</span>
          Scan for OCR Files
        </button>

        {/* Bulk Generate Annotations */}
        {checkedIds.size > 0 && (
          <button
            onClick={handleBulkGenerate}
            disabled={bulkGenerate.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-bold transition-all hover:scale-[1.02]"
            style={{ background: `${M3.primary}20`, color: M3.primary, border: `1px solid ${M3.primary}40` }}
            title="Generate annotations for selected P&IDs"
          >
            <span className={`material-symbols-outlined text-[16px] ${bulkGenerate.isPending ? 'animate-spin' : ''}`}>
              {bulkGenerate.isPending ? 'progress_activity' : 'auto_fix_high'}
            </span>
            {bulkGenerate.isPending ? 'Generating...' : `Generate Annotations (${checkedIds.size})`}
          </button>
        )}

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-md-on-surface-variant text-[18px]">search</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search P&IDs..."
            className="md-input pl-10 pr-3 w-56 text-body-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-md-on-surface-variant hover:text-md-error text-body-sm cursor-pointer">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-md-surface-container-high border-b border-md-outline-variant/30 shrink-0">
        <span className="text-label-sm text-md-on-surface-variant">Filters:</span>
        <FilterSelect label="Status" value={filterStatus} onChange={setFilterStatus}
          options={[
            { value: '', label: 'All Statuses' },
            { value: 'draft', label: 'Draft' },
            { value: 'approved', label: 'Approved' },
            { value: 'as_built', label: 'As Built' },
          ]}
        />
        <FilterSelect label="Annotation" value={filterAnnotation} onChange={setFilterAnnotation}
          options={[
            { value: '', label: 'All' },
            { value: 'not_annotated', label: 'Not Annotated' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'annotated', label: 'Annotated' },
            { value: 'verified', label: 'Verified' },
          ]}
        />
        <FilterSelect label="OCR" value={filterOcr} onChange={setFilterOcr}
          options={[
            { value: '', label: 'All' },
            { value: 'pending', label: 'Pending' },
            { value: 'processing', label: 'Processing' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
        <div className="w-px h-5 bg-md-outline-variant/30" />
        <button onClick={() => setCheckedIds(prev => prev.size === sorted.length ? new Set() : new Set(sorted.map(p => p.id)))}
          className="text-label-sm px-2 py-1 rounded hover:bg-md-surface-container transition-colors text-md-on-surface-variant">
          {checkedIds.size === sorted.length && sorted.length > 0 ? 'Deselect All' : 'Select All'}
        </button>
        <button onClick={() => setCheckedIds(new Set(sorted.filter(p => p.ocrStatus === 'completed').map(p => p.id)))}
          className="text-label-sm px-2 py-1 rounded hover:bg-md-surface-container transition-colors text-md-on-surface-variant">
          Select OCR Completed
        </button>
        {checkedIds.size > 0 && (
          <button onClick={() => setCheckedIds(new Set())}
            className="text-label-sm px-2 py-1 rounded hover:bg-md-surface-container transition-colors text-md-error">
            Clear ({checkedIds.size})
          </button>
        )}
        <div className="flex-1" />
        <span className="text-label-sm text-md-on-surface-variant">
          {sorted.length} {sorted.length === 1 ? 'record' : 'records'}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-body-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-md-surface-container-high border-b border-md-outline-variant/50">
              <th className="px-2 py-2.5 w-8">
                <input type="checkbox"
                  checked={sorted.length > 0 && checkedIds.size === sorted.length}
                  onChange={() => setCheckedIds(prev => prev.size === sorted.length ? new Set() : new Set(sorted.map(p => p.id)))}
                  className="accent-md-primary w-3.5 h-3.5 cursor-pointer"
                />
              </th>
              <SortHeader col="drawingNumber" label="DRAWING NO" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="title" label="TITLE" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="revision" label="REV" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="status" label="STATUS" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="primarySystemCode" label="PRIM SYS" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="lineCount" label="LINES" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="equipmentCount" label="EQUIP" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="annotationStatus" label="ANNOTATION" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="totalAnnotations" label="ANN COUNT" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="ocrStatus" label="OCR STATUS" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="hasImage" label="FILE" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <th className="px-3 py-2.5 text-label-sm font-bold text-left" style={{ color: COL.pnids }}>RAW FILE</th>
              <th className="px-3 py-2.5 text-label-sm font-bold text-left" style={{ color: COL.pnids }}>CLEANED FILE</th>
              <th className="px-3 py-2.5 text-label-sm font-bold text-center" style={{ color: COL.pnids }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={15} className="text-center py-12 text-md-on-surface-variant">Loading P&IDs...</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={15} className="text-center py-12 text-md-on-surface-variant">No P&IDs found</td></tr>
            ) : sorted.map(p => (
              <tr
                key={p.id}
                className={`border-b border-md-outline-variant/20 hover:bg-md-surface-container transition-colors cursor-pointer ${selectedPnid === p.id ? 'bg-md-surface-container' : ''} ${checkedIds.has(p.id) ? 'bg-md-primary/5' : ''}`}
                onClick={() => setSelectedPnid(selectedPnid === p.id ? null : p.id)}
              >
                <td className="px-2 py-2.5 w-8" onClick={e => e.stopPropagation()}>
                  <input type="checkbox"
                    checked={checkedIds.has(p.id)}
                    onChange={(e) => toggleCheck(p.id, e)}
                    className="accent-md-primary w-3.5 h-3.5 cursor-pointer"
                  />
                </td>
                <td className="px-3 py-2.5 font-mono text-label-sm whitespace-nowrap">{p.drawingNumber}</td>
                <td className="px-3 py-2.5 max-w-[200px] truncate">{p.title}</td>
                <td className="px-3 py-2.5 text-center">{p.revision || '0'}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={p.status} config={STC} />
                </td>
                <td className="px-3 py-2.5 font-medium" style={{ color: COL.systems }}>{p.primarySystemCode || '-'}</td>
                <td className="px-3 py-2.5 text-center">{p.lineCount}</td>
                <td className="px-3 py-2.5 text-center">{p.equipmentCount}</td>
                <td className="px-3 py-2.5">
                  <AnnotationBadge status={p.annotationStatus} />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className="font-medium">{p.approvedAnnotations}</span>
                  <span className="text-md-on-surface-variant">/{p.totalAnnotations}</span>
                </td>
                <td className="px-3 py-2.5">
                  <OcrBadge status={p.ocrStatus} />
                </td>
                <td className="px-3 py-2.5">
                  {p.fileUrl ? (
                    <a
                      href={p.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-label-sm font-medium hover:bg-md-primary/20 transition-colors"
                      style={{ color: '#4FE2B0' }}
                      title={p.storageKey || 'Open file'}
                    >
                      <span className="material-symbols-outlined text-[14px]">link</span>
                      View
                    </a>
                  ) : (
                    <span className="text-md-on-surface-variant text-label-sm">-</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <FileIndicator available={p.hasOcrRaw} label="Raw" />
                </td>
                <td className="px-3 py-2.5">
                  <FileIndicator available={p.hasOcrCleaned} label="Cleaned" />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); onViewPnid({ id: p.id, drawingNumber: p.drawingNumber, title: p.title }); }}
                      className="px-2 py-1 rounded text-label-sm font-semibold hover:bg-md-primary/20 transition-colors"
                      style={{ color: COL.pnids }}
                      title="Open P&ID Viewer"
                    >
                      <span className="material-symbols-outlined text-[16px]">visibility</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail panel (when a row is selected) */}
      {selectedPnid && sorted.find(p => p.id === selectedPnid) && (
        <PnidDetailPanel
          pnid={sorted.find(p => p.id === selectedPnid)}
          pnidId={selectedPnid}
          platformId={platformId}
          onViewPnid={onViewPnid}
        />
      )}

      {/* Bulk result banner */}
      {bulkResult && (
        <BulkResultBanner result={bulkResult} onDismiss={() => setBulkResult(null)} />
      )}

      {/* OCR Detection Panel (overlay) */}
      {showOcrDetect && (
        <OcrDetectPanel
          detecting={detecting}
          detectData={detectData}
          onRescan={runDetect}
          onImport={(files) => {
            importOcr.mutate(
              { platformId, files },
              {
                onSuccess: () => {
                  runDetect();
                  refetchPnids();
                  refetchStats();
                },
              }
            );
          }}
          importing={importOcr.isPending}
          importResult={importOcr.data}
          onClose={() => setShowOcrDetect(false)}
        />
      )}
    </div>
  );
}

function OcrDetectPanel({ detecting, detectData, onRescan, onImport, importing, importResult, onClose }) {
  const readyFiles = detectData?.detected?.filter(d => d.pnidId && !d.alreadyImported) || [];
  const alreadyDone = detectData?.detected?.filter(d => d.alreadyImported) || [];
  const unmatched = detectData?.detected?.filter(d => !d.pnidId) || [];

  const handleImportAll = () => {
    const files = readyFiles.map(d => ({ pnidId: d.pnidId, ocrOutputKey: d.ocrOutputKey }));
    if (files.length > 0) onImport(files);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-md-surface-container rounded-md-xl shadow-md-3 w-[720px] max-h-[80vh] flex flex-col overflow-hidden border border-md-outline-variant/30">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-md-outline-variant/30">
          <span className="material-symbols-outlined text-[24px]" style={{ color: '#F39C12' }}>manage_search</span>
          <div className="flex flex-col leading-tight">
            <span className="text-title-sm font-bold text-md-on-surface">OCR File Detection</span>
            <span className="text-label-sm text-md-on-surface-variant">Scan storage for previously generated OCR output files</span>
          </div>
          <div className="flex-1" />
          <button onClick={onRescan} disabled={detecting} className="md-icon-btn w-8 h-8" title="Rescan">
            <span className={`material-symbols-outlined text-[18px] ${detecting ? 'animate-spin' : ''}`}>refresh</span>
          </button>
          <button onClick={onClose} className="md-icon-btn w-8 h-8">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {detecting ? (
            <div className="flex flex-col items-center justify-center py-16 text-md-on-surface-variant">
              <span className="material-symbols-outlined animate-spin text-[32px] mb-3" style={{ color: '#F39C12' }}>progress_activity</span>
              <span className="text-body-md font-medium">Scanning storage for OCR files...</span>
              <span className="text-body-sm opacity-60 mt-1">Checking each P&ID for _ocr_output.json companion files</span>
            </div>
          ) : !detectData ? (
            <div className="text-center py-16 text-md-on-surface-variant">
              <span className="text-body-md">Click scan to detect OCR files in storage</span>
            </div>
          ) : (
            <>
              {/* Summary stats */}
              <div className="flex gap-3 mb-4">
                <div className="flex-1 rounded-md-lg p-3 border border-md-outline-variant/20" style={{ background: '#F39C1210' }}>
                  <div className="text-[28px] font-bold" style={{ color: '#F39C12' }}>{detectData.totalOcrFiles}</div>
                  <div className="text-label-sm text-md-on-surface-variant">OCR Files Found</div>
                </div>
                <div className="flex-1 rounded-md-lg p-3 border border-md-outline-variant/20" style={{ background: '#3BE49410' }}>
                  <div className="text-[28px] font-bold" style={{ color: '#3BE494' }}>{detectData.matchedToPnids}</div>
                  <div className="text-label-sm text-md-on-surface-variant">Matched to P&IDs</div>
                </div>
                <div className="flex-1 rounded-md-lg p-3 border border-md-outline-variant/20" style={{ background: '#2D33E010' }}>
                  <div className="text-[28px] font-bold" style={{ color: '#2D33E0' }}>{detectData.readyToImport}</div>
                  <div className="text-label-sm text-md-on-surface-variant">Ready to Import</div>
                </div>
                <div className="flex-1 rounded-md-lg p-3 border border-md-outline-variant/20" style={{ background: '#89949010' }}>
                  <div className="text-[28px] font-bold text-md-on-surface-variant">{detectData.alreadyImported}</div>
                  <div className="text-label-sm text-md-on-surface-variant">Already Imported</div>
                </div>
              </div>

              {/* Import result banner */}
              {importResult && (
                <div className="mb-4 px-4 py-3 rounded-md-lg border" style={{
                  background: importResult.failed > 0 ? '#FF897A15' : '#3BE49415',
                  borderColor: importResult.failed > 0 ? '#FF897A40' : '#3BE49440',
                }}>
                  <span className="text-body-sm font-semibold" style={{ color: importResult.failed > 0 ? '#FF897A' : '#3BE494' }}>
                    Imported {importResult.imported} file{importResult.imported !== 1 ? 's' : ''}
                    {importResult.failed > 0 && `, ${importResult.failed} failed`}
                  </span>
                </div>
              )}

              {/* Ready to import */}
              {readyFiles.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-label-sm font-bold text-md-on-surface-variant uppercase">Ready to Import ({readyFiles.length})</span>
                    <button
                      onClick={handleImportAll}
                      disabled={importing}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-md-full text-label-md font-bold transition-all"
                      style={{ background: '#3BE49420', color: '#3BE494' }}
                    >
                      <span className="material-symbols-outlined text-[16px]">{importing ? 'progress_activity' : 'download'}</span>
                      {importing ? 'Importing...' : `Import All (${readyFiles.length})`}
                    </button>
                  </div>
                  <div className="space-y-1">
                    {readyFiles.map(d => (
                      <OcrFileRow key={d.ocrOutputKey} item={d} status="ready" />
                    ))}
                  </div>
                </div>
              )}

              {/* Already imported */}
              {alreadyDone.length > 0 && (
                <div className="mb-4">
                  <span className="text-label-sm font-bold text-md-on-surface-variant uppercase">Already Imported ({alreadyDone.length})</span>
                  <div className="space-y-1 mt-2 opacity-60">
                    {alreadyDone.map(d => (
                      <OcrFileRow key={d.ocrOutputKey} item={d} status="done" />
                    ))}
                  </div>
                </div>
              )}

              {/* Unmatched */}
              {unmatched.length > 0 && (
                <div className="mb-4">
                  <span className="text-label-sm font-bold text-md-on-surface-variant uppercase">Unmatched OCR Files ({unmatched.length})</span>
                  <p className="text-body-sm text-md-on-surface-variant opacity-60 mb-2">These OCR files don't match any P&ID in the database</p>
                  <div className="space-y-1 mt-2 opacity-50">
                    {unmatched.map(d => (
                      <OcrFileRow key={d.ocrOutputKey} item={d} status="unmatched" />
                    ))}
                  </div>
                </div>
              )}

              {/* Export files */}
              {detectData.exportFiles?.length > 0 && (
                <div className="mb-4">
                  <span className="text-label-sm font-bold text-md-on-surface-variant uppercase">Export Files in Storage ({detectData.exportFiles.length})</span>
                  <div className="space-y-1 mt-2">
                    {detectData.exportFiles.map(f => (
                      <div key={f.key} className="flex items-center gap-2 px-3 py-2 rounded-md-lg bg-md-surface-container-high/30 text-body-sm">
                        <span className="material-symbols-outlined text-[16px] text-md-on-surface-variant">archive</span>
                        <span className="font-mono text-md-on-surface">{f.filename}</span>
                        <span className="text-md-on-surface-variant ml-auto">{f.updated ? new Date(f.updated).toLocaleDateString() : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detectData.totalOcrFiles === 0 && (
                <div className="text-center py-12 text-md-on-surface-variant">
                  <span className="material-symbols-outlined text-[40px] opacity-30 mb-2 block">search_off</span>
                  <span className="text-body-md">No OCR output files found in storage</span>
                  <p className="text-body-sm opacity-60 mt-1">Run the OCR pipeline first to generate output files</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OcrFileRow({ item, status }) {
  const statusConfig = {
    ready: { icon: 'download', color: '#3BE494', label: 'Ready' },
    done: { icon: 'check_circle', color: '#899490', label: 'Imported' },
    unmatched: { icon: 'help_outline', color: '#FF897A', label: 'No match' },
  };
  const cfg = statusConfig[status];

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md-lg bg-md-surface-container-high/30 text-body-sm">
      <span className="material-symbols-outlined text-[16px]" style={{ color: cfg.color }}>{cfg.icon}</span>
      <span className="font-semibold text-md-on-surface min-w-[160px]">{item.drawingNumber || '—'}</span>
      {item.ocrMeta && (
        <span className="text-md-on-surface-variant text-[11px]">
          {item.ocrMeta.wordCount} words · {item.ocrMeta.classifiedCount} tags · {item.ocrMeta.matchedCount} matched
        </span>
      )}
      {item.ocrMeta?.extractedAt && (
        <span className="text-md-on-surface-variant text-[11px] ml-auto">
          {new Date(item.ocrMeta.extractedAt).toLocaleDateString()}
        </span>
      )}
      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold ml-1" style={{ background: `${cfg.color}15`, color: cfg.color }}>
        {cfg.label}
      </span>
    </div>
  );
}

function PnidDetailPanel({ pnid, pnidId, platformId, onViewPnid }) {
  const { data: detail, isLoading: detailLoading } = usePnidDetail(pnidId);
  const generateAnnotations = useGenerateAnnotations(platformId);
  const [activeTab, setActiveTab] = useState('equipment');
  const [genResult, setGenResult] = useState(null);

  const handleGenerate = () => {
    setGenResult(null);
    generateAnnotations.mutate(
      { pnidId },
      { onSuccess: (data) => setGenResult(data) }
    );
  };

  const ENTITY_TABS = [
    { key: 'equipment', label: 'Equipment', color: M3.primary, icon: 'precision_manufacturing' },
    { key: 'instruments', label: 'Instruments', color: M3.secondary, icon: 'sensors' },
    { key: 'lines', label: 'Lines', color: M3.tertiary, icon: 'route' },
  ];

  return (
    <div className="bg-md-surface-container-high border-t border-md-outline-variant shrink-0 animate-md-detail-enter max-h-[45vh] overflow-auto">
      {/* Header row */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-md-outline-variant/20">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-title-sm font-bold" style={{ color: COL.pnids }}>{pnid.drawingNumber}</span>
          <span className="text-body-sm text-md-on-surface-variant truncate">{pnid.title}</span>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          <DetailItem label="Rev" value={pnid.revision || '0'} />
          <DetailItem label="Sheet" value={`${pnid.sheetNumber || 1}/${pnid.totalSheets || 1}`} />
          <AnnotationBadge status={pnid.annotationStatus} />
          <OcrBadge status={pnid.ocrStatus} />
        </div>
        <div className="flex gap-2 items-center ml-auto">
          {/* Generate annotations button */}
          {(pnid.ocrStatus === 'completed' || pnid.hasOcrRaw || pnid.hasOcrCleaned) && (
            <button
              onClick={handleGenerate}
              disabled={generateAnnotations.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-bold transition-all hover:scale-[1.02]"
              style={{ background: `${M3.primary}20`, color: M3.primary, border: `1px solid ${M3.primary}40` }}
              title="Generate annotations from OCR bounding boxes"
            >
              <span className={`material-symbols-outlined text-[16px] ${generateAnnotations.isPending ? 'animate-spin' : ''}`}>
                {generateAnnotations.isPending ? 'progress_activity' : 'auto_fix_high'}
              </span>
              {generateAnnotations.isPending ? 'Generating...' : 'Generate Annotations'}
            </button>
          )}
          <button
            onClick={() => onViewPnid({ id: pnid.id, drawingNumber: pnid.drawingNumber, title: pnid.title })}
            className="md-filter-chip"
            style={{ borderColor: COL.pnids, color: COL.pnids }}
          >
            <span className="material-symbols-outlined text-[16px]">visibility</span>
            View P&ID
          </button>
        </div>
      </div>

      {/* Generation result banner */}
      {genResult && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-md-lg border text-body-sm" style={{
          background: genResult.errors > 0 ? '#FF897A15' : '#4FE2B015',
          borderColor: genResult.errors > 0 ? '#FF897A40' : '#4FE2B040',
        }}>
          <span className="font-semibold" style={{ color: genResult.errors > 0 ? M3.error : M3.primary }}>
            {genResult.annotated} annotated, {genResult.skipped} skipped, {genResult.errors} errors
          </span>
          <span className="text-md-on-surface-variant ml-2">
            (Equipment: {genResult.byType?.equipment || 0}, Instruments: {genResult.byType?.instrument || 0}, Lines: {genResult.byType?.line || 0})
          </span>
          {genResult.message && (
            <div className="mt-1 text-[11px] text-md-on-surface-variant">{genResult.message}</div>
          )}
        </div>
      )}

      {detailLoading ? (
        <div className="flex items-center justify-center py-8 text-md-on-surface-variant">
          <span className="material-symbols-outlined animate-spin text-[20px] mr-2">progress_activity</span>
          Loading details...
        </div>
      ) : detail ? (
        <div className="px-4 py-3">
          {/* Systems + File refs + Annotation summary */}
          <div className="flex gap-6 mb-3">
            {/* Systems */}
            <div className="flex flex-col gap-1">
              <span className="text-label-sm text-md-on-surface-variant font-bold uppercase">Systems</span>
              <div className="flex gap-1.5 flex-wrap">
                {detail.systems?.map(s => (
                  <span key={s.id} className="text-label-sm px-1.5 py-0.5 rounded-md-full font-medium"
                    style={{
                      background: s.isPrimary ? `${M3.primary}20` : `${M3.outline}15`,
                      color: s.isPrimary ? M3.primary : M3.onSurfaceVariant,
                      border: s.isPrimary ? `1px solid ${M3.primary}40` : '1px solid transparent',
                    }}>
                    {s.code}{s.isPrimary ? ' (primary)' : ''}
                  </span>
                ))}
                {(!detail.systems || detail.systems.length === 0) && (
                  <span className="text-label-sm text-md-on-surface-variant opacity-50">No systems linked</span>
                )}
              </div>
            </div>

            {/* File references */}
            <div className="flex flex-col gap-1">
              <span className="text-label-sm text-md-on-surface-variant font-bold uppercase">Files</span>
              <div className="flex gap-2">
                {detail.pnid?.fileUrl && (
                  <a href={detail.pnid.fileUrl} target="_blank" rel="noopener noreferrer"
                    className="text-label-sm px-1.5 py-0.5 rounded flex items-center gap-1 hover:bg-md-primary/10"
                    style={{ color: M3.primary }}>
                    <span className="material-symbols-outlined text-[14px]">description</span>P&ID
                  </a>
                )}
                {detail.pnid?.ocrRawStorageKey && (
                  <span className="text-label-sm px-1.5 py-0.5 rounded flex items-center gap-1" style={{ color: M3.tertiary }}>
                    <span className="material-symbols-outlined text-[14px]">data_object</span>OCR Raw
                  </span>
                )}
                {detail.pnid?.ocrCleanedStorageKey && (
                  <span className="text-label-sm px-1.5 py-0.5 rounded flex items-center gap-1" style={{ color: M3.secondary }}>
                    <span className="material-symbols-outlined text-[14px]">data_object</span>OCR Cleaned
                  </span>
                )}
              </div>
            </div>

            {/* Annotation summary */}
            <div className="flex flex-col gap-1">
              <span className="text-label-sm text-md-on-surface-variant font-bold uppercase">Annotations</span>
              <div className="flex gap-2 items-center">
                <span className="text-body-sm font-bold" style={{ color: M3.primary }}>{detail.annotationSummary?.approved || 0}</span>
                <span className="text-body-sm text-md-on-surface-variant">approved</span>
                <span className="text-md-on-surface-variant">/</span>
                <span className="text-body-sm font-bold" style={{ color: M3.tertiary }}>{detail.annotationSummary?.draft || 0}</span>
                <span className="text-body-sm text-md-on-surface-variant">draft</span>
                <span className="text-md-on-surface-variant">/</span>
                <span className="text-body-sm font-medium text-md-on-surface">{detail.annotationSummary?.total || 0}</span>
                <span className="text-body-sm text-md-on-surface-variant">total</span>
              </div>
            </div>
          </div>

          {/* Entity tabs */}
          <div className="flex gap-1 mb-2 border-b border-md-outline-variant/20">
            {ENTITY_TABS.map(tab => (
              <button key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-label-sm font-bold transition-colors rounded-t-md-sm"
                style={{
                  color: activeTab === tab.key ? tab.color : M3.onSurfaceVariant,
                  borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : '2px solid transparent',
                  background: activeTab === tab.key ? `${tab.color}08` : 'transparent',
                }}>
                <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                {tab.label}
                <span className="text-[11px] opacity-70">
                  ({(activeTab === 'equipment' && tab.key === 'equipment' ? detail.equipment?.length :
                     tab.key === 'instruments' ? detail.instruments?.length :
                     tab.key === 'lines' ? detail.lines?.length : 0) || 0})
                </span>
              </button>
            ))}
          </div>

          {/* Entity table */}
          <div className="max-h-[200px] overflow-auto rounded-md-sm border border-md-outline-variant/15">
            {activeTab === 'equipment' && (
              <table className="w-full text-body-sm">
                <thead className="sticky top-0 bg-md-surface-container">
                  <tr className="text-label-sm text-md-on-surface-variant">
                    <th className="px-2 py-1.5 text-left">Tag</th>
                    <th className="px-2 py-1.5 text-left">Type</th>
                    <th className="px-2 py-1.5 text-left">Description</th>
                    <th className="px-2 py-1.5 text-left">System</th>
                    <th className="px-2 py-1.5 text-center">Criticality</th>
                    <th className="px-2 py-1.5 text-center">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.equipment || []).map(e => (
                    <tr key={e.id} className="border-t border-md-outline-variant/10 hover:bg-md-surface-container/50">
                      <td className="px-2 py-1.5 font-mono font-medium" style={{ color: M3.primary }}>{e.tag}</td>
                      <td className="px-2 py-1.5">{e.type}</td>
                      <td className="px-2 py-1.5 max-w-[200px] truncate text-md-on-surface-variant">{e.description || '-'}</td>
                      <td className="px-2 py-1.5" style={{ color: COL.systems }}>{e.systemCode || '-'}</td>
                      <td className="px-2 py-1.5 text-center">
                        {e.criticality && <CritBadge level={e.criticality} />}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <PositionIcon verified={e.positionVerified} hasPosition={e.hasPosition} />
                      </td>
                    </tr>
                  ))}
                  {(!detail.equipment || detail.equipment.length === 0) && (
                    <tr><td colSpan={6} className="text-center py-4 text-md-on-surface-variant opacity-50">No equipment</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'instruments' && (
              <table className="w-full text-body-sm">
                <thead className="sticky top-0 bg-md-surface-container">
                  <tr className="text-label-sm text-md-on-surface-variant">
                    <th className="px-2 py-1.5 text-left">Tag</th>
                    <th className="px-2 py-1.5 text-left">Type</th>
                    <th className="px-2 py-1.5 text-left">Description</th>
                    <th className="px-2 py-1.5 text-left">Range</th>
                    <th className="px-2 py-1.5 text-left">SCADA</th>
                    <th className="px-2 py-1.5 text-left">System</th>
                    <th className="px-2 py-1.5 text-center">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.instruments || []).map(i => (
                    <tr key={i.id} className="border-t border-md-outline-variant/10 hover:bg-md-surface-container/50">
                      <td className="px-2 py-1.5 font-mono font-medium" style={{ color: M3.secondary }}>{i.tag}</td>
                      <td className="px-2 py-1.5">{i.type}</td>
                      <td className="px-2 py-1.5 max-w-[160px] truncate text-md-on-surface-variant">{i.description || '-'}</td>
                      <td className="px-2 py-1.5 text-md-on-surface-variant">
                        {i.rangeMin != null && i.rangeMax != null ? `${i.rangeMin}–${i.rangeMax}` : '-'}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[11px]">{i.scadaTag || '-'}</td>
                      <td className="px-2 py-1.5" style={{ color: COL.systems }}>{i.systemCode || '-'}</td>
                      <td className="px-2 py-1.5 text-center">
                        <PositionIcon verified={i.positionVerified} hasPosition={i.hasPosition} />
                      </td>
                    </tr>
                  ))}
                  {(!detail.instruments || detail.instruments.length === 0) && (
                    <tr><td colSpan={7} className="text-center py-4 text-md-on-surface-variant opacity-50">No instruments</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'lines' && (
              <table className="w-full text-body-sm">
                <thead className="sticky top-0 bg-md-surface-container">
                  <tr className="text-label-sm text-md-on-surface-variant">
                    <th className="px-2 py-1.5 text-left">Line Number</th>
                    <th className="px-2 py-1.5 text-left">Service</th>
                    <th className="px-2 py-1.5 text-left">Size</th>
                    <th className="px-2 py-1.5 text-left">System</th>
                    <th className="px-2 py-1.5 text-center">Continuation</th>
                    <th className="px-2 py-1.5 text-center">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.lines || []).map(l => (
                    <tr key={l.id} className="border-t border-md-outline-variant/10 hover:bg-md-surface-container/50">
                      <td className="px-2 py-1.5 font-mono font-medium" style={{ color: M3.tertiary }}>{l.lineNumber}</td>
                      <td className="px-2 py-1.5">{l.service || '-'}</td>
                      <td className="px-2 py-1.5">{l.nominalSize || '-'}</td>
                      <td className="px-2 py-1.5" style={{ color: COL.systems }}>{l.systemCode || '-'}</td>
                      <td className="px-2 py-1.5 text-center">
                        {l.isContinuation && (
                          <span className="material-symbols-outlined text-[14px]" style={{ color: M3.tertiary }}>call_split</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <PositionIcon hasPosition={l.hasPosition} />
                      </td>
                    </tr>
                  ))}
                  {(!detail.lines || detail.lines.length === 0) && (
                    <tr><td colSpan={6} className="text-center py-4 text-md-on-surface-variant opacity-50">No lines</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PositionIcon({ verified, hasPosition }) {
  if (!hasPosition) return <span className="material-symbols-outlined text-[14px] text-md-on-surface-variant opacity-30">radio_button_unchecked</span>;
  if (verified) return <span className="material-symbols-outlined text-[14px]" style={{ color: M3.primary }}>check_circle</span>;
  return <span className="material-symbols-outlined text-[14px]" style={{ color: M3.warning }}>pending</span>;
}

function CritBadge({ level }) {
  const colors = { high: '#FF897A', medium: '#FFD666', low: '#4FE2B0' };
  const c = colors[level] || M3.outline;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-md-full font-semibold" style={{ background: `${c}20`, color: c }}>
      {level}
    </span>
  );
}

function BulkResultBanner({ result, onDismiss }) {
  return (
    <div className="mx-4 my-2 px-4 py-3 rounded-md-lg border flex items-start gap-3" style={{
      background: result.failed > 0 ? '#FF897A10' : '#4FE2B010',
      borderColor: result.failed > 0 ? '#FF897A30' : '#4FE2B030',
    }}>
      <span className="material-symbols-outlined text-[20px] mt-0.5" style={{ color: result.failed > 0 ? M3.error : M3.primary }}>
        {result.failed > 0 ? 'warning' : 'check_circle'}
      </span>
      <div className="flex-1">
        <div className="text-body-sm font-bold" style={{ color: result.failed > 0 ? M3.error : M3.primary }}>
          Bulk Generation Complete — {result.completed}/{result.total} succeeded
        </div>
        <div className="text-label-sm text-md-on-surface-variant mt-1">
          Total: {result.summary?.totalAnnotated || 0} annotated, {result.summary?.totalSkipped || 0} skipped, {result.summary?.totalErrors || 0} errors
          {result.summary?.byType && (
            <span className="ml-2">
              (Equipment: {result.summary.byType.equipment}, Instruments: {result.summary.byType.instrument}, Lines: {result.summary.byType.line})
            </span>
          )}
        </div>
        {result.results?.filter(r => r.errors > 0).length > 0 && (
          <div className="mt-1 text-label-sm" style={{ color: M3.error }}>
            Failed: {result.results.filter(r => r.errors > 0).map(r => r.drawingNumber).join(', ')}
          </div>
        )}
      </div>
      <button onClick={onDismiss} className="md-icon-btn w-6 h-6">
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}

function DetailItem({ label, value, color }) {
  return (
    <div className="flex flex-col">
      <span className="text-label-sm text-md-on-surface-variant">{label}</span>
      <span className="text-body-sm font-medium" style={color ? { color } : {}}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const color = STC[status] || '#899490';
  return (
    <span className="text-label-sm px-1.5 py-0.5 rounded-md-full" style={{ background: `${color}20`, color }}>
      {(status || 'draft').replace(/_/g, ' ')}
    </span>
  );
}

function AnnotationBadge({ status }) {
  const cfg = ANNOTATION_STATUS_CONFIG[status] || ANNOTATION_STATUS_CONFIG.not_annotated;
  return (
    <span className="text-label-sm px-1.5 py-0.5 rounded-md-full whitespace-nowrap" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function OcrBadge({ status }) {
  const cfg = OCR_STATUS_CONFIG[status] || OCR_STATUS_CONFIG.pending;
  return (
    <span className="text-label-sm px-1.5 py-0.5 rounded-md-full whitespace-nowrap" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function FileIndicator({ available, label }) {
  return available ? (
    <span className="flex items-center gap-1 text-label-sm" style={{ color: '#4FE2B0' }}>
      <span className="material-symbols-outlined text-[14px]">check_circle</span>
      {label}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-label-sm text-md-on-surface-variant opacity-50">
      <span className="material-symbols-outlined text-[14px]">radio_button_unchecked</span>
      None
    </span>
  );
}

function StatPill({ label, value, color }) {
  return (
    <span className="text-label-sm font-semibold px-2 py-0.5 rounded-md-full" style={{ background: `${color}20`, color }}>
      {value} {label}
    </span>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="md-input px-2 py-1.5 text-label-sm cursor-pointer w-auto"
      title={label}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function SortHeader({ col, label, sortCol, sortDir, onSort }) {
  const isActive = sortCol === col;
  return (
    <th
      className="px-3 py-2.5 text-label-sm font-bold text-left cursor-pointer select-none hover:bg-md-surface-container transition-colors whitespace-nowrap"
      style={{ color: isActive ? COL.pnids : undefined }}
      onClick={() => onSort(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        <span className="material-symbols-outlined text-[14px]" style={{ opacity: isActive ? 1 : 0.3 }}>
          {isActive ? (sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
        </span>
      </span>
    </th>
  );
}
