import { useState, useCallback, useRef } from 'react';
import { useAdminSymbols, useAdminSymbolMutation } from '../../hooks/useAdminApi';

const CATEGORIES = [
  { id: 'instrument', label: 'Instrument', color: '#F39C12' },
  { id: 'valve', label: 'Valve', color: '#E74C3C' },
  { id: 'pump', label: 'Pump', color: '#3BE494' },
  { id: 'equipment', label: 'Equipment', color: '#3BE494' },
  { id: 'piping', label: 'Piping', color: '#2D33E0' },
  { id: 'general', label: 'General', color: '#94A3B8' },
];

const ACCEPTED_TYPES = '.png,.jpg,.jpeg,.tif,.tiff,.webp';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const base64 = String(result).split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function SymbolThumb({ symbol, size = 40 }) {
  if (!symbol?.imageUrl) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed text-[9px]"
        style={{ width: size, height: size, color: 'var(--md-on-surface-variant)', borderColor: 'var(--md-outline-variant)' }}
      >
        No img
      </div>
    );
  }
  return (
    <img
      src={symbol.imageUrl}
      alt={symbol.label}
      className="rounded object-contain bg-white/5"
      style={{ width: size, height: size, border: '1px solid var(--md-outline-variant)' }}
    />
  );
}

