import { useState, useMemo, useCallback } from 'react';
import {
  useTagDictionary, useTagDictionaryStats, useAddDictionaryEntry,
  useDeleteDictionaryEntry, useImportCsv, useImportJson, useAiDetect, useApplyAiDetected,
  useApplyTemplate, useTagAnalyses,
} from '../../hooks/useTagDictionary';
import { useAiConfig } from '../../hooks/useOcrPipelineV2';

// ── Entity type colors & icons ──────────────────────────────
const ENTITY_STYLES = {
  equipment:  { color: '#3BE494', icon: 'precision_manufacturing', label: 'Equipment' },
  instrument: { color: '#F39C12', icon: 'sensors', label: 'Instrument' },
  valve:      { color: '#E74C3C', icon: 'valve', label: 'Valve' },
  line:       { color: '#2D33E0', icon: 'linear_scale', label: 'Line' },
  cable:      { color: '#9B59B6', icon: 'cable', label: 'Cable' },
  signal:     { color: '#1ABC9C', icon: 'signal_cellular_alt', label: 'Signal' },
  structural: { color: '#95A5A6', icon: 'foundation', label: 'Structural' },
  safety:     { color: '#E67E22', icon: 'health_and_safety', label: 'Safety' },
  hvac:       { color: '#3498DB', icon: 'air', label: 'HVAC' },
  telecom:    { color: '#8E44AD', icon: 'cell_tower', label: 'Telecom' },
  fire_gas:   { color: '#C0392B', icon: 'local_fire_department', label: 'Fire & Gas' },
  piping:     { color: '#2980B9', icon: 'plumbing', label: 'Piping' },
  unknown:    { color: '#919A9B', icon: 'help_outline', label: 'Unknown' },
};

const DISCIPLINES = [
  'mechanical', 'electrical', 'instrumentation', 'telecom',
  'fire_gas', 'safety', 'valves', 'hvac', 'piping', 'structural',
];

const ENTITY_TYPES = Object.keys(ENTITY_STYLES);

/**
 * TagDictionaryCard — Client-specific tag classification rules.
 * Three input modes: Upload CSV, Direct Add, AI Auto-Detect.
 */
