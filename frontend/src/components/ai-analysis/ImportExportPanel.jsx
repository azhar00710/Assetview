import { useState, useCallback } from 'react';
import { md } from '../../lib/theme';
import { useExportForCleaning, useImportCleanedData } from '../../hooks/useAiAnalysis';

export default function ImportExportPanel({ batchId }) {
  const exportMutation = useExportForCleaning();
  const importMutation = useImportCleanedData();
  const [dragOver, setDragOver] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const handleExport = useCallback((format) => {
    exportMutation.mutate({ batchId, format });
  }, [batchId, exportMutation]);

  const handleFileDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);

    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;

    const text = await file.text();
    const isJson = file.name.endsWith('.json');

    if (isJson) {
      try {
        const data = JSON.parse(text);
        const records = data.extractions || data.records || data;
        importMutation.mutate(
          { batchId, records: Array.isArray(records) ? records : [] },
          { onSuccess: (result) => setImportResult(result) }
        );
      } catch (err) {
        setImportResult({ error: `Invalid JSON: ${err.message}` });
      }
    } else {
      importMutation.mutate(
        { batchId, csvText: text },
        { onSuccess: (result) => setImportResult(result) }
      );
    }
  }, [batchId, importMutation]);

  return (
    <div className="flex-1 overflow-auto p-4 space-y-6">
      {/* Export section */}
      <div className="rounded-md-lg border border-md-outline-variant/20 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-[20px] text-blue-400">download</span>
          <span className="text-body-md font-bold text-md-on-surface">Export for Cleaning</span>
        </div>
        <p className="text-body-sm text-md-on-surface-variant mb-3">
          Download OCR results and AI suggestions. Edit externally (fix tags, correct types, add missing data), then re-upload.
        </p>
        <div className="flex gap-2">
          {['json', 'csv'].map(fmt => (
            <button
              key={fmt}
              onClick={() => handleExport(fmt)}
              disabled={exportMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-body-sm font-bold transition-colors disabled:opacity-50"
              style={{ background: `${md.primary}15`, color: md.primary }}
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Export {fmt.toUpperCase()}
            </button>
          ))}
        </div>
        {exportMutation.isSuccess && (
          <div className="mt-2 text-body-sm text-green-400 flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">check_circle</span>
            File downloaded
          </div>
        )}
      </div>

      {/* Import section */}
      <div className="rounded-md-lg border border-md-outline-variant/20 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-[20px] text-amber-400">upload</span>
          <span className="text-body-md font-bold text-md-on-surface">Import Cleaned Data</span>
        </div>
        <p className="text-body-sm text-md-on-surface-variant mb-3">
          Upload cleaned JSON or CSV file. The system will reconcile with existing data (add new, update changed, skip unchanged).
        </p>

        {/* Drop zone */}
        <div
          className={`border-2 border-dashed rounded-md-lg p-8 text-center transition-colors cursor-pointer ${
            dragOver
              ? 'border-purple-400 bg-purple-500/10'
              : 'border-md-outline-variant/30 hover:border-md-outline-variant/60'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleFileDrop}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,.csv';
            input.onchange = (e) => handleFileDrop(e);
            input.click();
          }}
        >
          <span className="material-symbols-outlined text-[32px] text-md-on-surface-variant/40 mb-2">cloud_upload</span>
          <div className="text-body-sm text-md-on-surface-variant">
            {importMutation.isPending
              ? 'Importing...'
              : 'Drop JSON or CSV file here, or click to browse'}
          </div>
          <div className="text-[10px] text-md-on-surface-variant/50 mt-1">
            Supports: .json, .csv
          </div>
        </div>

        {/* Import result */}
        {importResult && (
          <div className={`mt-3 p-3 rounded-md text-body-sm ${
            importResult.error
              ? 'bg-red-500/10 text-red-400'
              : 'bg-green-500/10 text-green-400'
          }`}>
            {importResult.error ? (
              <div className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">error</span>
                {importResult.error}
              </div>
            ) : (
              <div>
                <div className="font-bold mb-1">Import Complete</div>
                <div className="flex gap-4 text-[11px]">
                  <span>Added: <strong>{importResult.added}</strong></span>
                  <span>Updated: <strong>{importResult.updated}</strong></span>
                  <span>Unchanged: <strong>{importResult.unchanged}</strong></span>
                  {importResult.errors?.length > 0 && (
                    <span className="text-red-400">Errors: <strong>{importResult.errors.length}</strong></span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
