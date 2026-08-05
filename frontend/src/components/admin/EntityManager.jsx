import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../context/ThemeContext';

const PAGE_SIZE = 50;

function CellEditor({ column, value, onChange }) {
  if (column.type === 'select' && column.options) {
    return (
      <select
        value={value || ''}
        onChange={e => onChange(column.key, e.target.value)}
        className="w-full px-2 py-1 rounded-md text-[11px] outline-none border transition-colors cursor-pointer"
        style={{
          background: 'var(--md-surface-container-high)',
          borderColor: 'var(--md-outline-variant)',
          color: 'var(--md-on-surface)',
        }}
      >
        <option value="">--</option>
        {column.options.map(opt => (
          <option key={opt.value ?? opt} value={opt.value ?? opt}>
            {opt.label ?? opt}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      value={value || ''}
      onChange={e => onChange(column.key, e.target.value)}
      className="w-full px-2 py-1 rounded-md text-[11px] outline-none border transition-colors"
      style={{
        background: 'var(--md-surface-container-high)',
        borderColor: 'var(--md-outline-variant)',
        color: 'var(--md-on-surface)',
      }}
      autoFocus={column.autoFocus}
    />
  );
}

// Generate CSV template string from columns
function generateTemplate(columns, title) {
  const headers = columns.filter(c => c.editable !== false).map(c => c.label);
  return `${headers.join(',')}\n`;
}

// Generate CSV export from data
function exportToCsv(columns, data, title) {
  const headers = columns.map(c => c.label);
  const rows = data.map(row =>
    columns.map(c => {
      const val = (row[c.key] ?? '').toString().replace(/"/g, '""');
      return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val;
    })
  );
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/\s+/g, '_')}_export.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EntityManager({
  title,
  icon,
  accentColor = 'var(--md-primary)',
  accentHex = '#4FE2B0',
  columns,
  data = [],
  onAdd,
  onUpdate,
  onDelete,
  onImport,
  onExport,
  exportUrl,
  linkageData,
  columnGroups,
  isRowEditable,
}) {
  const { isDark } = useTheme();
  const fileInputRef = useRef(null);
  const tableRef = useRef(null);

  const [sort, setSort] = useState({ col: null, asc: true });
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(0);
  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Column visibility
  const [hiddenCols, setHiddenCols] = useState(new Set());
  const [showColMenu, setShowColMenu] = useState(false);
  const colMenuBtnRef = useRef(null);
  const [colMenuPos, setColMenuPos] = useState({ top: 0, left: 0 });

  // Column widths (resizable)
  const [colWidths, setColWidths] = useState({});
  const resizing = useRef(null);

  const visibleColumns = useMemo(
    () => columns.filter(c => !hiddenCols.has(c.key)),
    [columns, hiddenCols]
  );

  // Recompute column groups for visible columns
  const visibleColumnGroups = useMemo(() => {
    if (!columnGroups) return null;
    const groups = [];
    let colIdx = 0;
    for (const grp of columnGroups) {
      let visibleSpan = 0;
      for (let i = 0; i < grp.span && colIdx < columns.length; i++, colIdx++) {
        if (!hiddenCols.has(columns[colIdx].key)) visibleSpan++;
      }
      if (visibleSpan > 0) groups.push({ ...grp, span: visibleSpan });
    }
    return groups.length > 0 ? groups : null;
  }, [columnGroups, columns, hiddenCols]);

  const toggleSort = useCallback((col) => {
    setSort(prev => ({ col, asc: prev.col === col ? !prev.asc : true }));
  }, []);

  const toggleColVisibility = useCallback((key) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Column resize handlers
  const handleResizeStart = useCallback((e, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey] || columns.find(c => c.key === colKey)?.minWidth || 80;
    resizing.current = { colKey, startX, startWidth };

    const onMove = (me) => {
      if (!resizing.current) return;
      const diff = me.clientX - resizing.current.startX;
      const newWidth = Math.max(40, resizing.current.startWidth + diff);
      setColWidths(prev => ({ ...prev, [resizing.current.colKey]: newWidth }));
    };
    const onUp = () => {
      resizing.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [colWidths, columns]);

  const filteredAndSorted = useMemo(() => {
    let rows = [...data];
    Object.entries(filters).forEach(([key, val]) => {
      if (val) {
        const q = val.toLowerCase();
        rows = rows.filter(d => (d[key] ?? '').toString().toLowerCase().includes(q));
      }
    });
    if (sort.col) {
      rows.sort((a, b) => {
        const va = (a[sort.col] ?? '').toString().toLowerCase();
        const vb = (b[sort.col] ?? '').toString().toLowerCase();
        return sort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return rows;
  }, [data, filters, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const pageRows = filteredAndSorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [filters]);

  const handleNewRowChange = (key, value) => setNewRow(p => ({ ...p, [key]: value }));
  const handleSaveNewRow = () => { if (onAdd) onAdd(newRow); setNewRow({}); setAddingRow(false); };
  const handleStartEdit = (row) => {
    setEditingId(row.id);
    const vals = {};
    columns.forEach(col => { vals[col.key] = row[col.key] ?? ''; });
    setEditValues(vals);
  };
  const handleEditChange = (key, value) => setEditValues(p => ({ ...p, [key]: value }));
  const handleSaveEdit = () => { if (onUpdate && editingId) onUpdate(editingId, editValues); setEditingId(null); setEditValues({}); };
  const handleCancelEdit = () => { setEditingId(null); setEditValues({}); };
  const handleDelete = (id) => { if (onDelete) onDelete(id); setDeleteConfirmId(null); };

  const handleImportClick = () => fileInputRef.current?.click();
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;
    const reader = new FileReader();
    reader.onload = (evt) => onImport(evt.target.result);
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDownloadTemplate = () => {
    const csv = generateTemplate(columns, title);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    exportToCsv(visibleColumns, filteredAndSorted, title);
  };

  const getCellColor = (col, value) => {
    if (col.colorMap && value && col.colorMap[value]) return col.colorMap[value];
    return null;
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const getColWidth = (col) => colWidths[col.key] || col.minWidth || 80;
  const totalTableWidth = visibleColumns.reduce((sum, c) => sum + getColWidth(c), 0) + 80; // +80 for actions

  return (
    <div className="flex-1 flex flex-col" style={{ background: 'var(--md-surface)', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      {/* ── Card Header ── */}
      <div
        className="px-4 py-2 flex items-center gap-3 shrink-0"
        style={{
          background: 'var(--md-surface-container)',
          borderBottom: '1px solid var(--md-outline-variant)',
        }}
      >
        {/* Icon + Title */}
        <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${accentHex}15` }}>
          <span className="material-symbols-outlined text-[16px]" style={{ color: accentHex }}>{icon || 'list_alt'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-bold leading-tight" style={{ color: 'var(--md-on-surface)' }}>{title}</span>
          <span className="text-[10px] leading-tight" style={{ color: 'var(--md-on-surface-variant)' }}>
            {filteredAndSorted.length} of {data.length} records{hasActiveFilters ? ' (filtered)' : ''}
          </span>
        </div>

        <div className="flex-1" />

        {/* Clear filters */}
        {hasActiveFilters && (
          <button onClick={() => setFilters({})} className="md-chip cursor-pointer transition-colors" style={{ color: 'var(--md-error)', background: 'var(--md-error-container)' }}>
            <span className="material-symbols-outlined text-[14px]">filter_alt_off</span> Clear
          </button>
        )}

        {/* Column visibility toggle */}
        <div className="relative">
          <button
            ref={colMenuBtnRef}
            onClick={() => {
              if (!showColMenu && colMenuBtnRef.current) {
                const rect = colMenuBtnRef.current.getBoundingClientRect();
                setColMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 220) });
              }
              setShowColMenu(prev => !prev);
            }}
            className="md-chip cursor-pointer md-interactive"
            style={{ color: 'var(--md-on-surface-variant)', border: '1px solid var(--md-outline-variant)' }}
            title="Show/hide columns"
          >
            <span className="material-symbols-outlined text-[14px]">view_column</span>
            Columns
            {hiddenCols.size > 0 && (
              <span className="text-[9px] px-1 rounded-full" style={{ background: `${accentHex}30`, color: accentHex }}>
                {columns.length - hiddenCols.size}/{columns.length}
              </span>
            )}
          </button>

          {showColMenu && createPortal(
            <>
              <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setShowColMenu(false)} />
              <div
                className="fixed rounded-lg shadow-xl border max-h-[400px] overflow-y-auto"
                style={{
                  zIndex: 9999,
                  top: colMenuPos.top,
                  left: colMenuPos.left,
                  background: 'var(--md-surface-container-high)',
                  borderColor: 'var(--md-outline-variant)',
                  width: 220,
                }}
              >
                <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--md-outline-variant)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--md-on-surface-variant)' }}>Toggle Columns</span>
                  <button
                    onClick={() => setHiddenCols(new Set())}
                    className="text-[10px] cursor-pointer"
                    style={{ color: accentHex }}
                  >
                    Show All
                  </button>
                </div>
                {columns.map(col => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenCols.has(col.key)}
                      onChange={() => toggleColVisibility(col.key)}
                      className="accent-emerald-400"
                    />
                    <span className="text-[11px]" style={{ color: 'var(--md-on-surface)' }}>
                      {col.shortLabel || col.label}
                    </span>
                  </label>
                ))}
              </div>
            </>,
            document.body
          )}
        </div>

        {/* Template */}
        <button onClick={handleDownloadTemplate} className="md-chip cursor-pointer md-interactive" style={{ color: 'var(--md-on-surface-variant)', border: '1px solid var(--md-outline-variant)' }}>
          <span className="material-symbols-outlined text-[14px]">file_download</span> Template
        </button>

        {/* Import */}
        {onImport && (
          <>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx" onChange={handleFileChange} className="hidden" />
            <button onClick={handleImportClick} className="md-chip cursor-pointer md-interactive" style={{ color: 'var(--md-secondary)', border: '1px solid var(--md-secondary-container)' }}>
              <span className="material-symbols-outlined text-[14px]">upload_file</span> Import
            </button>
          </>
        )}

        {/* Export */}
        <button onClick={handleExportCsv} className="md-chip cursor-pointer md-interactive" style={{ color: 'var(--md-primary)', border: '1px solid var(--md-primary-container)' }}>
          <span className="material-symbols-outlined text-[14px]">download</span> Export
        </button>

        {/* Add */}
        <button onClick={() => { setAddingRow(true); setNewRow({}); }} className="md-chip cursor-pointer md-interactive" style={{ background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' }}>
          <span className="material-symbols-outlined text-[14px]">add</span> Add
        </button>
      </div>

      {/* ── Scrollable Table — both directions ── */}
      <div ref={tableRef} className="flex-1" style={{ overflow: 'auto', height: 0, minWidth: 0 }}>
        <table className="border-collapse" style={{ minWidth: totalTableWidth, tableLayout: 'fixed', width: Math.max(totalTableWidth, 0) }}>
          <colgroup>
            {linkageData && <col style={{ width: 32 }} />}
            {visibleColumns.map(col => (
              <col key={col.key} style={{ width: getColWidth(col) }} />
            ))}
            <col style={{ width: 80 }} />
          </colgroup>

          <thead>
            {/* Column group headers */}
            {visibleColumnGroups && (
              <tr className="sticky top-0 z-30" style={{ background: 'var(--md-surface-container)' }}>
                {linkageData && <th style={{ width: 32 }} />}
                {visibleColumnGroups.map((grp, gi) => (
                  <th
                    key={gi}
                    colSpan={grp.span}
                    className="px-2 py-1 text-center text-[9px] font-bold uppercase tracking-widest"
                    style={{
                      color: grp.color || accentHex,
                      background: `${grp.color || accentHex}08`,
                      borderLeft: gi > 0 ? '2px solid var(--md-outline-variant)' : 'none',
                      borderBottom: `2px solid ${accentHex}30`,
                    }}
                  >
                    {grp.label}
                  </th>
                ))}
                <th style={{ width: 80, borderBottom: `2px solid ${accentHex}30` }} />
              </tr>
            )}

            {/* Header row with sort + resize handles */}
            <tr
              className="sticky z-20"
              style={{
                top: visibleColumnGroups ? 26 : 0,
                background: `${accentHex}0d`,
                borderBottom: `1px solid ${accentHex}30`,
              }}
            >
              {linkageData && <th className="px-1 py-1.5" style={{ width: 32 }} />}
              {visibleColumns.map(col => (
                <th
                  key={col.key}
                  className="px-1 py-1.5 text-left select-none whitespace-nowrap relative group"
                  style={{ width: getColWidth(col) }}
                >
                  <span
                    className="flex items-center gap-0.5 cursor-pointer hover:opacity-80"
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: accentHex }}>
                      {col.shortLabel || col.label}
                    </span>
                    {sort.col === col.key && (
                      <span className="text-[8px]" style={{ color: accentHex }}>{sort.asc ? '\u25B2' : '\u25BC'}</span>
                    )}
                  </span>
                  {/* Resize handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: `${accentHex}40` }}
                    onMouseDown={e => handleResizeStart(e, col.key)}
                  />
                </th>
              ))}
              <th className="px-1 py-1.5 text-left" style={{ width: 80 }}>
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: accentHex }}>Actions</span>
              </th>
            </tr>

            {/* Filter row */}
            <tr
              className="sticky z-20"
              style={{
                top: visibleColumnGroups ? 52 : 26,
                background: 'var(--md-surface-container-high)',
                borderBottom: '1px solid var(--md-outline-variant)',
              }}
            >
              {linkageData && <th className="px-1 py-1" style={{ width: 32 }} />}
              {visibleColumns.map(col => (
                <th key={col.key} className="px-1 py-1 font-normal">
                  <input
                    value={filters[col.key] || ''}
                    onChange={e => setFilters(p => ({ ...p, [col.key]: e.target.value }))}
                    placeholder={col.shortLabel || col.label}
                    className="w-full px-1.5 py-0.5 rounded text-[10px] outline-none border transition-colors duration-100"
                    style={{
                      background: 'var(--md-surface-container)',
                      borderColor: filters[col.key] ? `${accentHex}60` : 'var(--md-outline-variant)',
                      color: 'var(--md-on-surface)',
                    }}
                  />
                </th>
              ))}
              <th className="px-1 py-1 font-normal" style={{ width: 80 }} />
            </tr>
          </thead>

          <tbody>
            {/* Add new row */}
            {addingRow && (
              <tr style={{ background: `${accentHex}08`, borderBottom: `1px solid ${accentHex}30` }}>
                {linkageData && <td className="px-1 py-1" />}
                {visibleColumns.map(col => (
                  <td key={col.key} className="px-1 py-1">
                    {col.editable !== false ? (
                      <CellEditor column={col} value={newRow[col.key]} onChange={handleNewRowChange} />
                    ) : (
                      <span className="text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>--</span>
                    )}
                  </td>
                ))}
                <td className="px-1 py-1">
                  <div className="flex items-center gap-1">
                    <button onClick={handleSaveNewRow} className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer" style={{ background: `${accentHex}20`, color: accentHex }}>Save</button>
                    <button onClick={() => { setAddingRow(false); setNewRow({}); }} className="px-2 py-0.5 rounded text-[10px] cursor-pointer" style={{ color: 'var(--md-on-surface-variant)' }}>Cancel</button>
                  </div>
                </td>
              </tr>
            )}

            {/* Empty state */}
            {pageRows.length === 0 && !addingRow && (
              <tr>
                <td colSpan={visibleColumns.length + (linkageData ? 2 : 1)} className="text-center py-16">
                  <div className="flex flex-col items-center gap-2">
                    <span className="material-symbols-outlined text-[32px]" style={{ color: 'var(--md-on-surface-variant)', opacity: 0.3 }}>inbox</span>
                    <span className="text-[12px]" style={{ color: 'var(--md-on-surface-variant)' }}>No records found</span>
                  </div>
                </td>
              </tr>
            )}

            {/* Data rows */}
            {pageRows.map((row, ri) => {
              const isEditing = editingId === row.id;

              return (
                <tr
                  key={row.id || ri}
                  className="transition-colors duration-100 cursor-default"
                  style={{
                    borderBottom: '1px solid var(--md-outline-variant)',
                    background: ri % 2 !== 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${accentHex}06`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ri % 2 !== 0 ? 'rgba(255,255,255,0.015)' : 'transparent'; }}
                >
                  {linkageData && (
                    <td className="px-1 py-1 text-center" style={{ width: 32 }}>
                      {linkageData.linked?.has?.(row.id)
                        ? <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--md-primary)' }} />
                        : linkageData.unlinked?.has?.(row.id)
                        ? <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--md-error)' }} />
                        : <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--md-outline-variant)' }} />
                      }
                    </td>
                  )}

                  {visibleColumns.map(col => {
                    const raw = isEditing ? editValues[col.key] : (row[col.key] ?? '');
                    const val = raw.toString();
                    const cellColor = getCellColor(col, row[col.key]);

                    return (
                      <td key={col.key} className="px-1 py-1 text-[11px] overflow-hidden" style={{ color: 'var(--md-on-surface)', maxWidth: getColWidth(col) }} title={val}>
                        {isEditing && col.editable !== false ? (
                          <CellEditor column={col} value={editValues[col.key]} onChange={handleEditChange} />
                        ) : cellColor ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block whitespace-nowrap" style={{ background: `${cellColor}18`, color: cellColor }}>
                            {val.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          <span className="block truncate">{val.replace(/_/g, ' ')}</span>
                        )}
                      </td>
                    );
                  })}

                  {/* Actions */}
                  <td className="px-1 py-1" style={{ width: 80 }}>
                    {(() => {
                      const canEdit = !isRowEditable || isRowEditable(row);
                      return (
                        <div className="flex items-center gap-0.5">
                          {isEditing ? (
                            <>
                              <button onClick={handleSaveEdit} className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer" style={{ background: `${accentHex}20`, color: accentHex }}>Save</button>
                              <button onClick={handleCancelEdit} className="px-2 py-0.5 rounded text-[10px] cursor-pointer" style={{ color: 'var(--md-on-surface-variant)' }}>Cancel</button>
                            </>
                          ) : deleteConfirmId === row.id ? (
                            <>
                              <span className="text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>Delete?</span>
                              <button onClick={() => handleDelete(row.id)} className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer" style={{ background: 'var(--md-error-container)', color: 'var(--md-error)' }}>Yes</button>
                              <button onClick={() => setDeleteConfirmId(null)} className="px-2 py-0.5 rounded text-[10px] cursor-pointer" style={{ color: 'var(--md-on-surface-variant)' }}>No</button>
                            </>
                          ) : canEdit ? (
                            <>
                              <button onClick={() => handleStartEdit(row)} className="p-1 rounded transition-colors cursor-pointer md-interactive" style={{ color: 'var(--md-on-surface-variant)' }} title="Edit">
                                <span className="material-symbols-outlined text-[14px]">edit</span>
                              </button>
                              <button onClick={() => setDeleteConfirmId(row.id)} className="p-1 rounded transition-colors cursor-pointer md-interactive" style={{ color: 'var(--md-on-surface-variant)' }} title="Delete">
                                <span className="material-symbols-outlined text-[14px]">delete</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => { if (onUpdate) onUpdate(row.id, { ...row, status: 'draft' }); }}
                              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium cursor-pointer transition-colors hover:opacity-80"
                              style={{ background: 'rgba(138,180,255,0.1)', color: 'var(--md-secondary)', border: '1px solid rgba(138,180,255,0.2)' }}
                              title="Change status to Draft to enable editing"
                            >
                              <span className="material-symbols-outlined text-[12px] align-middle mr-0.5">lock_open</span> Unlock
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer with pagination ── */}
      <div
        className="px-4 py-1.5 flex items-center gap-3 shrink-0"
        style={{
          background: 'var(--md-surface-container)',
          borderTop: '1px solid var(--md-outline-variant)',
        }}
      >
        <span className="text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>
          {filteredAndSorted.length > 0
            ? `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, filteredAndSorted.length)} of ${filteredAndSorted.length}`
            : '0 records'
          }
        </span>

        <span className="text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>
          {visibleColumns.length}/{columns.length} columns
        </span>

        <div className="flex-1" />

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0} className="p-1 rounded transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-default md-interactive" style={{ color: 'var(--md-on-surface-variant)' }}>
              <span className="material-symbols-outlined text-[16px]">first_page</span>
            </button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 rounded transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-default md-interactive" style={{ color: 'var(--md-on-surface-variant)' }}>
              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
            </button>
            <span className="text-[10px] px-2 font-medium" style={{ color: 'var(--md-on-surface)' }}>
              {page + 1} / {totalPages}
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1 rounded transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-default md-interactive" style={{ color: 'var(--md-on-surface-variant)' }}>
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="p-1 rounded transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-default md-interactive" style={{ color: 'var(--md-on-surface-variant)' }}>
              <span className="material-symbols-outlined text-[16px]">last_page</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
