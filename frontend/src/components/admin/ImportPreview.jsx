import { useState, useRef, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { M3 } from '../../data/constants';
import { useImportPreview, useImportApply } from '../../hooks/useAdminApi';

const STATUS_STYLES = {
  add:       { color: M3.primary,          label: 'Add',       bg: (dk) => dk ? 'rgba(79,226,176,0.08)'  : 'rgba(79,226,176,0.06)' },
  modify:    { color: M3.warning,          label: 'Modify',    bg: (dk) => dk ? 'rgba(255,214,102,0.08)' : 'rgba(255,214,102,0.06)' },
  remove:    { color: M3.error,            label: 'Remove',    bg: (dk) => dk ? 'rgba(255,137,122,0.08)' : 'rgba(255,137,122,0.06)' },
  unchanged: { color: M3.onSurfaceVariant, label: 'Unchanged', bg: () => 'transparent' },
};

export default function ImportPreview({ type = 'lines', platformId }) {
  const { isDark } = useTheme();
  const fileRef = useRef(null);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [selected, setSelected] = useState(new Set());

  const previewMut = useImportPreview(type);
  const applyMut = useImportApply(type);

  const borderC = isDark ? 'border-white/[0.06]' : 'border-gray-200';
  const mutedText = isDark ? 'text-md-on-surface-variant' : 'text-gray-500';
  const panelBg = isDark ? 'bg-md-surface-container' : 'bg-white';
  const inputCls = isDark
    ? 'bg-md-surface-container-high border-white/[0.07] text-md-on-surface focus:border-md-primary/50'
    : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-md-primary/60';

  // Transform API response { added, modified, removed, unchanged } into flat rows with _status
  const rows = useMemo(() => {
    const d = previewMut.data;
    if (!d) return [];
    const result = [];
    const idKey = type === 'lines' ? 'lineNumber' : 'tag';
    for (const item of d.added || []) {
      result.push({ ...item, _status: 'add', _id: item[idKey] });
    }
    for (const item of d.modified || []) {
      const row = { ...item, _status: 'modify', _id: item.id, _changes: item.changes };
      result.push(row);
    }
    for (const item of d.removed || []) {
      result.push({ ...item, _status: 'remove', _id: item.id });
    }
    for (const item of d.unchanged || []) {
      result.push({ ...item, _status: 'unchanged', _id: item[idKey] });
    }
    return result;
  }, [previewMut.data, type]);

  const warnings = previewMut.data?.warnings || [];

  const displayCols = useMemo(() => {
    if (type === 'lines') return ['systemCode', 'lineNumber', 'service', 'fluid_code', 'nominal_size', 'pipe_class'];
    return ['systemCode', 'tag', 'equipment_type', 'description', 'criticality'];
  }, [type]);

  const changeableRows = useMemo(() =>
    rows.filter(r => r._status !== 'unchanged'),
  [rows]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText(ev.target.result);
    };
    reader.readAsText(file);
  };

  const handlePreview = () => {
    if (!csvText) return;
    previewMut.mutate({ csv: csvText, platform_id: platformId });
    setSelected(new Set());
  };

  const handleApply = () => {
    if (selected.size === 0) return;
    const selectedRows = rows.filter((_, i) => selected.has(i));
    const added = selectedRows.filter(r => r._status === 'add');
    const modified = selectedRows.filter(r => r._status === 'modify');
    const removed = selectedRows.filter(r => r._status === 'remove').map(r => r._id || r.id);
    applyMut.mutate({ added, modified, removed, platform_id: platformId });
  };

  const toggleAll = () => {
    if (selected.size === changeableRows.length) {
      setSelected(new Set());
    } else {
      const indices = new Set();
      rows.forEach((r, i) => { if (r._status !== 'unchanged') indices.add(i); });
      setSelected(indices);
    }
  };

  const toggleRow = (idx) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Header */}
      <h2 className={`text-[13px] font-bold ${isDark ? 'text-md-on-surface' : 'text-gray-900'}`}>
        Import {type.charAt(0).toUpperCase() + type.slice(1)}
      </h2>

      {/* File picker */}
      <div className={`flex items-center gap-3 rounded-xl border ${borderC} p-4 ${panelBg}`}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-colors duration-150 cursor-pointer border ${
            isDark
              ? 'border-white/[0.07] text-md-on-surface hover:bg-white/[0.04]'
              : 'border-gray-200 text-gray-700 hover:bg-gray-100'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14">
            <path d="M7 2v8M3 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Choose CSV
        </button>

        {fileName && (
          <span className={`text-[11px] ${mutedText}`}>{fileName}</span>
        )}

        <div className="flex-1" />

        <button
          onClick={handlePreview}
          disabled={!csvText || previewMut.isPending}
          className={`px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors duration-150 cursor-pointer ${
            !csvText || previewMut.isPending
              ? 'opacity-40 cursor-not-allowed bg-md-primary/10 text-md-primary'
              : 'bg-md-primary/15 text-md-primary hover:bg-md-primary/25'
          }`}
        >
          {previewMut.isPending ? 'Previewing...' : 'Preview'}
        </button>
      </div>

      {/* Error */}
      {previewMut.isError && (
        <div className="text-[12px] text-md-error px-1">
          Preview failed: {previewMut.error?.message}
        </div>
      )}

      {/* Apply result */}
      {applyMut.isSuccess && (
        <div className="text-[12px] text-md-primary px-1">
          Import applied successfully.
        </div>
      )}
      {applyMut.isError && (
        <div className="text-[12px] text-md-error px-1">
          Apply failed: {applyMut.error?.message}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className={`rounded-xl border border-md-warning/30 p-3 space-y-1 ${isDark ? 'bg-md-warning/5' : 'bg-yellow-50'}`}>
          {warnings.map((w, i) => (
            <div key={i} className="text-[11px] text-md-warning">{w}</div>
          ))}
        </div>
      )}

      {/* Diff table */}
      {rows.length > 0 && (
        <>
          {/* Summary */}
          <div className="flex items-center gap-4 px-1">
            {Object.entries(STATUS_STYLES).map(([key, style]) => {
              const count = rows.filter(r => r._status === key).length;
              if (count === 0) return null;
              return (
                <span key={key} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-2 h-2 rounded-full" style={{ background: style.color }} />
                  <span style={{ color: style.color }} className="font-medium">
                    {count} {style.label}
                  </span>
                </span>
              );
            })}
            <div className="flex-1" />
            <button
              onClick={handleApply}
              disabled={selected.size === 0 || applyMut.isPending}
              className={`px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors duration-150 cursor-pointer ${
                selected.size === 0 || applyMut.isPending
                  ? 'opacity-40 cursor-not-allowed bg-md-primary/10 text-md-primary'
                  : 'bg-md-primary/15 text-md-primary hover:bg-md-primary/25'
              }`}
            >
              {applyMut.isPending ? 'Applying...' : `Apply Selected (${selected.size})`}
            </button>
          </div>

          <div className={`rounded-xl border ${borderC} overflow-hidden ${panelBg}`}>
            <table className="w-full border-collapse">
              <thead>
                <tr className={`border-b ${borderC}`} style={{ background: isDark ? 'rgba(79,226,176,0.05)' : 'rgba(79,226,176,0.03)' }}>
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={changeableRows.length > 0 && selected.size === changeableRows.length}
                      onChange={toggleAll}
                      className="cursor-pointer accent-md-primary"
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold tracking-wider uppercase text-md-primary">Status</th>
                  {displayCols.map(col => (
                    <th
                      key={typeof col === 'string' ? col : col.key}
                      className="px-3 py-2 text-left text-[10px] font-bold tracking-wider uppercase text-md-primary"
                    >
                      {typeof col === 'string' ? col : col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const status = row._status || 'unchanged';
                  const style = STATUS_STYLES[status] || STATUS_STYLES.unchanged;
                  const isChangeable = status !== 'unchanged';

                  return (
                    <tr
                      key={ri}
                      className={`border-b transition-colors duration-100 ${isDark ? 'border-white/[0.03]' : 'border-gray-100'}`}
                      style={{ background: style.bg(isDark) }}
                    >
                      <td className="px-3 py-2 w-8">
                        {isChangeable ? (
                          <input
                            type="checkbox"
                            checked={selected.has(ri)}
                            onChange={() => toggleRow(ri)}
                            className="cursor-pointer accent-md-primary"
                          />
                        ) : (
                          <span className="block w-4" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                          style={{
                            background: isDark ? `${style.color}1F` : `${style.color}1A`,
                            color: style.color,
                          }}
                        >
                          {style.label}
                        </span>
                      </td>
                      {displayCols.map(col => {
                        const key = typeof col === 'string' ? col : col.key;
                        const val = row[key];
                        const changed = row._changes && row._changes[key];
                        return (
                          <td
                            key={key}
                            className={`px-3 py-2 text-[11px] ${isDark ? 'text-md-on-surface' : 'text-gray-800'}`}
                          >
                            {changed ? (
                              <span>
                                <span className="line-through opacity-50 mr-1">{changed.old}</span>
                                <span style={{ color: M3.warning }} className="font-medium">{changed.new}</span>
                              </span>
                            ) : (
                              <span className="block truncate">{val != null ? String(val) : '-'}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Empty state */}
      {!previewMut.isPending && rows.length === 0 && csvText && previewMut.isSuccess && (
        <div className={`text-center py-12 text-[12px] ${mutedText}`}>
          No changes detected in the CSV file.
        </div>
      )}
    </div>
  );
}
