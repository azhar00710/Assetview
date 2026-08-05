import { useState, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { STC } from '../../data/constants';
import {
  useAdminPnids,
  usePnidMutation,
  usePnidSystemMutation,
  useAdminSystems,
  usePnidUpload,
  usePnidVersions,
  useExportUrl,
  useImport,
} from '../../hooks/useAdminApi';
import EntityManager from './EntityManager';

const STATUS_COLORS = {
  draft: '#FFB068',
  approved: '#1a73e8',
  as_built: '#34a853',
  Draft: '#FFB068',
  Approved: '#1a73e8',
  'As-Built': '#34a853',
};

const COLUMNS = [
  { key: 'drawing_number', label: 'Drawing Number', shortLabel: 'Drawing No', editable: true, minWidth: 140 },
  { key: 'title', label: 'Title', shortLabel: 'Title', editable: true, minWidth: 180 },
  { key: 'revision', label: 'Revision', shortLabel: 'Rev', editable: true, minWidth: 50 },
  { key: 'revision_date', label: 'Rev Date', shortLabel: 'Rev Date', editable: true, minWidth: 80 },
  {
    key: 'status',
    label: 'Status',
    shortLabel: 'Status',
    editable: true,
    type: 'select',
    options: [
      { value: 'draft', label: 'Draft' },
      { value: 'approved', label: 'Approved' },
      { value: 'as_built', label: 'As-Built' },
    ],
    colorMap: STATUS_COLORS,
    minWidth: 80,
  },
  { key: 'primary_system_code', label: 'Primary System', shortLabel: 'Prim Sys', editable: false, minWidth: 80 },
  { key: 'transmittal_ref', label: 'Transmittal Reference', shortLabel: 'Transmittal', editable: true, minWidth: 120 },
  { key: 'sheet_number', label: 'Sheet', shortLabel: 'Sheet', editable: true, minWidth: 50 },
  { key: 'total_sheets', label: 'Total Sheets', shortLabel: 'Tot Sh', editable: true, minWidth: 50 },
  { key: 'has_file', label: 'File', shortLabel: 'File', editable: false, minWidth: 40 },
  { key: 'remarks', label: 'Remarks', shortLabel: 'Remarks', editable: true, minWidth: 120 },
];

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '-';
  const n = Number(bytes);
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Upload Modal ────────────────────────────────────────────────────────────

function UploadModal({ pnid, onClose, isDark }) {
  const uploadMut = usePnidUpload();
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [revision, setRevision] = useState(pnid?.revision || '');
  const [changeSummary, setChangeSummary] = useState('');
  const [changeType, setChangeType] = useState('minor_update');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  const cardBg = 'var(--md-surface-container)';
  const borderColor = 'var(--md-outline-variant)';
  const textPrimary = 'var(--md-on-surface)';
  const textSecondary = 'var(--md-on-surface-variant)';
  const inputBg = 'var(--md-surface-container-high)';

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setResult(null);
    try {
      const buffer = await selectedFile.arrayBuffer();
      const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
      const res = await uploadMut.upload({
        pnidId: pnid.id, file: base64, filename: selectedFile.name,
        contentType: selectedFile.type || 'application/pdf',
        revision: revision || undefined, changeSummary: changeSummary || undefined, changeType,
      });
      setResult({ ok: true, message: `Uploaded as version ${res.version?.versionNumber} (Rev ${res.version?.revision})` });
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-[480px] max-w-[90vw] rounded-2xl shadow-2xl"
        style={{ background: cardBg, border: `1px solid ${borderColor}` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5">
          <h3 className="text-[14px] font-bold mb-1" style={{ color: textPrimary, fontFamily: "'Google Sans', sans-serif" }}>Upload P&ID File</h3>
          <p className="text-[11px] mb-4" style={{ color: textSecondary }}>{pnid.drawing_number || pnid.drawingNumber} — {pnid.title}</p>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-medium mb-1" style={{ color: textSecondary }}>File (PDF, PNG, TIFF)</label>
              <input ref={fileInputRef} type="file" accept=".pdf,.png,.tiff,.tif,.jpg,.jpeg" onChange={handleFileSelect} className="hidden" />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-3 py-3 rounded-lg text-[11px] font-medium transition-colors cursor-pointer"
                style={{
                  border: `2px dashed ${selectedFile ? '#4FE2B040' : borderColor}`,
                  background: selectedFile ? 'rgba(79,226,176,0.05)' : 'transparent',
                  color: selectedFile ? '#4FE2B0' : textSecondary,
                }}
              >
                {selectedFile ? `${selectedFile.name} (${formatBytes(selectedFile.size)})` : 'Click to select file or drag & drop'}
              </button>
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-1" style={{ color: textSecondary }}>Revision</label>
              <input type="text" value={revision} onChange={e => setRevision(e.target.value)} placeholder={pnid.revision ? `Current: ${pnid.revision}` : 'e.g., Rev 5'}
                className="w-full px-3 py-2 rounded-lg text-[12px] outline-none transition-colors" style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textPrimary }} />
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-1" style={{ color: textSecondary }}>Change Type</label>
              <select value={changeType} onChange={e => setChangeType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-[12px] outline-none transition-colors cursor-pointer" style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textPrimary }}>
                <option value="minor_update">Minor Update</option>
                <option value="equipment_change">Equipment Change</option>
                <option value="layout_change">Layout Change</option>
                <option value="full_redraw">Full Redraw</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-1" style={{ color: textSecondary }}>Change Summary (optional)</label>
              <textarea value={changeSummary} onChange={e => setChangeSummary(e.target.value)} placeholder="Describe changes..." rows={2}
                className="w-full px-3 py-2 rounded-lg text-[12px] outline-none transition-colors resize-none" style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textPrimary }} />
            </div>
            {result && (
              <div className="px-3 py-2 rounded-lg text-[11px] font-medium" style={{
                background: result.ok ? 'rgba(52,168,83,0.1)' : 'rgba(255,137,122,0.1)',
                color: result.ok ? '#34a853' : '#FF897A',
                border: `1px solid ${result.ok ? 'rgba(52,168,83,0.2)' : 'rgba(255,137,122,0.2)'}`,
              }}>{result.message}</div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: `1px solid ${borderColor}` }}>
          <button onClick={onClose} className="px-4 py-2 rounded-full text-[11px] font-semibold transition-colors cursor-pointer" style={{ color: textSecondary }}>{result?.ok ? 'Done' : 'Cancel'}</button>
          {!result?.ok && (
            <button onClick={handleUpload} disabled={!selectedFile || uploading}
              className="px-4 py-2 rounded-full text-[11px] font-semibold transition-colors cursor-pointer"
              style={{ background: '#4FE2B0', color: '#ffffff', opacity: (!selectedFile || uploading) ? 0.4 : 1 }}>
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Version History Panel ───────────────────────────────────────────────────

function VersionHistory({ pnidId, isDark }) {
  const { data: versionsData, isLoading } = usePnidVersions(pnidId);
  const versions = versionsData?.versions || [];
  const textSecondary = 'var(--md-on-surface-variant)';
  const textPrimary = 'var(--md-on-surface)';
  const borderColor = 'var(--md-outline-variant)';

  if (isLoading) return <div className="text-[10px] p-2" style={{ color: textSecondary }}>Loading versions...</div>;
  if (versions.length === 0) return <div className="text-[10px] p-2" style={{ color: textSecondary }}>No versions uploaded yet</div>;

  return (
    <div className="space-y-1.5">
      {versions.map(v => (
        <div key={v.id} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{
          border: `1px solid ${v.status === 'active' ? 'rgba(79,226,176,0.3)' : borderColor}`,
          background: v.status === 'active' ? 'rgba(79,226,176,0.05)' : 'transparent',
        }}>
          <div className="text-[10px] font-bold w-8 text-center" style={{ color: v.status === 'active' ? 'var(--md-primary)' : textSecondary }}>v{v.version_number}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold" style={{ color: textPrimary }}>
              Rev {v.revision}
              {v.status === 'active' && <span className="ml-2 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ color: 'var(--md-primary)', background: 'rgba(79,226,176,0.1)' }}>Active</span>}
              {v.status === 'superseded' && <span className="ml-2 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ color: textSecondary, background: 'var(--md-surface-container-high)' }}>Superseded</span>}
            </div>
            <div className="text-[9px]" style={{ color: textSecondary }}>{formatDate(v.created_at)}{v.change_summary && ` — ${v.change_summary}`}</div>
          </div>
          <div className="text-[9px]" style={{ color: textSecondary }}>{formatBytes(v.file_size_bytes)}</div>
        </div>
      ))}
    </div>
  );
}

// ─── P&ID System Assignment Section ──────────────────────────────────────────

function PnidSystemSection({ pnid, systems, isDark }) {
  const pnidSystemMut = usePnidSystemMutation();
  const [addingSystem, setAddingSystem] = useState(false);
  const [selectedSystemId, setSelectedSystemId] = useState('');

  const borderColor = 'var(--md-outline-variant)';
  const textSecondary = 'var(--md-on-surface-variant)';
  const inputBg = 'var(--md-surface-container-high)';

  const pnidSystems = pnid.systems || [];
  const availableSystems = (systems || []).filter(s => !pnidSystems.some(ps => ps.id === s.id));

  const handleAddSystem = async () => {
    if (!selectedSystemId) return;
    try { await pnidSystemMut.add(pnid.id, selectedSystemId, false); setAddingSystem(false); setSelectedSystemId(''); } catch (err) { console.error('Failed:', err); }
  };
  const handleRemoveSystem = async (systemId) => {
    try { await pnidSystemMut.remove(pnid.id, systemId); } catch (err) { console.error('Failed:', err); }
  };

  return (
    <div className="ml-8 mb-2 p-3 rounded-lg" style={{ border: `1px solid ${borderColor}`, background: 'var(--md-surface-container)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: textSecondary }}>Assigned Systems</span>
        <div className="flex-1" />
        <button onClick={() => setAddingSystem(!addingSystem)} className="text-[10px] font-medium cursor-pointer" style={{ color: 'var(--md-secondary)' }}>+ Add System</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pnidSystems.map(sys => (
          <div key={sys.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium" style={{
            background: sys.isPrimary ? 'rgba(138,180,255,0.1)' : 'var(--md-surface-container-high)',
            color: sys.isPrimary ? 'var(--md-secondary)' : 'var(--md-on-surface)',
            border: `1px solid ${sys.isPrimary ? 'rgba(138,180,255,0.3)' : borderColor}`,
          }}>
            <span>{sys.code || sys.name}</span>
            {sys.isPrimary && <span className="text-[8px] opacity-60">PRIMARY</span>}
            {!sys.isPrimary && <button onClick={() => handleRemoveSystem(sys.id)} className="text-[8px] font-bold cursor-pointer ml-0.5" style={{ color: 'var(--md-error)' }}>x</button>}
          </div>
        ))}
        {pnidSystems.length === 0 && <span className="text-[10px]" style={{ color: textSecondary }}>No systems assigned</span>}
      </div>
      {addingSystem && (
        <div className="flex items-center gap-2 mt-2">
          <select value={selectedSystemId} onChange={e => setSelectedSystemId(e.target.value)}
            className="px-2 py-1 rounded text-[11px] outline-none cursor-pointer" style={{ background: inputBg, border: `1px solid ${borderColor}`, color: 'var(--md-on-surface)' }}>
            <option value="">Select system...</option>
            {availableSystems.map(s => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
          </select>
          <button onClick={handleAddSystem} disabled={!selectedSystemId} className="px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer disabled:opacity-30" style={{ background: 'rgba(138,180,255,0.15)', color: 'var(--md-secondary)' }}>Add</button>
          <button onClick={() => { setAddingSystem(false); setSelectedSystemId(''); }} className="px-2.5 py-1 rounded text-[10px] cursor-pointer" style={{ color: textSecondary }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ─── Main PnidManager ────────────────────────────────────────────────────────

export default function PnidManager({ platformId }) {
  const { isDark } = useTheme();
  const { data: pnidsData } = useAdminPnids(platformId);
  const { data: systemsData } = useAdminSystems(platformId);
  const mutation = usePnidMutation();
  const importMut = useImport('pnids', platformId);
  const exportUrl = useExportUrl('pnids', platformId);

  const [expandedPnid, setExpandedPnid] = useState(null);
  const [uploadPnid, setUploadPnid] = useState(null);
  const [versionPnid, setVersionPnid] = useState(null);

  const pnids = pnidsData?.pnids || pnidsData?.data || pnidsData || [];
  const systems = systemsData?.systems || systemsData?.data || systemsData || [];

  const borderColor = 'var(--md-outline-variant)';
  const textSecondary = 'var(--md-on-surface-variant)';
  const cardBg = 'var(--md-surface-container)';

  const enhancedPnids = (Array.isArray(pnids) ? pnids : []).map(p => ({
    ...p,
    has_file: (p.has_image || p.storage_key) ? 'Yes' : '-',
  }));

  const handleAdd = async (item) => {
    try { await mutation.create({ ...item, platformId }); } catch (err) { console.error('Failed:', err); }
  };
  const handleUpdate = async (id, item) => {
    try { await mutation.update(id, item); } catch (err) { console.error('Failed:', err); }
  };
  const handleDelete = async (id) => {
    try { await mutation.remove(id); } catch (err) { console.error('Failed:', err); }
  };
  const handleImport = async (csvText) => {
    try { await importMut.mutateAsync(csvText); } catch (err) { console.error('Failed to import P&IDs:', err); }
  };

  // Draft P&IDs are editable; approved/as_built require changing to draft first
  const isRowEditable = (row) => {
    const status = (row.status || '').toLowerCase();
    return !status || status === 'draft';
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Entity Manager (table) with import/export */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
        <EntityManager
          title="P&ID List"
          icon="description"
          accentHex="#8AB4FF"
          columns={COLUMNS}
          data={enhancedPnids}
          onAdd={handleAdd}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onImport={handleImport}
          exportUrl={exportUrl}
          isRowEditable={isRowEditable}
        />
      </div>

      {/* Expanded section for selected P&ID */}
      {expandedPnid && (
        <div className="shrink-0 px-4 py-3 max-h-[40%] overflow-y-auto" style={{ borderTop: `1px solid ${borderColor}`, background: cardBg }}>
          {(() => {
            const pnid = enhancedPnids.find(p => p.id === expandedPnid);
            if (!pnid) return null;
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <button onClick={() => setUploadPnid(pnid)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold cursor-pointer"
                    style={{ background: 'rgba(79,226,176,0.15)', color: '#4FE2B0' }}>
                    <span className="material-symbols-outlined text-[14px]">upload_file</span> Upload File
                  </button>
                  <button onClick={() => setVersionPnid(prev => prev === pnid.id ? null : pnid.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold cursor-pointer"
                    style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f3f4', color: textSecondary }}>
                    <span className="material-symbols-outlined text-[14px]">history</span> Version History
                  </button>
                </div>
                <PnidSystemSection pnid={pnid} systems={Array.isArray(systems) ? systems : []} isDark={isDark} />
                {versionPnid === pnid.id && (
                  <div className="p-3 rounded-lg" style={{ border: `1px solid ${borderColor}`, background: isDark ? 'rgba(255,255,255,0.02)' : '#f8f9fa' }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: textSecondary }}>Version History</div>
                    <VersionHistory pnidId={pnid.id} isDark={isDark} />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {uploadPnid && <UploadModal pnid={uploadPnid} onClose={() => setUploadPnid(null)} isDark={isDark} />}
    </div>
  );
}