export default function TagDictionaryCard({ platformId, batches, embedded = false }) {
  const [expanded, setExpanded] = useState(embedded);
  const [activeMode, setActiveMode] = useState('list'); // list | upload | add | ai (AI Detect handles both OCR batch + CSV data sources)
  const { data, isLoading } = useTagDictionary(platformId);
  const { data: stats } = useTagDictionaryStats(platformId);

  const entries = data?.entries || [];
  const totalActive = stats?.totalActive || 0;

  // Filter state for the list
  const [filterType, setFilterType] = useState('all');
  const [filterSearch, setFilterSearch] = useState('');

  const filteredEntries = useMemo(() => {
    let list = entries.filter(e => e.isActive !== false);
    if (filterType !== 'all') list = list.filter(e => e.entityType === filterType);
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      list = list.filter(e =>
        e.functionCode.toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [entries, filterType, filterSearch]);

  if (!expanded && !embedded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-md-surface-container rounded-md-lg border border-md-outline-variant/30 hover:border-md-primary/40 transition-all group"
      >
        <span className="material-symbols-outlined text-[20px] text-md-primary">dictionary</span>
        <div className="flex-1 text-left">
          <div className="text-label-md font-semibold text-md-on-surface">Tag Dictionary</div>
          <div className="text-label-sm text-md-on-surface-variant">
            {totalActive > 0
              ? `${totalActive} active rules — client-specific tag classification`
              : 'No rules configured — using generic ISA S5.1 classification'
            }
          </div>
        </div>
        {totalActive > 0 && (
          <span className="px-2 py-0.5 text-label-sm rounded-md-full bg-md-primary/15 text-md-primary font-semibold">
            {totalActive}
          </span>
        )}
        <span className="material-symbols-outlined text-[18px] text-md-on-surface-variant group-hover:text-md-primary transition-colors">
          expand_more
        </span>
      </button>
    );
  }

  return (
    <div className={embedded ? 'overflow-hidden' : 'bg-md-surface-container rounded-md-lg border border-md-outline-variant/30 overflow-hidden'}>
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-3 ${embedded ? 'border-b border-md-outline-variant/10' : 'border-b border-md-outline-variant/20'}`}>
        {!embedded && <span className="material-symbols-outlined text-[20px] text-md-primary">dictionary</span>}
        <div className="flex-1">
          {!embedded && <div className="text-label-md font-semibold text-md-on-surface">Tag Dictionary</div>}
          <div className="text-label-sm text-md-on-surface-variant">
            {totalActive} active classification rules
          </div>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1">
          {[
            { key: 'list', icon: 'list', label: 'Browse' },
            { key: 'upload', icon: 'upload_file', label: 'Upload' },
            { key: 'add', icon: 'add_circle', label: 'Add' },
            { key: 'ai', icon: 'auto_awesome', label: 'AI Detect' },
          ].map(m => (
            <button
              key={m.key}
              onClick={() => setActiveMode(m.key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-label-sm font-semibold transition-all ${
                activeMode === m.key
                  ? 'bg-md-primary/15 text-md-primary'
                  : 'text-md-on-surface-variant hover:bg-md-on-surface/5'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>

        {!embedded && (
          <button
            onClick={() => setExpanded(false)}
            className="p-1 rounded-md hover:bg-md-on-surface/5 text-md-on-surface-variant"
          >
            <span className="material-symbols-outlined text-[18px]">expand_less</span>
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="max-h-[400px] overflow-y-auto">
        {activeMode === 'list' && (
          <DictionaryList
            entries={filteredEntries}
            filterType={filterType}
            setFilterType={setFilterType}
            filterSearch={filterSearch}
            setFilterSearch={setFilterSearch}
            platformId={platformId}
            isLoading={isLoading}
          />
        )}
        {activeMode === 'upload' && <CsvUploadPanel platformId={platformId} />}
        {activeMode === 'add' && <DirectAddPanel platformId={platformId} />}
        {activeMode === 'ai' && <AiDetectPanel platformId={platformId} batches={batches} />}
      </div>

      {/* Footer with template action */}
      {totalActive === 0 && (
        <TemplateApplyFooter platformId={platformId} />
      )}
    </div>
  );
}

// ── Dictionary List ─────────────────────────────────────────

function DictionaryList({ entries, filterType, setFilterType, filterSearch, setFilterSearch, platformId, isLoading }) {
  const deleteMut = useDeleteDictionaryEntry(platformId);

  return (
    <div className="px-3 py-2">
      {/* Filters */}
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[16px] text-md-on-surface-variant">search</span>
          <input
            type="text"
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            placeholder="Search function codes..."
            className="w-full pl-8 pr-3 py-1.5 bg-md-surface rounded-md border border-md-outline-variant/30 text-body-sm text-md-on-surface placeholder:text-md-on-surface-variant/50 outline-none focus:border-md-primary/50"
          />
        </div>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-2 py-1.5 bg-md-surface rounded-md border border-md-outline-variant/30 text-body-sm text-md-on-surface outline-none"
        >
          <option value="all">All Types</option>
          {ENTITY_TYPES.map(t => (
            <option key={t} value={t}>{ENTITY_STYLES[t].label}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-md-on-surface-variant text-body-sm">
          <span className="material-symbols-outlined animate-spin text-[18px] mr-2">progress_activity</span>
          Loading...
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-md-on-surface-variant">
          <span className="material-symbols-outlined text-[32px] mb-2 opacity-30">dictionary</span>
          <div className="text-body-sm">No dictionary entries yet</div>
          <div className="text-label-sm opacity-60">Upload a CSV or add entries manually</div>
        </div>
      ) : (
        <div className="space-y-0.5">
          {entries.map(entry => {
            const style = ENTITY_STYLES[entry.entityType] || ENTITY_STYLES.unknown;
            return (
              <div key={entry.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-md-on-surface/3 group">
                <span className="material-symbols-outlined text-[16px]" style={{ color: style.color }}>
                  {style.icon}
                </span>
                <span className="text-body-sm font-mono font-bold text-md-on-surface min-w-[60px]">
                  {entry.functionCode}
                </span>
                <span className="text-label-sm px-1.5 py-0.5 rounded-md" style={{
                  backgroundColor: style.color + '15',
                  color: style.color,
                }}>
                  {style.label}
                </span>
                {entry.discipline && (
                  <span className="text-label-sm text-md-on-surface-variant capitalize">
                    {entry.discipline.replace('_', ' & ')}
                  </span>
                )}
                <span className="flex-1 text-label-sm text-md-on-surface-variant truncate">
                  {entry.description}
                  {entry.tagPattern && (
                    <span className="ml-1 font-mono text-md-primary/70">[{entry.tagPattern}]</span>
                  )}
                </span>
                {entry.source !== 'template' && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-md-on-surface/5 text-md-on-surface-variant capitalize">
                    {entry.source}
                  </span>
                )}
                <button
                  onClick={() => deleteMut.mutate(entry.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/10 text-md-on-surface-variant hover:text-red-400 transition-all"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CSV Upload Panel ────────────────────────────────────────

function CsvUploadPanel({ platformId }) {
  const [csvText, setCsvText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const importCsv = useImportCsv(platformId);

  const handleFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => setCsvText(e.target.result);
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleSubmit = useCallback(() => {
    if (!csvText.trim()) return;
    importCsv.mutate(csvText);
  }, [csvText, importCsv]);

  // Preview parsed lines
  const preview = useMemo(() => {
    if (!csvText) return null;
    const lines = csvText.split('\n').filter(l => l.trim());
    return { headers: lines[0], count: lines.length - 1 };
  }, [csvText]);

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="text-body-sm text-md-on-surface-variant">
        Upload a CSV file with your client's tag classification rules.
        Required columns: <strong className="text-md-on-surface">function_code</strong>, <strong className="text-md-on-surface">entity_type</strong>.
        Optional: discipline, description, tag_pattern, number_format.
      </div>

      {/* Download template link */}
      <a
        href={`${import.meta.env.VITE_API_URL || '/api/v1'}/tag-dictionary/${platformId}/csv-template`}
        download
        className="inline-flex items-center gap-1 text-label-sm text-md-primary hover:underline"
      >
        <span className="material-symbols-outlined text-[14px]">download</span>
        Download CSV template
      </a>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-md-lg p-6 text-center transition-all cursor-pointer ${
          dragOver ? 'border-md-primary bg-md-primary/5' : 'border-md-outline-variant/30 hover:border-md-primary/30'
        }`}
        onClick={() => document.getElementById('csv-upload-input').click()}
      >
        <input
          id="csv-upload-input"
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <span className="material-symbols-outlined text-[28px] text-md-on-surface-variant mb-1 block">upload_file</span>
        <div className="text-body-sm text-md-on-surface-variant">
          Drop CSV here or click to browse
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="bg-md-surface rounded-md border border-md-outline-variant/20 p-3">
          <div className="text-label-sm text-md-on-surface-variant mb-1">
            Preview: <strong className="text-md-on-surface">{preview.count}</strong> entries found
          </div>
          <div className="text-label-sm font-mono text-md-on-surface-variant truncate">
            {preview.headers}
          </div>
        </div>
      )}

      {/* Import button */}
      {csvText && (
        <button
          onClick={handleSubmit}
          disabled={importCsv.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-md-primary text-md-on-primary rounded-md-full text-label-md font-semibold hover:bg-md-primary/90 disabled:opacity-50 transition-all"
        >
          {importCsv.isPending ? (
            <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-[16px]">upload</span>
          )}
          Import {preview?.count || 0} entries
        </button>
      )}

      {/* Result */}
      {importCsv.isSuccess && (
        <div className="bg-green-900/20 border border-green-600/30 rounded-md p-3 text-body-sm text-green-300">
          <strong>Import complete:</strong> {importCsv.data.added} added, {importCsv.data.updated} updated,
          {importCsv.data.skipped} skipped
          {importCsv.data.errors?.length > 0 && (
            <span className="text-amber-400 ml-2">({importCsv.data.errors.length} errors)</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Direct Add Panel ────────────────────────────────────────

function DirectAddPanel({ platformId }) {
  const [functionCode, setFunctionCode] = useState('');
  const [entityType, setEntityType] = useState('instrument');
  const [discipline, setDiscipline] = useState('');
  const [description, setDescription] = useState('');
  const [tagPattern, setTagPattern] = useState('');
  const [numberFormat, setNumberFormat] = useState('');
  const addEntry = useAddDictionaryEntry(platformId);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!functionCode.trim() || !entityType) return;
    addEntry.mutate({
      functionCode: functionCode.trim().toUpperCase(),
      entityType,
      discipline: discipline || null,
      description: description || null,
      tagPattern: tagPattern || null,
      numberFormat: numberFormat || null,
    }, {
      onSuccess: () => {
        setFunctionCode('');
        setDescription('');
        setTagPattern('');
        setNumberFormat('');
      },
    });
  }, [functionCode, entityType, discipline, description, tagPattern, numberFormat, addEntry]);

  return (
    <form onSubmit={handleSubmit} className="px-4 py-3 space-y-3">
      <div className="text-body-sm text-md-on-surface-variant">
        Add tag classification rules. Enter the function code prefix, entity type, and optionally a tag pattern example. Patterns help the AI recognize your client-specific tag formats during cleanup.
      </div>

      <div className="grid grid-cols-4 gap-2">
        {/* Function Code */}
        <div>
          <label className="text-label-sm text-md-on-surface-variant block mb-1">Function Code *</label>
          <input
            type="text"
            value={functionCode}
            onChange={e => setFunctionCode(e.target.value.toUpperCase())}
            placeholder="e.g., PT"
            className="w-full px-3 py-2 bg-md-surface rounded-md border border-md-outline-variant/30 text-body-sm font-mono text-md-on-surface placeholder:text-md-on-surface-variant/50 outline-none focus:border-md-primary/50"
            maxLength={10}
          />
        </div>

        {/* Entity Type */}
        <div>
          <label className="text-label-sm text-md-on-surface-variant block mb-1">Entity Type *</label>
          <select
            value={entityType}
            onChange={e => setEntityType(e.target.value)}
            className="w-full px-3 py-2 bg-md-surface rounded-md border border-md-outline-variant/30 text-body-sm text-md-on-surface outline-none"
          >
            {ENTITY_TYPES.map(t => (
              <option key={t} value={t}>{ENTITY_STYLES[t].label}</option>
            ))}
          </select>
        </div>

        {/* Discipline */}
        <div>
          <label className="text-label-sm text-md-on-surface-variant block mb-1">Discipline</label>
          <select
            value={discipline}
            onChange={e => setDiscipline(e.target.value)}
            className="w-full px-3 py-2 bg-md-surface rounded-md border border-md-outline-variant/30 text-body-sm text-md-on-surface outline-none"
          >
            <option value="">— Select —</option>
            {DISCIPLINES.map(d => (
              <option key={d} value={d}>{d.replace('_', ' & ')}</option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div>
          <label className="text-label-sm text-md-on-surface-variant block mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g., Pressure Transmitter"
            className="w-full px-3 py-2 bg-md-surface rounded-md border border-md-outline-variant/30 text-body-sm text-md-on-surface placeholder:text-md-on-surface-variant/50 outline-none focus:border-md-primary/50"
          />
        </div>
      </div>

      {/* Tag Pattern & Number Format — helps AI recognize client-specific tag structures */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-label-sm text-md-on-surface-variant block mb-1">
            Tag Pattern <span className="text-md-on-surface-variant/50">(example tag)</span>
          </label>
          <input
            type="text"
            value={tagPattern}
            onChange={e => setTagPattern(e.target.value)}
            placeholder="e.g., PT-28XXXX, V-28XXX, 6&quot;-PG-28-1001"
            className="w-full px-3 py-2 bg-md-surface rounded-md border border-md-outline-variant/30 text-body-sm font-mono text-md-on-surface placeholder:text-md-on-surface-variant/50 outline-none focus:border-md-primary/50"
          />
        </div>
        <div>
          <label className="text-label-sm text-md-on-surface-variant block mb-1">
            Number Format <span className="text-md-on-surface-variant/50">(numbering convention)</span>
          </label>
          <input
            type="text"
            value={numberFormat}
            onChange={e => setNumberFormat(e.target.value)}
            placeholder="e.g., XX-NNNNN, size&quot;-svc-area-seq-spec"
            className="w-full px-3 py-2 bg-md-surface rounded-md border border-md-outline-variant/30 text-body-sm font-mono text-md-on-surface placeholder:text-md-on-surface-variant/50 outline-none focus:border-md-primary/50"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={!functionCode.trim() || addEntry.isPending}
        className="flex items-center gap-2 px-4 py-2 bg-md-primary text-md-on-primary rounded-md-full text-label-md font-semibold hover:bg-md-primary/90 disabled:opacity-50 transition-all"
      >
        {addEntry.isPending ? (
          <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
        ) : (
          <span className="material-symbols-outlined text-[16px]">add</span>
        )}
        Add Rule
      </button>

      {addEntry.isSuccess && (
        <div className="text-label-sm text-green-400">
          Added: {addEntry.data.entry?.functionCode} → {addEntry.data.entry?.entityType}
        </div>
      )}
    </form>
  );
}

// ── AI Auto-Detect Panel (unified: OCR + multi-file data sources) ──
// Accepts CSV and Excel (.xls/.xlsx) files. Parses ALL sheets, scans ALL columns.
// AI identifies tag columns and contextual data. Saves analysis for future use.

function AiDetectPanel({ platformId, batches }) {
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [parsedFiles, setParsedFiles] = useState([]); // ParsedFile[]
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { data: aiConfig } = useAiConfig(platformId);
  const aiDetect = useAiDetect(platformId);
  const applyDetected = useApplyAiDetected(platformId);
  const { data: savedAnalyses } = useTagAnalyses(platformId);
  const [selectedSuggestions, setSelectedSuggestions] = useState(new Set());

  const completedBatches = (batches || []).filter(b => b.status === 'completed' || b.status === 'partial');
  const hasAiKey = aiConfig?.hasAiCredentials;
  const hasFiles = parsedFiles.length > 0;
  const hasAnySource = !!selectedBatchId || hasFiles;

  // Handle file upload — parse CSV/Excel client-side, extract all sheets
  const handleFilesAdded = useCallback(async (fileList) => {
    setIsParsingFiles(true);
    try {
      const { parseFiles } = await import('../../lib/fileParser.js');
      const newParsed = await parseFiles(fileList);
      setParsedFiles(prev => [...prev, ...newParsed]);
    } catch (err) {
      console.error('File parse error:', err);
    } finally {
      setIsParsingFiles(false);
    }
  }, []);

  const removeFile = useCallback((idx) => {
    setParsedFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // Build data files payload — all sheets from all files
  const buildDataFiles = useCallback(() => {
    return parsedFiles.flatMap(pf =>
      pf.sheets.map(sheet => ({
        fileName: pf.fileName,
        sheetName: sheet.name,
        headers: sheet.headers,
        rowCount: sheet.rowCount,
        sampleRows: sheet.sampleRows,
        csvText: sheet.csvText,
      }))
    );
  }, [parsedFiles]);

  const handleDetect = useCallback(() => {
    if (!hasAnySource) return;
    aiDetect.mutate({
      batchId: selectedBatchId || undefined,
      dataFiles: hasFiles ? buildDataFiles() : undefined,
    });
    setSelectedSuggestions(new Set());
  }, [hasAnySource, selectedBatchId, hasFiles, buildDataFiles, aiDetect]);

  const suggestions = aiDetect.data?.suggestions || [];
  const lineInfo = aiDetect.data?.lineInfo;
  const resultSource = aiDetect.data?.source;
  const analysisId = aiDetect.data?.analysisId;
  const columnMapping = aiDetect.data?.columnMapping;

  const handleToggle = useCallback((idx) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedSuggestions.size === suggestions.length) {
      setSelectedSuggestions(new Set());
    } else {
      setSelectedSuggestions(new Set(suggestions.map((_, i) => i)));
    }
  }, [suggestions, selectedSuggestions]);

  const handleApply = useCallback(() => {
    const entries = suggestions.filter((_, i) => selectedSuggestions.has(i));
    if (entries.length > 0) {
      applyDetected.mutate(entries);
    }
  }, [suggestions, selectedSuggestions, applyDetected]);

  // Total stats from parsed files
  const totalSheets = parsedFiles.reduce((sum, pf) => sum + pf.sheets.length, 0);
  const totalRows = parsedFiles.reduce((sum, pf) => sum + pf.sheets.reduce((s, sh) => s + sh.rowCount, 0), 0);

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="text-body-sm text-md-on-surface-variant">
        Auto-detect tag patterns from OCR results and/or working data files (CSV, Excel).
        AI scans <strong>all columns</strong> and <strong>all sheets</strong> to identify tags, descriptions, and context.
      </div>

      {/* Claude AI key status */}
      {!hasAiKey && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-900/10 border border-amber-600/20">
          <span className="material-symbols-outlined text-[16px] text-amber-400">info</span>
          <span className="text-label-sm text-amber-300">
            No AI key — will use programmatic analysis only. Add Claude AI key in Pipeline Settings for smarter detection.
          </span>
        </div>
      )}

      {/* ── Data Sources ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-label-sm font-semibold text-md-on-surface-variant uppercase tracking-wider">Data Sources</div>
          {savedAnalyses?.length > 0 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1 text-label-sm text-md-primary hover:underline"
            >
              <span className="material-symbols-outlined text-[14px]">history</span>
              {savedAnalyses.length} saved {savedAnalyses.length === 1 ? 'analysis' : 'analyses'}
            </button>
          )}
        </div>

        {/* Saved analyses history */}
        {showHistory && savedAnalyses?.length > 0 && (
          <div className="bg-md-surface-container-low rounded-md p-2 space-y-1 max-h-[150px] overflow-y-auto">
            {savedAnalyses.map(a => (
              <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-md-on-surface/5 text-label-sm">
                <span className="material-symbols-outlined text-[14px] text-md-on-surface-variant">analytics</span>
                <span className="text-md-on-surface font-semibold">{a.totalEntries} patterns</span>
                <span className="text-md-on-surface-variant">
                  from {a.sourceFiles?.length || 0} files
                </span>
                <span className="flex-1" />
                <span className="text-[10px] text-md-on-surface-variant/60">
                  {new Date(a.createdAt).toLocaleDateString()}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-md-primary/10 text-md-primary">
                  {a.appliedCount} applied
                </span>
              </div>
            ))}
          </div>
        )}

        {/* OCR Batch selector */}
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-md-on-surface-variant">document_scanner</span>
          <select
            value={selectedBatchId}
            onChange={e => setSelectedBatchId(e.target.value)}
            className="flex-1 px-3 py-1.5 bg-md-surface rounded-md border border-md-outline-variant/30 text-body-sm text-md-on-surface outline-none"
          >
            <option value="">— OCR batch (optional) —</option>
            {completedBatches.map(b => (
              <option key={b.id} value={b.id}>
                {b.batchName || b.id.slice(0, 8)} ({b.processedFiles} files)
              </option>
            ))}
          </select>
          {selectedBatchId && (
            <span className="material-symbols-outlined text-[14px] text-md-primary">check_circle</span>
          )}
        </div>

        {/* Multi-file drop zone */}
        <div>
          <input
            type="file"
            accept=".csv,.txt,.xls,.xlsx,.xlsm"
            multiple
            className="hidden"
            id="ai-detect-files"
            onChange={(e) => e.target.files?.length && handleFilesAdded(e.target.files)}
          />
          <label
            htmlFor="ai-detect-files"
            className="flex flex-col items-center gap-1 p-3 rounded-md-lg border-2 border-dashed cursor-pointer transition-all border-md-outline-variant/30 hover:border-md-primary/30 hover:bg-md-primary/3"
          >
            {isParsingFiles ? (
              <span className="material-symbols-outlined animate-spin text-[20px] text-md-primary">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[20px] text-md-on-surface-variant">upload_file</span>
            )}
            <span className="text-label-sm text-md-on-surface-variant">
              Drop CSV or Excel files — equipment lists, instrument lists, line lists, any working data
            </span>
            <span className="text-[10px] text-md-on-surface-variant/50">
              Supports .csv, .xls, .xlsx — all sheets and all columns are scanned
            </span>
          </label>
        </div>

        {/* Parsed file cards */}
        {parsedFiles.length > 0 && (
          <div className="space-y-1">
            {parsedFiles.map((pf, idx) => (
              <div key={idx} className="flex items-center gap-2 px-2 py-1.5 bg-md-primary/5 border border-md-primary/20 rounded-md">
                <span className="material-symbols-outlined text-[16px] text-md-primary">
                  {pf.fileType === 'excel' ? 'table_chart' : 'description'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-label-sm font-semibold text-md-on-surface truncate">{pf.fileName}</div>
                  <div className="text-[10px] text-md-on-surface-variant">
                    {pf.sheets.length} {pf.sheets.length === 1 ? 'sheet' : 'sheets'}
                    {' \u2022 '}
                    {pf.sheets.reduce((s, sh) => s + sh.rowCount, 0)} rows
                    {' \u2022 '}
                    {pf.sheets.map(sh => sh.headers.length).reduce((a, b) => Math.max(a, b), 0)} cols
                  </div>
                  {pf.sheets.length > 1 && (
                    <div className="text-[9px] text-md-on-surface-variant/60 truncate">
                      Sheets: {pf.sheets.map(s => s.name).join(', ')}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => removeFile(idx)}
                  className="p-0.5 rounded-full hover:bg-red-500/10 text-md-on-surface-variant hover:text-red-400"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            ))}
            <div className="text-[10px] text-md-on-surface-variant/60 px-1">
              Total: {parsedFiles.length} files, {totalSheets} sheets, {totalRows.toLocaleString()} rows
            </div>
          </div>
        )}
      </div>

      {/* Detect button */}
      <button
        onClick={handleDetect}
        disabled={!hasAnySource || aiDetect.isPending}
        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-md-full text-label-md font-semibold hover:bg-purple-700 disabled:opacity-50 transition-all w-full justify-center"
      >
        {aiDetect.isPending ? (
          <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
        ) : (
          <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
        )}
        {aiDetect.isPending
          ? (hasAiKey ? 'AI analyzing all columns & sheets...' : 'Analyzing...')
          : `Detect Tag Patterns${hasAiKey ? ' with AI' : ''}`
        }
      </button>

      {/* Source indicator */}
      {resultSource && (
        <div className="flex items-center gap-1.5 text-label-sm">
          <span className="material-symbols-outlined text-[14px] text-md-on-surface-variant">
            {resultSource === 'ai' ? 'auto_awesome' : 'code'}
          </span>
          <span className="text-md-on-surface-variant">
            Results from: <strong className="text-md-on-surface">{resultSource === 'ai' ? 'AI + Programmatic' : 'Programmatic Analysis'}</strong>
          </span>
          {analysisId && (
            <span className="ml-auto text-[10px] text-md-on-surface-variant/50">
              Saved as analysis #{analysisId.slice(0, 8)}
            </span>
          )}
        </div>
      )}

      {/* Column mapping from AI */}
      {columnMapping && Object.keys(columnMapping).length > 0 && (
        <div className="bg-indigo-900/10 border border-indigo-600/20 rounded-md p-2 text-label-sm">
          <div className="text-indigo-300 font-semibold mb-1">AI Column Mapping</div>
          <div className="space-y-1">
            {Object.entries(columnMapping).map(([fileOrCol, roleOrMap]) => (
              typeof roleOrMap === 'string' ? (
                <span key={fileOrCol} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-500/10 mr-1">
                  <span className="font-mono text-indigo-400 text-[10px]">{fileOrCol}</span>
                  <span className="text-[10px] text-md-on-surface-variant">{'\u2192'} {roleOrMap}</span>
                </span>
              ) : (
                <div key={fileOrCol}>
                  <div className="text-[10px] text-md-on-surface-variant font-semibold mb-0.5">{fileOrCol}</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(roleOrMap).map(([col, role]) => (
                      <span key={col} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-500/10">
                        <span className="font-mono text-indigo-400 text-[10px]">{col}</span>
                        <span className="text-[10px] text-md-on-surface-variant">{'\u2192'} {String(role)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {/* Tag format info */}
      {aiDetect.data?.tagFormat && (
        <div className="bg-purple-900/15 border border-purple-600/30 rounded-md p-3 text-body-sm">
          <div className="text-purple-300 font-semibold mb-1">Detected Tag Convention</div>
          <div className="text-md-on-surface-variant">
            <strong>Format:</strong> {aiDetect.data.tagFormat}
            {aiDetect.data.hasLocationCode && (
              <span className="ml-2 text-purple-400">(with location code, {aiDetect.data.locationCodeLength} chars)</span>
            )}
          </div>
          {aiDetect.data.lineFormat && (
            <div className="text-md-on-surface-variant mt-0.5">
              <strong>Line format:</strong> {aiDetect.data.lineFormat}
            </div>
          )}
        </div>
      )}

      {/* Line info */}
      {lineInfo?.lineFormat && !aiDetect.data?.tagFormat && (
        <div className="bg-blue-900/15 border border-blue-600/30 rounded-md p-3 text-body-sm">
          <div className="text-blue-300 font-semibold mb-1">Line Tag Convention</div>
          <div className="text-md-on-surface-variant">
            <strong>Format:</strong> {lineInfo.lineFormat}
          </div>
          {lineInfo.fluidCodes && Object.keys(lineInfo.fluidCodes).length > 0 && (
            <div className="text-md-on-surface-variant mt-1">
              <strong>Fluid codes:</strong>{' '}
              {Object.entries(lineInfo.fluidCodes).map(([code, service]) => (
                <span key={code} className="inline-flex items-center gap-0.5 mr-2">
                  <span className="font-mono text-blue-400">{code}</span>
                  <span className="text-md-on-surface-variant/60">({service})</span>
                </span>
              ))}
            </div>
          )}
          {lineInfo.pipeClasses?.length > 0 && (
            <div className="text-md-on-surface-variant mt-1">
              <strong>Pipe classes:</strong>{' '}
              <span className="font-mono text-purple-400">{lineInfo.pipeClasses.join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Fluid codes from AI */}
      {aiDetect.data?.fluidCodes && Object.keys(aiDetect.data.fluidCodes).length > 0 && (
        <div className="bg-blue-900/10 border border-blue-600/20 rounded-md p-2 text-label-sm">
          <strong className="text-blue-300">Fluid codes:</strong>{' '}
          {Object.entries(aiDetect.data.fluidCodes).map(([code, desc]) => (
            <span key={code} className="inline-flex items-center gap-0.5 mr-2">
              <span className="font-mono text-blue-400">{code}</span>
              <span className="text-md-on-surface-variant/60">= {desc}</span>
            </span>
          ))}
        </div>
      )}

      {/* Suggestions list */}
      {suggestions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-label-md font-semibold text-md-on-surface">
              {suggestions.length} function codes detected
            </div>
            <div className="flex gap-2">
              <button onClick={handleSelectAll} className="text-label-sm text-md-primary hover:underline">
                {selectedSuggestions.size === suggestions.length ? 'Deselect All' : 'Select All'}
              </button>
              {selectedSuggestions.size > 0 && (
                <button
                  onClick={handleApply}
                  disabled={applyDetected.isPending}
                  className="flex items-center gap-1 px-3 py-1 bg-md-primary text-md-on-primary rounded-md-full text-label-sm font-semibold"
                >
                  Apply {selectedSuggestions.size} selected
                </button>
              )}
            </div>
          </div>

          <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
            {suggestions.map((s, i) => {
              const style = ENTITY_STYLES[s.entityType] || ENTITY_STYLES.unknown;
              const confColor = s.confidence >= 0.9 ? '#3BE494' : s.confidence >= 0.7 ? '#F39C12' : '#E74C3C';
              return (
                <label key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-md-on-surface/3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSuggestions.has(i)}
                    onChange={() => handleToggle(i)}
                    className="accent-[#3BE494]"
                  />
                  <span className="material-symbols-outlined text-[16px]" style={{ color: style.color }}>
                    {style.icon}
                  </span>
                  <span className="text-body-sm font-mono font-bold text-md-on-surface min-w-[60px]">
                    {s.functionCode}
                  </span>
                  <span className="text-label-sm px-1.5 py-0.5 rounded-md" style={{
                    backgroundColor: style.color + '15', color: style.color,
                  }}>
                    {style.label}
                  </span>
                  <span className="text-label-sm text-md-on-surface-variant capitalize">
                    {s.discipline?.replace('_', ' & ')}
                  </span>
                  <span className="flex-1 text-label-sm text-md-on-surface-variant truncate">
                    {s.description}
                    {s.tagPattern && (
                      <span className="ml-1 font-mono text-md-primary/50 text-[10px]">[{s.tagPattern}]</span>
                    )}
                  </span>
                  {s.sampleTags?.length > 0 && (
                    <span className="text-[10px] font-mono text-md-on-surface-variant/50 truncate max-w-[100px]" title={s.sampleTags.join(', ')}>
                      {s.sampleTags[0]}
                    </span>
                  )}
                  <span className="text-label-sm font-mono" style={{ color: confColor }}>
                    {(s.confidence * 100).toFixed(0)}%
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {applyDetected.isSuccess && (
        <div className="bg-green-900/20 border border-green-600/30 rounded-md p-3 text-body-sm text-green-300">
          Applied {applyDetected.data.added} entries to dictionary
        </div>
      )}

      {aiDetect.data?.message && !suggestions.length && (
        <div className="text-body-sm text-md-on-surface-variant">{aiDetect.data.message}</div>
      )}
    </div>
  );
}

// ── Template Apply Footer ───────────────────────────────────

function TemplateApplyFooter({ platformId }) {
  const applyTemplate = useApplyTemplate(platformId);

  return (
    <div className="px-4 py-3 border-t border-md-outline-variant/20 bg-md-surface-container-low flex items-center gap-3">
      <span className="material-symbols-outlined text-[18px] text-amber-400">lightbulb</span>
      <div className="flex-1 text-label-sm text-md-on-surface-variant">
        Start with the built-in <strong className="text-md-on-surface">ISA S5.1 + common O&G codes</strong> template, then customize for your client.
      </div>
      <button
        onClick={() => applyTemplate.mutate()}
        disabled={applyTemplate.isPending}
        className="flex items-center gap-1 px-3 py-1.5 bg-md-primary/15 text-md-primary rounded-md-full text-label-sm font-semibold hover:bg-md-primary/25 transition-all disabled:opacity-50"
      >
        {applyTemplate.isPending ? (
          <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
        ) : (
          <span className="material-symbols-outlined text-[14px]">bolt</span>
        )}
        Apply Template
      </button>
      {applyTemplate.isSuccess && (
        <span className="text-label-sm text-green-400">{applyTemplate.data.totalActive} entries added</span>
      )}
    </div>
  );
}