export default function SymbolLibraryManager() {
  const { data: symbols = [], isLoading, refetch } = useAdminSymbols();
  const mutation = useAdminSymbolMutation();
  const fileInputRef = useRef(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ label: '', abbr: '', category: 'equipment', keywords: '' });
  const [error, setError] = useState(null);
  const [filterCat, setFilterCat] = useState('all');
  const [search, setSearch] = useState('');

  const resetForm = () => {
    setForm({ label: '', abbr: '', category: 'equipment', keywords: '' });
    setEditing(null);
    setShowForm(false);
    setError(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (sym) => {
    setEditing(sym);
    setForm({
      label: sym.label || '',
      abbr: sym.abbr || '',
      category: sym.categoryId || sym.category || 'equipment',
      keywords: (sym.keywords || []).join(', '),
    });
    setShowForm(true);
    setError(null);
  };

  const handleSave = async () => {
    if (!form.label.trim()) {
      setError('Symbol name is required');
      return;
    }
    setError(null);
    try {
      const payload = {
        label: form.label.trim(),
        abbr: form.abbr.trim() || undefined,
        category: form.category,
        keywords: form.keywords
          ? form.keywords.split(',').map((k) => k.trim()).filter(Boolean)
          : [],
      };
      if (editing) {
        await mutation.update(editing.dbId, payload);
      } else {
        await mutation.create(payload);
      }
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save symbol');
    }
  };

  const handleDelete = async (sym) => {
    if (!window.confirm(`Delete symbol "${sym.label}"?`)) return;
    try {
      await mutation.remove(sym.dbId);
    } catch (err) {
      setError(err.message || 'Failed to delete symbol');
    }
  };

  const handleToggleActive = async (sym) => {
    try {
      await mutation.update(sym.dbId, { is_active: !sym.isActive });
    } catch (err) {
      setError(err.message || 'Failed to update symbol');
    }
  };

  const handleUploadClick = (sym) => {
    setEditing(sym);
    fileInputRef.current?.click();
  };

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editing) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp'].includes(ext)) {
      setError('Supported formats: PNG, JPG, TIF, TIFF, WEBP');
      return;
    }

    setError(null);
    try {
      const base64 = await fileToBase64(file);
      await mutation.upload(editing.dbId, {
        file: base64,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
      });
      await refetch();
    } catch (err) {
      setError(err.message || 'Failed to upload symbol image');
    }
  }, [editing, mutation, refetch]);

  const filtered = symbols.filter((sym) => {
    if (filterCat !== 'all' && sym.categoryId !== filterCat) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [sym.label, sym.abbr, sym.id, ...(sym.keywords || [])].join(' ').toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--md-surface)' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="px-4 py-3 shrink-0 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--md-outline-variant)' }}>
        <div>
          <h1 className="text-sm font-bold" style={{ color: 'var(--md-on-surface)' }}>P&ID Symbol Library</h1>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--md-on-surface-variant)' }}>
            Create custom symbols for Smart Identification — upload PNG, JPG, or TIF
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold"
          style={{ background: 'var(--md-primary)', color: 'var(--md-on-primary)' }}
        >
          + New Symbol
        </button>
      </div>

      <div className="px-4 py-2 shrink-0 flex flex-wrap items-center gap-2" style={{ borderBottom: '1px solid var(--md-outline-variant)' }}>
        <input
          type="search"
          placeholder="Search symbols…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] max-w-xs px-3 py-1.5 rounded-lg text-[11px]"
          style={{ background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface)', border: '1px solid var(--md-outline-variant)' }}
        />
        <button
          type="button"
          onClick={() => setFilterCat('all')}
          className="px-2 py-1 rounded text-[9px] font-bold"
          style={{
            background: filterCat === 'all' ? 'var(--md-primary-container)' : 'transparent',
            color: filterCat === 'all' ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
          }}
        >
          All ({symbols.length})
        </button>
        {CATEGORIES.map((cat) => {
          const count = symbols.filter((s) => s.categoryId === cat.id).length;
          if (!count) return null;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setFilterCat(cat.id)}
              className="px-2 py-1 rounded text-[9px] font-bold"
              style={{
                background: filterCat === cat.id ? `${cat.color}20` : 'transparent',
                color: filterCat === cat.id ? cat.color : 'var(--md-on-surface-variant)',
              }}
            >
              {cat.label} ({count})
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-lg text-[11px] shrink-0" style={{ background: '#E74C3C20', color: '#FF897A' }}>
          {error}
        </div>
      )}

      {showForm && (
        <div className="mx-4 mt-3 p-3 rounded-xl shrink-0" style={{ background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)' }}>
          <div className="text-[11px] font-bold mb-2" style={{ color: 'var(--md-on-surface)' }}>
            {editing ? 'Edit Symbol' : 'Create Symbol'}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Symbol name *"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              className="px-3 py-1.5 rounded-lg text-[11px]"
              style={{ background: 'var(--md-surface)', color: 'var(--md-on-surface)', border: '1px solid var(--md-outline-variant)' }}
            />
            <input
              type="text"
              placeholder="Abbreviation (e.g. CV)"
              value={form.abbr}
              onChange={(e) => setForm((f) => ({ ...f, abbr: e.target.value }))}
              className="px-3 py-1.5 rounded-lg text-[11px]"
              style={{ background: 'var(--md-surface)', color: 'var(--md-on-surface)', border: '1px solid var(--md-outline-variant)' }}
            />
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="px-3 py-1.5 rounded-lg text-[11px]"
              style={{ background: 'var(--md-surface)', color: 'var(--md-on-surface)', border: '1px solid var(--md-outline-variant)' }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Keywords (comma-separated)"
              value={form.keywords}
              onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
              className="px-3 py-1.5 rounded-lg text-[11px]"
              style={{ background: 'var(--md-surface)', color: 'var(--md-on-surface)', border: '1px solid var(--md-outline-variant)' }}
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={handleSave} disabled={mutation.isCreating || mutation.isUpdating} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: 'var(--md-primary)', color: 'var(--md-on-primary)' }}>
              {editing ? 'Save' : 'Create'}
            </button>
            <button type="button" onClick={resetForm} className="px-3 py-1.5 rounded-lg text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {isLoading ? (
          <p className="text-center text-[11px] py-8" style={{ color: 'var(--md-on-surface-variant)' }}>Loading symbols…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-[40px] opacity-30" style={{ color: 'var(--md-on-surface-variant)' }}>category</span>
            <p className="text-[11px] mt-2" style={{ color: 'var(--md-on-surface-variant)' }}>
              {symbols.length === 0 ? 'No custom symbols yet. Create one and upload a PNG or TIF image.' : 'No symbols match your filter.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((sym) => {
              const cat = CATEGORIES.find((c) => c.id === sym.categoryId);
              return (
                <div
                  key={sym.dbId}
                  className="rounded-xl p-3 flex gap-3"
                  style={{ background: 'var(--md-surface-container-high)', border: `1px solid ${sym.isActive ? 'var(--md-outline-variant)' : '#E74C3C40'}` }}
                >
                  <SymbolThumb symbol={sym} size={56} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-bold truncate" style={{ color: 'var(--md-on-surface)' }}>{sym.label}</span>
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0" style={{ background: `${cat?.color || '#94A3B8'}20`, color: cat?.color }}>
                        {sym.abbr}
                      </span>
                    </div>
                    <div className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--md-on-surface-variant)' }}>
                      {sym.id} · {cat?.label}
                    </div>
                    {!sym.isActive && (
                      <div className="text-[9px] mt-1 font-semibold" style={{ color: '#FF897A' }}>Inactive</div>
                    )}
                    <div className="flex flex-wrap gap-1 mt-2">
                      <button type="button" onClick={() => handleUploadClick(sym)} className="px-2 py-0.5 rounded text-[9px] font-semibold" style={{ background: 'var(--md-primary-container)', color: 'var(--md-primary)' }}>
                        Upload image
                      </button>
                      <button type="button" onClick={() => openEdit(sym)} className="px-2 py-0.5 rounded text-[9px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                        Edit
                      </button>
                      <button type="button" onClick={() => handleToggleActive(sym)} className="px-2 py-0.5 rounded text-[9px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                        {sym.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" onClick={() => handleDelete(sym)} className="px-2 py-0.5 rounded text-[9px]" style={{ color: '#FF897A' }}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
