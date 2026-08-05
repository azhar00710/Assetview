import { useState, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import {
  useTransmittals,
  useTransmittalMutation,
  useTransmittalUpload,
  useTransmittalClose,
} from '../../hooks/useAdminApi';

const STATUS_STYLES = {
  open: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Open' },
  in_review: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'In Review' },
  closed: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Closed' },
  draft: { bg: 'bg-gray-500/15', text: 'text-gray-400', label: 'Draft' },
};

const STATUS_STYLES_LIGHT = {
  open: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Open' },
  in_review: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: 'In Review' },
  closed: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Closed' },
  draft: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Draft' },
};

const DOC_STATUS = {
  draft: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', bgLight: 'bg-yellow-50', textLight: 'text-yellow-600', label: 'Draft' },
  approved: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', bgLight: 'bg-emerald-50', textLight: 'text-emerald-600', label: 'Approved' },
  rejected: { bg: 'bg-red-500/15', text: 'text-red-400', bgLight: 'bg-red-50', textLight: 'text-red-600', label: 'Rejected' },
};

function StatusBadge({ status, isDark }) {
  const styles = isDark ? STATUS_STYLES : STATUS_STYLES_LIGHT;
  const s = styles[status] || styles.draft;
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function DocStatusBadge({ status, isDark }) {
  const s = DOC_STATUS[status] || DOC_STATUS.pending;
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${isDark ? s.bg : s.bgLight} ${isDark ? s.text : s.textLight}`}>
      {s.label}
    </span>
  );
}

function parseDrawingNumber(filename) {
  // Try to extract drawing number and revision from filename
  // Common patterns: "PID-001-Rev2.pdf", "PID-001_R2.pdf", "PID-001-2.pdf"
  const name = filename.replace(/\.[^.]+$/, '');
  const revMatch = name.match(/[-_\s](?:Rev|R|rev|r)\.?(\w+)$/i);
  const revision = revMatch ? revMatch[1] : '0';
  const drawingNumber = revMatch ? name.slice(0, revMatch.index) : name;
  return { drawingNumber, revision };
}

export default function TransmittalManager({ platformId }) {
  const { isDark } = useTheme();
  const { data, isLoading, error } = useTransmittals(platformId);
  const transmittalMut = useTransmittalMutation();
  const uploadHook = useTransmittalUpload();
  const closeHook = useTransmittalClose();

  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newRef, setNewRef] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [uploadTab, setUploadTab] = useState('pnid');
  const [stagedFiles, setStagedFiles] = useState([]);

  const pnidFileRef = useRef(null);
  const csvFileRef = useRef(null);

  const transmittals = data?.transmittals || data?.data || data || [];
  const selected = transmittals.find(t => t.id === selectedId) || null;

  const fetchDetail = async (id) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/transmittals/${id}`);
      if (res.ok) {
        const detail = await res.json();
        setSelectedDetail(detail);
      }
    } catch (err) {
      console.error('Failed to load transmittal detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const selectTransmittal = (id) => {
    setSelectedId(id);
    if (id) fetchDetail(id);
    else setSelectedDetail(null);
  };

  const panelBg = isDark ? 'bg-md-surface-container' : 'bg-white';
  const borderC = isDark ? 'border-white/[0.06]' : 'border-gray-200';
  const mutedText = isDark ? 'text-md-on-surface-variant' : 'text-gray-500';
  const inputCls = isDark
    ? 'bg-md-surface-container-high border-white/[0.1] text-md-on-surface placeholder-white/20 focus:border-md-primary/50'
    : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-md-primary/60';
  const cardBg = isDark ? 'bg-white/[0.03]' : 'bg-gray-50';
  const hoverBg = isDark ? 'hover:bg-white/[0.05]' : 'hover:bg-gray-100';

  const handleCreateTransmittal = async () => {
    if (!newRef.trim()) return;
    try {
      const result = await transmittalMut.create({
        reference_number: newRef.trim(),
        description: newDesc.trim(),
        platform_id: platformId,
      });
      setNewRef('');
      setNewDesc('');
      setShowNewForm(false);
      if (result?.id) setSelectedId(result.id);
    } catch (err) {
      console.error('Create transmittal failed:', err);
    }
  };

  const handlePnidFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    const parsed = files.map(file => {
      const { drawingNumber, revision } = parseDrawingNumber(file.name);
      return {
        file,
        filename: file.name,
        type: 'pnid',
        identifier: drawingNumber,
        revision,
        status: 'pending',
      };
    });
    setStagedFiles(prev => [...prev, ...parsed]);
    if (pnidFileRef.current) pnidFileRef.current.value = '';
  };

  const handleCsvFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result;
        const lines = text.split('\n').filter(l => l.trim());
        const rowCount = Math.max(0, lines.length - 1); // subtract header
        setStagedFiles(prev => [...prev, {
          file,
          filename: file.name,
          type: 'csv',
          identifier: file.name.replace(/\.[^.]+$/, ''),
          revision: '-',
          rowCount,
          status: 'pending',
        }]);
      };
      reader.readAsText(file);
    });
    if (csvFileRef.current) csvFileRef.current.value = '';
  };

  const handleUploadAll = async () => {
    if (!selectedId || stagedFiles.length === 0) return;
    try {
      for (const staged of stagedFiles) {
        const formData = new FormData();
        formData.append('file', staged.file);
        formData.append('type', staged.type);
        formData.append('identifier', staged.identifier);
        formData.append('revision', staged.revision);
        await uploadHook.upload({ transmittalId: selectedId, formData });
      }
      setStagedFiles([]);
      if (selectedId) fetchDetail(selectedId);
    } catch (err) {
      console.error('Upload failed:', err);
    }
  };

  const handleApproveDoc = async (documentId) => {
    if (!selectedId) return;
    try {
      await fetch(`/api/v1/admin/transmittals/${selectedId}/documents/${documentId}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: 'admin' }),
      });
      fetchDetail(selectedId);
    } catch (err) {
      console.error('Approve failed:', err);
    }
  };

  const handleRejectDoc = async (documentId) => {
    if (!selectedId) return;
    try {
      await fetch(`/api/v1/admin/transmittals/${selectedId}/documents/${documentId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '' }),
      });
      fetchDetail(selectedId);
    } catch (err) {
      console.error('Reject failed:', err);
    }
  };

  const handleBulkApprove = async () => {
    if (!selectedId) return;
    try {
      await fetch(`/api/v1/admin/transmittals/${selectedId}/approve-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: 'admin' }),
      });
      fetchDetail(selectedId);
    } catch (err) {
      console.error('Bulk approve failed:', err);
    }
  };

  const handleCloseTransmittal = async () => {
    if (!selectedId) return;
    try {
      await closeHook.close(selectedId);
      fetchDetail(selectedId);
    } catch (err) {
      console.error('Close transmittal failed:', err);
    }
  };

  const handleDeleteTransmittal = async (id) => {
    try {
      await transmittalMut.remove(id);
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      console.error('Delete transmittal failed:', err);
    }
  };

  const removeStagedFile = (index) => {
    setStagedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const documents = selectedDetail?.documents || [];
  const draftCount = documents.filter(d => d.status === 'draft').length;

  return (
    <div className="flex-1 overflow-hidden flex gap-4 p-4">
      {/* Left panel — Transmittal list */}
      <div className={`w-80 shrink-0 flex flex-col ${panelBg} rounded-xl border ${borderC} overflow-hidden`}>
        <div className={`px-4 py-3 border-b ${borderC} flex items-center gap-3`}>
          <div className="w-1 h-5 rounded-full bg-md-primary shrink-0" />
          <span className={`text-[13px] font-bold ${isDark ? 'text-md-on-surface' : 'text-gray-900'}`}>
            Transmittals
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setShowNewForm(true)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-md-primary/15 text-md-primary hover:bg-md-primary/25 transition-colors cursor-pointer"
          >
            + New
          </button>
        </div>

        <div className="flex-1 overflow-auto px-2 py-2">
          {/* New transmittal inline form */}
          {showNewForm && (
            <div className={`mb-2 p-3 rounded-lg ${cardBg} border ${borderC}`}>
              <input
                value={newRef}
                onChange={e => setNewRef(e.target.value)}
                placeholder="Reference Number"
                className={`w-full px-2.5 py-1.5 rounded-md text-[11px] outline-none border mb-2 transition-colors duration-100 ${inputCls}`}
                autoFocus
              />
              <input
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Description"
                className={`w-full px-2.5 py-1.5 rounded-md text-[11px] outline-none border mb-2 transition-colors duration-100 ${inputCls}`}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreateTransmittal}
                  disabled={!newRef.trim() || transmittalMut.isLoading}
                  className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-md-primary/15 text-md-primary hover:bg-md-primary/25 transition-colors cursor-pointer disabled:opacity-40"
                >
                  Create
                </button>
                <button
                  onClick={() => { setShowNewForm(false); setNewRef(''); setNewDesc(''); }}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${mutedText}`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isLoading && (
            <div className={`text-center py-12 text-[12px] ${mutedText}`}>Loading transmittals...</div>
          )}

          {error && (
            <div className="text-center py-12 text-[12px] text-md-error">
              Error: {error.message}
            </div>
          )}

          {transmittals.map(t => {
            const isSelected = t.id === selectedId;
            const docCount = t.documents?.length || t.document_count || 0;
            return (
              <div
                key={t.id}
                onClick={() => selectTransmittal(t.id)}
                className={`px-3 py-2.5 rounded-lg mb-1 cursor-pointer transition-colors duration-100 group ${
                  isSelected
                    ? isDark ? 'bg-md-primary/10 border border-md-primary/20' : 'bg-md-primary/5 border border-md-primary/15'
                    : `border border-transparent ${hoverBg}`
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[12px] font-bold ${isDark ? 'text-md-on-surface' : 'text-gray-900'}`}>
                    {t.reference_number}
                  </span>
                  <div className="flex-1" />
                  <StatusBadge status={t.status} isDark={isDark} />
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] ${mutedText}`}>
                    {t.created_at ? new Date(t.created_at).toLocaleDateString() : ''}
                  </span>
                  <span className={`text-[10px] ${mutedText}`}>
                    {docCount} document{docCount !== 1 ? 's' : ''}
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteTransmittal(t.id); }}
                    className={`p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all cursor-pointer ${
                      isDark ? 'text-md-on-surface-variant hover:text-md-error hover:bg-white/[0.05]' : 'text-gray-400 hover:text-red-500 hover:bg-gray-100'
                    }`}
                    title="Delete"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16">
                      <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1m2 0v9a1 1 0 01-1 1H5a1 1 0 01-1-1V4h10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
                {t.description && (
                  <p className={`text-[10px] mt-1 truncate ${mutedText}`}>{t.description}</p>
                )}
              </div>
            );
          })}

          {!isLoading && !error && transmittals.length === 0 && !showNewForm && (
            <div className={`text-center py-12 text-[12px] ${mutedText}`}>
              No transmittals yet. Click "+ New" to create one.
            </div>
          )}
        </div>
      </div>

      {/* Right panel — Transmittal detail */}
      <div className={`flex-1 flex flex-col ${panelBg} rounded-xl border ${borderC} overflow-hidden`}>
        {!selected ? (
          <div className={`flex-1 flex items-center justify-center text-[12px] ${mutedText}`}>
            Select a transmittal to view details
          </div>
        ) : (
          <>
            {/* Detail header */}
            <div className={`px-4 py-3 border-b ${borderC} flex items-center gap-3`}>
              <div className="w-1 h-5 rounded-full bg-md-secondary shrink-0" />
              <span className={`text-[13px] font-bold ${isDark ? 'text-md-on-surface' : 'text-gray-900'}`}>
                {selected.reference_number}
              </span>
              <StatusBadge status={selected.status} isDark={isDark} />
              <div className="flex-1" />
              {selected.status !== 'closed' && draftCount > 0 && (
                <button
                  onClick={handleBulkApprove}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                >
                  Approve All ({draftCount})
                </button>
              )}
              {selected.status !== 'closed' && (
                <button
                  onClick={handleCloseTransmittal}
                  disabled={closeHook.isLoading}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-40 ${
                    isDark
                      ? 'bg-white/[0.06] text-md-on-surface-variant hover:bg-white/[0.1]'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Close Transmittal
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto px-4 py-3">
              {/* Description */}
              {selected.description && (
                <p className={`text-[11px] mb-4 ${mutedText}`}>{selected.description}</p>
              )}

              {/* Upload area */}
              {selected.status !== 'closed' && (
                <div className={`mb-4 rounded-lg border ${borderC} overflow-hidden`}>
                  {/* Upload tabs */}
                  <div className={`flex border-b ${borderC}`}>
                    <button
                      onClick={() => setUploadTab('pnid')}
                      className={`flex-1 px-4 py-2 text-[11px] font-medium transition-colors cursor-pointer ${
                        uploadTab === 'pnid'
                          ? 'bg-md-primary/10 text-md-primary font-semibold border-b-2 border-md-primary'
                          : isDark
                            ? 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-white/[0.03]'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      P&IDs
                    </button>
                    <button
                      onClick={() => setUploadTab('csv')}
                      className={`flex-1 px-4 py-2 text-[11px] font-medium transition-colors cursor-pointer ${
                        uploadTab === 'csv'
                          ? 'bg-md-primary/10 text-md-primary font-semibold border-b-2 border-md-primary'
                          : isDark
                            ? 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-white/[0.03]'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Line Lists / Equipment
                    </button>
                  </div>

                  <div className="p-3">
                    {uploadTab === 'pnid' ? (
                      <div>
                        <label className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                          isDark
                            ? 'border-white/[0.1] hover:border-md-primary/30 hover:bg-white/[0.02]'
                            : 'border-gray-200 hover:border-md-primary/30 hover:bg-gray-50'
                        }`}>
                          <svg className={`w-5 h-5 ${mutedText}`} fill="none" viewBox="0 0 24 24">
                            <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span className={`text-[11px] ${mutedText}`}>Drop P&ID files or click to browse (.pdf, .png, .jpg)</span>
                          <input
                            ref={pnidFileRef}
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg"
                            multiple
                            onChange={handlePnidFileChange}
                            className="hidden"
                          />
                        </label>
                      </div>
                    ) : (
                      <div>
                        <label className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                          isDark
                            ? 'border-white/[0.1] hover:border-md-primary/30 hover:bg-white/[0.02]'
                            : 'border-gray-200 hover:border-md-primary/30 hover:bg-gray-50'
                        }`}>
                          <svg className={`w-5 h-5 ${mutedText}`} fill="none" viewBox="0 0 24 24">
                            <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span className={`text-[11px] ${mutedText}`}>Drop CSV files or click to browse (.csv)</span>
                          <input
                            ref={csvFileRef}
                            type="file"
                            accept=".csv"
                            multiple
                            onChange={handleCsvFileChange}
                            className="hidden"
                          />
                        </label>
                      </div>
                    )}

                    {/* Staged files */}
                    {stagedFiles.length > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[11px] font-semibold ${isDark ? 'text-md-on-surface' : 'text-gray-700'}`}>
                            Staged Files ({stagedFiles.length})
                          </span>
                          <div className="flex-1" />
                          <button
                            onClick={handleUploadAll}
                            disabled={uploadHook.isLoading}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-md-primary/15 text-md-primary hover:bg-md-primary/25 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            {uploadHook.isLoading ? 'Uploading...' : 'Upload All'}
                          </button>
                        </div>
                        <div className="space-y-1">
                          {stagedFiles.map((sf, idx) => (
                            <div key={idx} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${cardBg}`}>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                                sf.type === 'pnid'
                                  ? isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-50 text-blue-600'
                                  : isDark ? 'bg-orange-500/15 text-orange-400' : 'bg-orange-50 text-orange-600'
                              }`}>
                                {sf.type === 'pnid' ? 'P&ID' : 'CSV'}
                              </span>
                              <span className={`text-[11px] truncate flex-1 ${isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>
                                {sf.filename}
                              </span>
                              {sf.type === 'pnid' ? (
                                <>
                                  <span className={`text-[10px] ${mutedText}`}>Dwg: {sf.identifier}</span>
                                  <span className={`text-[10px] ${mutedText}`}>Rev: {sf.revision}</span>
                                </>
                              ) : (
                                <span className={`text-[10px] ${mutedText}`}>{sf.rowCount} rows</span>
                              )}
                              <button
                                onClick={() => removeStagedFile(idx)}
                                className={`p-0.5 rounded transition-colors cursor-pointer ${
                                  isDark ? 'text-md-on-surface-variant hover:text-md-error' : 'text-gray-400 hover:text-red-500'
                                }`}
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12">
                                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Document list table */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[12px] font-bold ${isDark ? 'text-md-on-surface' : 'text-gray-900'}`}>
                    Documents ({documents.length})
                  </span>
                </div>

                {detailLoading ? (
                  <div className={`text-center py-8 text-[11px] ${mutedText}`}>
                    Loading documents...
                  </div>
                ) : documents.length === 0 ? (
                  <div className={`text-center py-8 text-[11px] ${mutedText}`}>
                    No documents uploaded yet.
                  </div>
                ) : (
                  <div className={`rounded-lg border ${borderC} overflow-hidden`}>
                    <table className="w-full">
                      <thead>
                        <tr className={isDark ? 'bg-white/[0.03]' : 'bg-gray-50'}>
                          <th className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider ${mutedText}`}>Filename</th>
                          <th className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider ${mutedText}`}>Type</th>
                          <th className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider ${mutedText}`}>Identifier</th>
                          <th className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider ${mutedText}`}>Rev</th>
                          <th className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider ${mutedText}`}>Status</th>
                          <th className={`px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider ${mutedText}`}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.map(doc => (
                          <tr
                            key={doc.id}
                            className={`border-t ${borderC} transition-colors ${hoverBg}`}
                          >
                            <td className={`px-3 py-2 text-[11px] ${isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>
                              {doc.original_filename || doc.filename || '-'}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                                doc.document_type === 'pnid'
                                  ? isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-50 text-blue-600'
                                  : isDark ? 'bg-orange-500/15 text-orange-400' : 'bg-orange-50 text-orange-600'
                              }`}>
                                {doc.document_type === 'pnid' ? 'P&ID' : doc.document_type === 'line_list' ? 'Line List' : 'Equipment'}
                              </span>
                            </td>
                            <td className={`px-3 py-2 text-[11px] font-medium ${isDark ? 'text-md-on-surface' : 'text-gray-800'}`}>
                              {doc.parsed_identifier || '-'}
                            </td>
                            <td className={`px-3 py-2 text-[11px] ${mutedText}`}>
                              {doc.revision || '-'}
                            </td>
                            <td className="px-3 py-2">
                              <DocStatusBadge status={doc.status} isDark={isDark} />
                            </td>
                            <td className="px-3 py-2 text-right">
                              {doc.status === 'draft' && selected.status !== 'closed' && (
                                <div className="flex items-center gap-1 justify-end">
                                  <button
                                    onClick={() => handleApproveDoc(doc.id)}
                                    className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => handleRejectDoc(doc.id)}
                                    className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors cursor-pointer"
                                  >
                                    Reject
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
