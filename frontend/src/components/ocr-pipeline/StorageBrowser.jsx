import { useState, useMemo, useCallback } from 'react';
import { md } from '../../lib/theme';
import {
  useStorageBrowse,
  useResetOcrStatus,
  useAvailableStorageConfigs,
  useOcrProvider,
  useAiConfig,
} from '../../hooks/useOcrPipelineV2';

const FILE_ICONS = {
  pdf: 'picture_as_pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  tif: 'image',
  tiff: 'image',
};

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function StorageBrowser({ platformId, platformCode, onRunOcr, onUseExistingOcr, onBack }) {
  const [currentPrefix, setCurrentPrefix] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [batchName, setBatchName] = useState('');
  const [batchOptions, setBatchOptions] = useState({
    storageConfigId: undefined,
    ocrProvider: undefined,
    aiModel: undefined,
  });

  const { data, isLoading, error, refetch } = useStorageBrowse(platformId, currentPrefix);
  const { data: availableStorageConfigs } = useAvailableStorageConfigs(platformId);
  const { data: currentOcrProvider } = useOcrProvider(platformId);
  const { data: aiConfig } = useAiConfig(platformId);

  const folders = data?.folders || [];
  const files = data?.files || [];

  // Filter files by search
  const filteredFiles = useMemo(() => {
    if (!searchQuery) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(f =>
      f.filename.toLowerCase().includes(q) ||
      (f.drawingNumber || '').toLowerCase().includes(q)
    );
  }, [files, searchQuery]);

  // Selection
  const toggleSelect = useCallback((key) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedKeys(new Set()), []);

  const selectAll = useCallback((onlyNew = false) => {
    const keys = filteredFiles
      .filter(f => !onlyNew || !f.ocrStatus || f.ocrStatus.status === 'failed')
      .map(f => f.key);
    setSelectedKeys(new Set(keys));
  }, [filteredFiles]);

  const selectFolder = useCallback((prefix) => {
    const folderFiles = files.filter(f => f.key.startsWith(prefix));
    setSelectedKeys(prev => {
      const next = new Set(prev);
      folderFiles.forEach(f => next.add(f.key));
      return next;
    });
  }, [files]);

  const resetOcrStatus = useResetOcrStatus();
  const processedCount = useMemo(() => filteredFiles.filter(f => f.ocrStatus && f.ocrStatus.status !== 'failed').length, [filteredFiles]);

  // Split selected files into "has existing OCR" vs "needs OCR"
  const { withOcr, withoutOcr } = useMemo(() => {
    const fileMap = new Map(files.map(f => [f.key, f]));
    const withOcr = [];
    const withoutOcr = [];
    for (const key of selectedKeys) {
      const f = fileMap.get(key);
      if (!f) continue;
      if (f.hasOcrOutputFile) withOcr.push(f);
      else withoutOcr.push(f);
    }
    return { withOcr, withoutOcr };
  }, [selectedKeys, files]);

  const handleUseExistingOcr = useCallback(() => {
    if (withOcr.length === 0 || !onUseExistingOcr) return;
    onUseExistingOcr(
      withOcr.map(f => ({ storageKey: f.key, ocrOutputKey: f.ocrOutputKey, filename: f.filename, drawingNumber: f.drawingNumber })),
      batchName || `${platformCode} — ${new Date().toLocaleDateString()} (existing OCR)`,
    );
  }, [withOcr, onUseExistingOcr, batchName, platformCode]);

  const handleResetOcr = useCallback(() => {
    if (!platformId) return;
    resetOcrStatus.mutate({ platformId }, {
      onSuccess: () => {
        refetch();
        clearSelection();
      },
    });
  }, [platformId, resetOcrStatus, refetch, clearSelection]);

  // Breadcrumb from prefix
  const breadcrumbs = useMemo(() => {
    if (!currentPrefix) return [];
    const parts = currentPrefix.replace(/\/$/, '').split('/');
    return parts.map((part, i) => ({
      label: part,
      prefix: parts.slice(0, i + 1).join('/') + '/',
    }));
  }, [currentPrefix]);

  // Handle OCR launch with batch options
  const handleRunOcr = () => {
    const keys = [...selectedKeys];
    if (keys.length === 0) return;
    onRunOcr(
      keys,
      batchName || `${platformCode} — ${new Date().toLocaleDateString()}`,
      {
        ocrProvider: batchOptions.ocrProvider || currentOcrProvider?.provider,
        storageConfigId: batchOptions.storageConfigId,
        aiModel: batchOptions.aiModel || aiConfig?.aiModel,
      }
    );
    clearSelection();
    setBatchName('');
    setBatchOptions({ storageConfigId: undefined, ocrProvider: undefined, aiModel: undefined });
  };

  // Status badge
  const statusBadge = (file) => {
    const badges = [];

    if (file.ocrStatus) {
      const s = file.ocrStatus;
      if (s.passedToAnnotation) {
        badges.push(<span key="ann" className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold">Annotated</span>);
      } else {
        const colors = { completed: 'text-blue-400 bg-blue-500/15', failed: 'text-red-400 bg-red-500/15', processing: 'text-amber-400 bg-amber-500/15', pending: 'text-gray-400 bg-gray-500/15' };
        badges.push(<span key="ocr" className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${colors[s.status] || colors.pending}`}>{s.status}</span>);
      }
    } else if (file.linkedPnid) {
      badges.push(<span key="db" className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-semibold">In DB</span>);
    } else {
      badges.push(<span key="new" className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-500/10 text-gray-500 font-semibold">New</span>);
    }

    // Show OCR file available indicator
    if (file.hasOcrOutputFile) {
      badges.push(
        <span key="ocrfile" className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#F39C1218', color: '#F39C12' }} title={`OCR output: ${file.ocrOutputKey}`}>
          OCR File
        </span>
      );
    }

    return <span className="flex items-center gap-1">{badges}</span>;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-md-outline-variant/20 bg-md-surface-container/50">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-body-sm">
          <button onClick={() => setCurrentPrefix('')} className="text-md-primary hover:underline font-semibold">
            {platformCode}
          </button>
          {breadcrumbs.map((bc, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-md-on-surface-variant">/</span>
              <button
                onClick={() => setCurrentPrefix(bc.prefix)}
                className={i === breadcrumbs.length - 1 ? 'text-md-on-surface font-semibold' : 'text-md-primary hover:underline'}
              >
                {bc.label}
              </button>
            </span>
          ))}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-md-on-surface-variant text-[16px]">search</span>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="md-input pl-8 pr-3 w-48 text-body-sm"
          />
        </div>

        <button onClick={() => refetch()} className="md-icon-btn w-8 h-8" title="Refresh">
          <span className="material-symbols-outlined text-[18px]">refresh</span>
        </button>
      </div>

      {/* Selection bar */}
      {selectedKeys.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-md-outline-variant/20" style={{ background: `${md.primary}08` }}>
          <span className="text-label-md font-bold" style={{ color: md.primary }}>
            {selectedKeys.size} file{selectedKeys.size !== 1 ? 's' : ''} selected
            {withOcr.length > 0 && withoutOcr.length > 0 && (
              <span className="text-label-sm font-normal text-md-on-surface-variant ml-1">
                ({withOcr.length} with OCR, {withoutOcr.length} new)
              </span>
            )}
          </span>

          <div className="w-px h-5 bg-md-outline-variant/30" />

          <input
            value={batchName}
            onChange={e => setBatchName(e.target.value)}
            placeholder="Batch name (optional)"
            className="md-input px-2 py-1 w-56 text-body-sm"
          />

          {/* Use Existing OCR — shown when any selected files have OCR output */}
          {withOcr.length > 0 && onUseExistingOcr && (
            <button
              onClick={handleUseExistingOcr}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md-full text-label-md font-bold transition-all"
              style={{ background: '#F39C1220', color: '#F39C12' }}
              title={`${withOcr.length} file(s) already have OCR output — skip extraction and proceed`}
            >
              <span className="material-symbols-outlined text-[16px]">bolt</span>
              Use Existing OCR ({withOcr.length})
            </button>
          )}

          {/* Run OCR — for files without existing OCR, or all if none have OCR */}
          {withoutOcr.length > 0 && (
            <button
              onClick={handleRunOcr}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md-full text-label-md font-bold transition-all"
              style={{ background: `${md.primary}20`, color: md.primary }}
            >
              <span className="material-symbols-outlined text-[16px]">play_arrow</span>
              Run OCR ({withoutOcr.length})
            </button>
          )}

          {/* If ALL selected have OCR, still allow re-run */}
          {withoutOcr.length === 0 && withOcr.length > 0 && (
            <button
              onClick={handleRunOcr}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm transition-all border border-md-outline-variant/30 text-md-on-surface-variant"
              title="Re-run OCR even though output files exist"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
              Re-run OCR
            </button>
          )}

          <button onClick={clearSelection} className="md-icon-btn w-7 h-7">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>

          <div className="flex-1" />
          <button onClick={() => selectAll()} className="text-label-sm text-md-primary hover:underline">Select all</button>
        </div>
      )}

      {/* Batch OCR Options — shown when files are selected */}
      {selectedKeys.size > 0 && (
        <div className="border-b border-md-outline-variant/20 bg-md-surface-container/50 px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[18px]" style={{ color: '#F39C12' }}>tune</span>
            <span className="text-label-sm font-semibold text-md-on-surface">Batch OCR Options</span>
          </div>

          <div className="space-y-3">
            {/* Storage Selection — only if multiple configs */}
            {availableStorageConfigs && availableStorageConfigs.length > 1 && (
              <div>
                <label className="text-label-sm text-md-on-surface-variant font-semibold mb-1 block">
                  Storage
                </label>
                <select
                  value={batchOptions.storageConfigId || ''}
                  onChange={(e) => setBatchOptions({...batchOptions, storageConfigId: e.target.value})}
                  className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface"
                >
                  <option value="">Primary (default)</option>
                  {availableStorageConfigs.map(cfg => (
                    <option key={cfg.id} value={cfg.id}>{cfg.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* AI Model Selection (used in Stage 2: AI Classify) */}
            <div>
              <label className="text-label-sm text-md-on-surface-variant font-semibold mb-1 block">
                AI Model (Stage 2 classification)
              </label>
              <select
                value={batchOptions.aiModel || ''}
                onChange={(e) => setBatchOptions({...batchOptions, aiModel: e.target.value})}
                className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface"
              >
                <option value="">Default (Sonnet 4)</option>
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (Recommended)</option>
                <option value="claude-opus-4-20250514">Claude Opus 4 (Higher quality)</option>
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Faster)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-md-on-surface-variant">
            <span className="material-symbols-outlined animate-spin text-[20px] mr-2">progress_activity</span>
            Scanning storage...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 text-md-on-surface-variant">
            <span className="material-symbols-outlined text-[40px] text-red-400 mb-2">cloud_off</span>
            <span className="text-body-md">Failed to browse storage</span>
            <span className="text-body-sm opacity-60 mt-1">{error.message}</span>
            <button onClick={onBack} className="mt-3 text-label-md text-md-primary hover:underline">Go back</button>
          </div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-4 px-4 py-2 bg-md-surface-container-high/20 text-label-sm text-md-on-surface-variant border-b border-md-outline-variant/10">
              <span>{data?.totalFolders || 0} folder{(data?.totalFolders || 0) !== 1 ? 's' : ''}</span>
              <span>{data?.totalFiles || 0} file{(data?.totalFiles || 0) !== 1 ? 's' : ''}</span>
              {(data?.totalOcrFiles || 0) > 0 && (
                <span className="flex items-center gap-1 font-semibold" style={{ color: '#F39C12' }}>
                  <span className="material-symbols-outlined text-[14px]">description</span>
                  {data.totalOcrFiles} OCR output file{data.totalOcrFiles !== 1 ? 's' : ''} detected
                </span>
              )}
            </div>

            {/* Folders */}
            {folders.length > 0 && (
              <div className="px-4 pt-3 pb-1">
                <div className="text-label-sm text-md-on-surface-variant font-bold uppercase mb-2">Folders</div>
                <div className="grid grid-cols-4 gap-2">
                  {folders.map(folder => (
                    <div
                      key={folder.name}
                      className="flex items-center gap-2 px-3 py-2 rounded-md-lg border border-md-outline-variant/20 hover:bg-md-on-surface/5 cursor-pointer transition-colors group"
                    >
                      <span className="material-symbols-outlined text-[20px] text-amber-400">folder</span>
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => setCurrentPrefix(folder.prefix)}
                          className="text-body-sm font-semibold text-md-on-surface truncate block w-full text-left hover:text-md-primary"
                        >
                          {folder.name}
                        </button>
                        <span className="text-[10px] text-md-on-surface-variant">
                          {folder.fileCount} file{folder.fileCount !== 1 ? 's' : ''} · {formatSize(folder.totalSize)}
                        </span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); selectFolder(folder.prefix); }}
                        className="opacity-0 group-hover:opacity-100 text-[10px] px-2 py-0.5 rounded font-semibold transition-opacity"
                        style={{ background: `${md.primary}15`, color: md.primary }}
                        title="Select all files in folder"
                      >
                        Select All
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Files */}
            {filteredFiles.length > 0 && (
              <div className="px-4 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-label-sm text-md-on-surface-variant font-bold uppercase">Files</span>
                  {selectedKeys.size === 0 && (
                    <span className="flex items-center gap-3">
                      <button onClick={() => selectAll()} className="text-label-sm text-md-primary hover:underline">Select all</button>
                      {processedCount > 0 && (
                        <button onClick={handleResetOcr} disabled={resetOcrStatus.isPending} className="text-label-sm text-amber-400 hover:underline disabled:opacity-50">
                          {resetOcrStatus.isPending ? 'Resetting...' : `Reset OCR status (${processedCount})`}
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-label-sm text-md-on-surface-variant">
                      <th className="w-10 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedKeys.size > 0 && selectedKeys.size === filteredFiles.length}
                          onChange={() => selectedKeys.size > 0 ? clearSelection() : selectAll()}
                          className="accent-[var(--md-primary)]"
                        />
                      </th>
                      <th className="px-2 py-1.5">Filename</th>
                      <th className="px-2 py-1.5">Drawing Number</th>
                      <th className="px-2 py-1.5">Revision</th>
                      <th className="px-2 py-1.5 text-right">Size</th>
                      <th className="px-2 py-1.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map(file => {
                      const isSelected = selectedKeys.has(file.key);
                      const ext = file.filename.split('.').pop()?.toLowerCase();
                      const icon = FILE_ICONS[ext] || 'description';
                      return (
                        <tr
                          key={file.key}
                          className={`border-b border-md-outline-variant/10 transition-colors ${
                            isSelected ? 'bg-md-primary/8' : 'hover:bg-md-on-surface/3'
                          }`}
                        >
                          <td className="w-10 px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(file.key)}
                              className="accent-[var(--md-primary)]"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[16px] text-md-on-surface-variant">{icon}</span>
                              <span className="text-body-sm font-mono">{file.filename}</span>
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-body-sm font-semibold text-md-on-surface">
                            {file.drawingNumber || '—'}
                          </td>
                          <td className="px-2 py-1.5 text-body-sm text-md-on-surface-variant">
                            {file.revision || '—'}
                          </td>
                          <td className="px-2 py-1.5 text-body-sm text-md-on-surface-variant text-right">
                            {formatSize(file.size)}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {statusBadge(file)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {filteredFiles.length === 0 && folders.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 text-md-on-surface-variant">
                <span className="material-symbols-outlined text-[40px] opacity-30 mb-2">folder_off</span>
                <span className="text-body-md">No P&ID files found in storage</span>
                <span className="text-body-sm opacity-60 mt-1">Upload P&ID files first via Admin → Storage</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
