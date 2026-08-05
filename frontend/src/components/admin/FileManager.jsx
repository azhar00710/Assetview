import { useState, useCallback, useRef, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';
import {
  useFileBrowser,
  useFileManagerMutations,
  useStorageUsage,
  getFileDownloadUrl,
  useLinkFileToPnid,
  useAdminPnids,
} from '../../hooks/useAdminApi';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function getFileIcon(name) {
  if (!name) return 'description';
  const ext = name.split('.').pop()?.toLowerCase();
  const icons = {
    pdf: 'picture_as_pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image',
    doc: 'description', docx: 'description', xls: 'table_chart', xlsx: 'table_chart', csv: 'table_chart',
    zip: 'folder_zip', gz: 'folder_zip', tar: 'folder_zip', rar: 'folder_zip',
    mp4: 'movie', avi: 'movie', mov: 'movie', mp3: 'audio_file', wav: 'audio_file',
    json: 'data_object', xml: 'code', html: 'code', js: 'code', py: 'code',
    dwg: 'architecture', dxf: 'architecture',
  };
  return icons[ext] || 'description';
}

function getFolderName(folderKey) {
  const parts = folderKey.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || folderKey;
}

export default function FileManager({ configId, configName, onBack, platformId }) {
  const { isDark } = useTheme();
  const [currentPath, setCurrentPath] = useState('');
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'grid'
  const [sortBy, setSortBy] = useState('name'); // 'name' | 'size' | 'date'
  const [sortDir, setSortDir] = useState('asc');
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null); // { type, key, name }
  const [showRenameModal, setShowRenameModal] = useState(null); // { key, name }
  const [renameValue, setRenameValue] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null); // { name, percent }
  const [toast, setToast] = useState(null);
  const [showLinkPnidModal, setShowLinkPnidModal] = useState(null); // { key, name } — file to link
  const fileInputRef = useRef(null);

  const { data: browseData, isLoading, error, refetch } = useFileBrowser(configId, currentPath);
  const { data: usageData } = useStorageUsage(configId, '');
  const mutations = useFileManagerMutations(configId);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Build breadcrumb segments from current path
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.replace(/\/+$/, '').split('/').filter(Boolean);
    return parts.map((part, i) => ({
      label: part,
      path: parts.slice(0, i + 1).join('/') + '/',
    }));
  }, [currentPath]);

  // Sort files
  const sortedFiles = useMemo(() => {
    const files = browseData?.files || [];
    return [...files].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sortBy === 'size') cmp = (a.size || 0) - (b.size || 0);
      else if (sortBy === 'date') cmp = new Date(a.lastModified || 0) - new Date(b.lastModified || 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [browseData?.files, sortBy, sortDir]);

  const folders = browseData?.folders || [];

  // Navigation
  const navigateTo = useCallback((path) => {
    setCurrentPath(path);
    setSelectedItems(new Set());
  }, []);

  const navigateUp = useCallback(() => {
    const parts = currentPath.replace(/\/+$/, '').split('/').filter(Boolean);
    parts.pop();
    navigateTo(parts.length > 0 ? parts.join('/') + '/' : '');
  }, [currentPath, navigateTo]);

  // Selection
  const toggleSelect = useCallback((key) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const allKeys = [
      ...(browseData?.folders || []),
      ...(browseData?.files || []).map(f => f.key),
    ];
    setSelectedItems(prev => prev.size === allKeys.length ? new Set() : new Set(allKeys));
  }, [browseData]);

  // File upload — uses presigned URL to upload directly to bucket (no file through server)
  const handleFileSelect = useCallback(async (e) => {
    const fileList = e.target.files;
    if (!fileList?.length) return;

    for (const file of fileList) {
      setUploadProgress({ name: file.name, percent: 10 });
      try {
        const key = currentPath ? `${currentPath.replace(/\/+$/, '')}/${file.name}` : file.name;

        setUploadProgress({ name: file.name, percent: 30 });

        // Upload directly to bucket via presigned URL (file never touches server)
        await mutations.upload({ key, file, contentType: file.type });

        setUploadProgress({ name: file.name, percent: 100 });
        showToast(`Uploaded: ${file.name}`);
      } catch (err) {
        showToast(`Upload failed: ${err.message}`, 'error');
      }
    }

    setUploadProgress(null);
    refetch();
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [currentPath, mutations, refetch, showToast]);

  // Create folder
  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;
    const path = currentPath
      ? `${currentPath.replace(/\/+$/, '')}/${newFolderName.trim()}/`
      : `${newFolderName.trim()}/`;
    try {
      await mutations.createFolder(path);
      showToast(`Folder created: ${newFolderName.trim()}`);
      setShowNewFolderModal(false);
      setNewFolderName('');
      refetch();
    } catch (err) {
      showToast(`Create folder failed: ${err.message}`, 'error');
    }
  }, [newFolderName, currentPath, mutations, refetch, showToast]);

  // Delete
  const handleDelete = useCallback(async () => {
    if (!showDeleteConfirm) return;
    try {
      if (showDeleteConfirm.type === 'folder') {
        await mutations.deleteFolder(showDeleteConfirm.key);
      } else {
        await mutations.deleteFile(showDeleteConfirm.key);
      }
      showToast(`Deleted: ${showDeleteConfirm.name}`);
      setShowDeleteConfirm(null);
      setSelectedItems(prev => {
        const next = new Set(prev);
        next.delete(showDeleteConfirm.key);
        return next;
      });
      refetch();
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }, [showDeleteConfirm, mutations, refetch, showToast]);

  // Rename (move)
  const handleRename = useCallback(async () => {
    if (!showRenameModal || !renameValue.trim()) return;
    const oldKey = showRenameModal.key;
    const parts = oldKey.replace(/\/+$/, '').split('/');
    parts[parts.length - 1] = renameValue.trim();
    const newKey = parts.join('/') + (oldKey.endsWith('/') ? '/' : '');
    try {
      await mutations.move(oldKey, newKey);
      showToast(`Renamed to: ${renameValue.trim()}`);
      setShowRenameModal(null);
      setRenameValue('');
      refetch();
    } catch (err) {
      showToast(`Rename failed: ${err.message}`, 'error');
    }
  }, [showRenameModal, renameValue, mutations, refetch, showToast]);

  // Download
  const handleDownload = useCallback((key) => {
    const url = getFileDownloadUrl(configId, key);
    window.open(url, '_blank');
  }, [configId]);

  // Drag & drop
  const [dragOver, setDragOver] = useState(false);
  const handleDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (!files?.length) return;

    // Create a mock event for handleFileSelect
    const fakeEvent = { target: { files } };
    await handleFileSelect(fakeEvent);
  }, [handleFileSelect]);

  const handleSort = useCallback((col) => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  }, [sortBy]);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--md-surface)' }}>
      {/* ── Toolbar ── */}
      <div
        className="flex items-center gap-2 px-4 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--md-outline-variant)', background: 'var(--md-surface-container)' }}
      >
        {/* Back */}
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[11px] font-medium px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
            style={{ color: 'var(--md-on-surface-variant)', background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)' }}
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            Back
          </button>
        )}

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          <button
            onClick={() => navigateTo('')}
            className="text-[11px] font-medium px-1.5 py-0.5 rounded cursor-pointer shrink-0"
            style={{
              color: currentPath ? 'var(--md-on-surface-variant)' : 'var(--md-primary)',
              background: currentPath ? 'transparent' : 'var(--md-primary-container)',
            }}
          >
            {configName || 'Root'}
          </button>
          {breadcrumbs.map((bc, i) => (
            <span key={bc.path} className="flex items-center gap-1 shrink-0">
              <span className="text-[10px]" style={{ color: 'var(--md-on-surface-variant)', opacity: 0.4 }}>/</span>
              <button
                onClick={() => navigateTo(bc.path)}
                className="text-[11px] font-medium px-1.5 py-0.5 rounded cursor-pointer"
                style={{
                  color: i === breadcrumbs.length - 1 ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
                  background: i === breadcrumbs.length - 1 ? 'var(--md-primary-container)' : 'transparent',
                }}
              >
                {bc.label}
              </button>
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Upload */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
            style={{ background: 'var(--md-primary)', color: '#fff' }}
            title="Upload files"
          >
            <span className="material-symbols-outlined text-[14px]">upload</span>
            Upload
          </button>

          {/* New Folder */}
          <button
            onClick={() => { setShowNewFolderModal(true); setNewFolderName(''); }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer"
            style={{ background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface)', border: '1px solid var(--md-outline-variant)' }}
            title="New folder"
          >
            <span className="material-symbols-outlined text-[14px]">create_new_folder</span>
            New Folder
          </button>

          {/* Refresh */}
          <button
            onClick={() => refetch()}
            className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer"
            style={{ color: 'var(--md-on-surface-variant)' }}
            title="Refresh"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
          </button>

          {/* View toggle */}
          <button
            onClick={() => setViewMode(v => v === 'list' ? 'grid' : 'list')}
            className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer"
            style={{ color: 'var(--md-on-surface-variant)' }}
            title={viewMode === 'list' ? 'Grid view' : 'List view'}
          >
            <span className="material-symbols-outlined text-[16px]">
              {viewMode === 'list' ? 'grid_view' : 'view_list'}
            </span>
          </button>
        </div>
      </div>

      {/* ── Upload progress ── */}
      {uploadProgress && (
        <div className="px-4 py-2 shrink-0" style={{ background: 'var(--md-surface-container)' }}>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] animate-spin" style={{ color: 'var(--md-primary)' }}>progress_activity</span>
            <span className="text-[11px] font-medium" style={{ color: 'var(--md-on-surface)' }}>
              Uploading: {uploadProgress.name}
            </span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--md-surface-container-high)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress.percent}%`, background: 'var(--md-primary)' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Content area ── */}
      <div
        className="flex-1 overflow-auto p-4"
        style={{ minHeight: 0 }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {dragOver && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="flex flex-col items-center gap-3 p-8 rounded-2xl" style={{ background: 'var(--md-surface-container)', border: '2px dashed var(--md-primary)' }}>
              <span className="material-symbols-outlined text-[48px]" style={{ color: 'var(--md-primary)' }}>cloud_upload</span>
              <span className="text-[14px] font-semibold" style={{ color: 'var(--md-on-surface)' }}>Drop files to upload</span>
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center h-64">
            <div className="text-[12px]" style={{ color: 'var(--md-on-surface-variant)' }}>Loading files...</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center justify-center h-64">
            <div className="text-[12px]" style={{ color: 'var(--md-error)' }}>Error: {error.message}</div>
          </div>
        )}

        {/* Content */}
        {!isLoading && !error && (
          <>
            {/* Usage bar */}
            {usageData && !currentPath && (
              <div className="mb-4 flex items-center gap-4 px-3 py-2 rounded-xl" style={{ background: 'var(--md-surface-container)', border: '1px solid var(--md-outline-variant)' }}>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]" style={{ color: 'var(--md-primary)' }}>storage</span>
                  <span className="text-[11px] font-medium" style={{ color: 'var(--md-on-surface)' }}>
                    {usageData.fileCount} files
                  </span>
                </div>
                <span className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                  {formatBytes(usageData.totalSizeBytes)} total
                </span>
                {usageData.provider && (
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: 'rgba(79,226,176,0.1)', color: 'var(--md-primary)' }}>
                    {usageData.provider}
                  </span>
                )}
              </div>
            )}

            {/* Empty state */}
            {folders.length === 0 && sortedFiles.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <span className="material-symbols-outlined text-[48px]" style={{ color: 'var(--md-on-surface-variant)', opacity: 0.3 }}>folder_open</span>
                <span className="text-[12px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                  {currentPath ? 'This folder is empty' : 'No files in storage'}
                </span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-lg text-[11px] font-semibold cursor-pointer"
                  style={{ background: 'var(--md-primary)', color: '#fff' }}
                >
                  Upload Files
                </button>
              </div>
            )}

            {/* List view */}
            {viewMode === 'list' && (folders.length > 0 || sortedFiles.length > 0) && (
              <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
                {/* Header */}
                <div className="flex items-center px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--md-on-surface-variant)', borderBottom: '1px solid var(--md-outline-variant)' }}>
                  <div className="w-6 shrink-0">
                    <input type="checkbox" checked={selectedItems.size > 0 && selectedItems.size === folders.length + sortedFiles.length} onChange={selectAll} className="accent-emerald-400 cursor-pointer" />
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleSort('name')}>
                    Name {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="w-24 text-right cursor-pointer" onClick={() => handleSort('size')}>
                    Size {sortBy === 'size' && (sortDir === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="w-44 text-right cursor-pointer" onClick={() => handleSort('date')}>
                    Modified {sortBy === 'date' && (sortDir === 'asc' ? '↑' : '↓')}
                  </div>
                  <div className="w-28 text-right">Actions</div>
                </div>

                {/* Parent folder link */}
                {currentPath && (
                  <div
                    className="flex items-center px-3 py-2 cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--md-outline-variant)' }}
                    onClick={navigateUp}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(225,232,229,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div className="w-6 shrink-0" />
                    <span className="material-symbols-outlined text-[18px] mr-2" style={{ color: 'var(--md-on-surface-variant)' }}>arrow_upward</span>
                    <span className="text-[11px] font-medium" style={{ color: 'var(--md-on-surface-variant)' }}>..</span>
                  </div>
                )}

                {/* Folders */}
                {folders.map(folder => {
                  const name = getFolderName(folder);
                  const isSelected = selectedItems.has(folder);
                  return (
                    <div
                      key={folder}
                      className="flex items-center px-3 py-2 cursor-pointer transition-colors group"
                      style={{
                        borderBottom: '1px solid var(--md-outline-variant)',
                        background: isSelected ? 'rgba(79,226,176,0.06)' : 'transparent',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(225,232,229,0.04)'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div className="w-6 shrink-0" onClick={(e) => { e.stopPropagation(); toggleSelect(folder); }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(folder)} className="accent-emerald-400 cursor-pointer" />
                      </div>
                      <div className="flex items-center gap-2 flex-1 min-w-0" onClick={() => navigateTo(folder)}>
                        <span className="material-symbols-outlined text-[18px]" style={{ color: '#FFB068' }}>folder</span>
                        <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--md-on-surface)' }}>{name}</span>
                      </div>
                      <div className="w-24 text-right text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>—</div>
                      <div className="w-44 text-right text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>—</div>
                      <div className="w-28 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowRenameModal({ key: folder, name }); setRenameValue(name); }}
                          className="w-6 h-6 flex items-center justify-center rounded cursor-pointer"
                          style={{ color: 'var(--md-on-surface-variant)' }}
                          title="Rename"
                        >
                          <span className="material-symbols-outlined text-[14px]">edit</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm({ type: 'folder', key: folder, name }); }}
                          className="w-6 h-6 flex items-center justify-center rounded cursor-pointer"
                          style={{ color: 'var(--md-error)' }}
                          title="Delete"
                        >
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Files */}
                {sortedFiles.map(file => {
                  const isSelected = selectedItems.has(file.key);
                  return (
                    <div
                      key={file.key}
                      className="flex items-center px-3 py-2 transition-colors group"
                      style={{
                        borderBottom: '1px solid var(--md-outline-variant)',
                        background: isSelected ? 'rgba(79,226,176,0.06)' : 'transparent',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(225,232,229,0.04)'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div className="w-6 shrink-0">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(file.key)} className="accent-emerald-400 cursor-pointer" />
                      </div>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="material-symbols-outlined text-[18px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                          {getFileIcon(file.name)}
                        </span>
                        <span className="text-[11px] font-medium truncate" style={{ color: 'var(--md-on-surface)' }}>{file.name}</span>
                      </div>
                      <div className="w-24 text-right text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                        {formatBytes(file.size)}
                      </div>
                      <div className="w-44 text-right text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                        {formatDate(file.lastModified)}
                      </div>
                      <div className="w-28 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Link to P&ID — only for PDF/image files */}
                        {/\.(pdf|png|jpg|jpeg|tif|tiff)$/i.test(file.name) && (
                          <button
                            onClick={() => setShowLinkPnidModal({ key: file.key, name: file.name })}
                            className="w-6 h-6 flex items-center justify-center rounded cursor-pointer"
                            style={{ color: '#8AB4FF' }}
                            title="Link to P&ID"
                          >
                            <span className="material-symbols-outlined text-[14px]">link</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleDownload(file.key)}
                          className="w-6 h-6 flex items-center justify-center rounded cursor-pointer"
                          style={{ color: 'var(--md-primary)' }}
                          title="Download"
                        >
                          <span className="material-symbols-outlined text-[14px]">download</span>
                        </button>
                        <button
                          onClick={() => { setShowRenameModal({ key: file.key, name: file.name }); setRenameValue(file.name); }}
                          className="w-6 h-6 flex items-center justify-center rounded cursor-pointer"
                          style={{ color: 'var(--md-on-surface-variant)' }}
                          title="Rename"
                        >
                          <span className="material-symbols-outlined text-[14px]">edit</span>
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm({ type: 'file', key: file.key, name: file.name })}
                          className="w-6 h-6 flex items-center justify-center rounded cursor-pointer"
                          style={{ color: 'var(--md-error)' }}
                          title="Delete"
                        >
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Grid view */}
            {viewMode === 'grid' && (folders.length > 0 || sortedFiles.length > 0) && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {/* Parent folder */}
                {currentPath && (
                  <div
                    onClick={navigateUp}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer transition-colors"
                    style={{ border: '1px solid var(--md-outline-variant)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(225,232,229,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span className="material-symbols-outlined text-[32px]" style={{ color: 'var(--md-on-surface-variant)' }}>arrow_upward</span>
                    <span className="text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>..</span>
                  </div>
                )}

                {/* Folders */}
                {folders.map(folder => (
                  <div
                    key={folder}
                    onClick={() => navigateTo(folder)}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer transition-colors"
                    style={{
                      border: `1px solid ${selectedItems.has(folder) ? 'var(--md-primary)' : 'var(--md-outline-variant)'}`,
                      background: selectedItems.has(folder) ? 'rgba(79,226,176,0.06)' : 'transparent',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(225,232,229,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = selectedItems.has(folder) ? 'rgba(79,226,176,0.06)' : 'transparent'}
                  >
                    <span className="material-symbols-outlined text-[32px]" style={{ color: '#FFB068' }}>folder</span>
                    <span className="text-[10px] font-semibold text-center truncate w-full" style={{ color: 'var(--md-on-surface)' }}>
                      {getFolderName(folder)}
                    </span>
                  </div>
                ))}

                {/* Files */}
                {sortedFiles.map(file => (
                  <div
                    key={file.key}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer transition-colors relative group"
                    style={{
                      border: `1px solid ${selectedItems.has(file.key) ? 'var(--md-primary)' : 'var(--md-outline-variant)'}`,
                      background: selectedItems.has(file.key) ? 'rgba(79,226,176,0.06)' : 'transparent',
                    }}
                    onClick={() => toggleSelect(file.key)}
                    onDoubleClick={() => handleDownload(file.key)}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(225,232,229,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = selectedItems.has(file.key) ? 'rgba(79,226,176,0.06)' : 'transparent'}
                  >
                    <span className="material-symbols-outlined text-[32px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                      {getFileIcon(file.name)}
                    </span>
                    <span className="text-[10px] font-medium text-center truncate w-full" style={{ color: 'var(--md-on-surface)' }}>
                      {file.name}
                    </span>
                    <span className="text-[9px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                      {formatBytes(file.size)}
                    </span>
                    {/* Quick actions */}
                    <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(file.key); }}
                        className="w-5 h-5 flex items-center justify-center rounded"
                        style={{ background: 'var(--md-surface-container)', color: 'var(--md-primary)' }}
                      >
                        <span className="material-symbols-outlined text-[12px]">download</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Truncation notice */}
            {browseData?.isTruncated && (
              <div className="mt-4 text-center">
                <span className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                  More items available. Showing first {sortedFiles.length + folders.length} items.
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Selected items bar ── */}
      {selectedItems.size > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-2 shrink-0"
          style={{ background: 'var(--md-surface-container)', borderTop: '1px solid var(--md-outline-variant)' }}
        >
          <span className="text-[11px] font-medium" style={{ color: 'var(--md-on-surface)' }}>
            {selectedItems.size} selected
          </span>
          <div className="flex-1" />
          <button
            onClick={() => {
              for (const key of selectedItems) {
                if (key.endsWith('/')) {
                  setShowDeleteConfirm({ type: 'folder', key, name: getFolderName(key) });
                } else {
                  setShowDeleteConfirm({ type: 'file', key, name: key.split('/').pop() });
                }
                break; // Delete one at a time for safety
              }
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer"
            style={{ color: 'var(--md-error)', background: 'rgba(255,137,122,0.1)', border: '1px solid rgba(255,137,122,0.2)' }}
          >
            <span className="material-symbols-outlined text-[14px]">delete</span>
            Delete
          </button>
          <button
            onClick={() => setSelectedItems(new Set())}
            className="text-[11px] font-medium px-3 py-1.5 rounded-lg cursor-pointer"
            style={{ color: 'var(--md-on-surface-variant)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* ── New Folder Modal ── */}
      {showNewFolderModal && (
        <ModalOverlay onClose={() => setShowNewFolderModal(false)}>
          <div className="w-[360px] p-5 rounded-2xl" style={{ background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)' }}>
            <h3 className="text-[14px] font-bold mb-4" style={{ color: 'var(--md-on-surface)' }}>New Folder</h3>
            <input
              type="text"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border text-[12px] outline-none mb-4"
              style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewFolderModal(false)} className="px-4 py-2 rounded-lg text-[11px] font-medium cursor-pointer" style={{ color: 'var(--md-on-surface-variant)' }}>
                Cancel
              </button>
              <button onClick={handleCreateFolder} className="px-4 py-2 rounded-lg text-[11px] font-semibold cursor-pointer" style={{ background: 'var(--md-primary)', color: '#fff' }}>
                Create
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Delete Confirm Modal ── */}
      {showDeleteConfirm && (
        <ModalOverlay onClose={() => setShowDeleteConfirm(null)}>
          <div className="w-[360px] p-5 rounded-2xl" style={{ background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)' }}>
            <h3 className="text-[14px] font-bold mb-2" style={{ color: 'var(--md-on-surface)' }}>
              Delete {showDeleteConfirm.type === 'folder' ? 'Folder' : 'File'}
            </h3>
            <p className="text-[11px] mb-4" style={{ color: 'var(--md-on-surface-variant)' }}>
              Are you sure you want to delete <strong style={{ color: 'var(--md-on-surface)' }}>{showDeleteConfirm.name}</strong>?
              {showDeleteConfirm.type === 'folder' && ' This will delete all contents recursively.'}
              {' '}This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="px-4 py-2 rounded-lg text-[11px] font-medium cursor-pointer" style={{ color: 'var(--md-on-surface-variant)' }}>
                Cancel
              </button>
              <button onClick={handleDelete} className="px-4 py-2 rounded-lg text-[11px] font-semibold cursor-pointer" style={{ background: 'var(--md-error)', color: '#fff' }}>
                Delete
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Rename Modal ── */}
      {showRenameModal && (
        <ModalOverlay onClose={() => setShowRenameModal(null)}>
          <div className="w-[360px] p-5 rounded-2xl" style={{ background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)' }}>
            <h3 className="text-[14px] font-bold mb-4" style={{ color: 'var(--md-on-surface)' }}>Rename</h3>
            <input
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 rounded-lg border text-[12px] outline-none mb-4"
              style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowRenameModal(null)} className="px-4 py-2 rounded-lg text-[11px] font-medium cursor-pointer" style={{ color: 'var(--md-on-surface-variant)' }}>
                Cancel
              </button>
              <button onClick={handleRename} className="px-4 py-2 rounded-lg text-[11px] font-semibold cursor-pointer" style={{ background: 'var(--md-primary)', color: '#fff' }}>
                Rename
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Link to P&ID Modal ── */}
      {showLinkPnidModal && (
        <LinkToPnidModal
          fileKey={showLinkPnidModal.key}
          fileName={showLinkPnidModal.name}
          platformId={platformId}
          onClose={() => setShowLinkPnidModal(null)}
          onSuccess={(pnidName) => {
            setShowLinkPnidModal(null);
            showToast(`Linked ${showLinkPnidModal.name} to ${pnidName}`);
          }}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl text-[11px] font-medium shadow-lg transition-all"
          style={{
            background: toast.type === 'error' ? 'var(--md-error)' : 'var(--md-primary)',
            color: '#fff',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

/** Link a storage file to a P&ID record */
function LinkToPnidModal({ fileKey, fileName, platformId, onClose, onSuccess }) {
  const { data: pnidsData } = useAdminPnids(platformId);
  const linkMut = useLinkFileToPnid();
  const [selectedPnidId, setSelectedPnidId] = useState('');
  const [filter, setFilter] = useState('');

  const pnids = pnidsData?.pnids || pnidsData?.data || pnidsData || [];
  const filteredPnids = filter
    ? pnids.filter(p =>
        (p.drawing_number || '').toLowerCase().includes(filter.toLowerCase()) ||
        (p.title || '').toLowerCase().includes(filter.toLowerCase())
      )
    : pnids;

  const handleLink = async () => {
    if (!selectedPnidId) return;
    try {
      await linkMut.link(selectedPnidId, fileKey);
      const pnid = pnids.find(p => p.id === selectedPnidId);
      onSuccess(pnid?.drawing_number || 'P&ID');
    } catch (err) {
      console.error('Link failed:', err);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div className="w-[480px] max-w-[90vw] max-h-[70vh] flex flex-col rounded-2xl" style={{ background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)' }}>
        <div className="p-5 shrink-0">
          <h3 className="text-[14px] font-bold mb-1" style={{ color: 'var(--md-on-surface)' }}>Link File to P&ID</h3>
          <p className="text-[11px] mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
            Link <strong style={{ color: 'var(--md-on-surface)' }}>{fileName}</strong> to a P&ID record.
            The viewer will load this file directly from the bucket.
          </p>
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by drawing number or title..."
            autoFocus
            className="w-full px-3 py-2 rounded-lg border text-[12px] outline-none"
            style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
          />
        </div>
        <div className="flex-1 overflow-auto px-5 pb-3" style={{ minHeight: 0 }}>
          {filteredPnids.length === 0 && (
            <div className="text-[11px] text-center py-6" style={{ color: 'var(--md-on-surface-variant)' }}>
              {pnids.length === 0 ? 'No P&IDs found for this platform' : 'No matching P&IDs'}
            </div>
          )}
          {filteredPnids.map(p => (
            <div
              key={p.id}
              onClick={() => setSelectedPnidId(p.id)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer mb-1 transition-colors"
              style={{
                border: `1px solid ${selectedPnidId === p.id ? 'rgba(138,180,255,0.5)' : 'var(--md-outline-variant)'}`,
                background: selectedPnidId === p.id ? 'rgba(138,180,255,0.08)' : 'transparent',
              }}
            >
              <span className="material-symbols-outlined text-[16px]" style={{ color: selectedPnidId === p.id ? '#8AB4FF' : 'var(--md-on-surface-variant)' }}>description</span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--md-on-surface)' }}>{p.drawing_number}</div>
                <div className="text-[10px] truncate" style={{ color: 'var(--md-on-surface-variant)' }}>{p.title || '—'}</div>
              </div>
              {(p.has_image || p.storage_key) && (
                <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: 'rgba(79,226,176,0.1)', color: 'var(--md-primary)' }}>Has File</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 shrink-0" style={{ borderTop: '1px solid var(--md-outline-variant)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[11px] font-medium cursor-pointer" style={{ color: 'var(--md-on-surface-variant)' }}>
            Cancel
          </button>
          <button
            onClick={handleLink}
            disabled={!selectedPnidId || linkMut.isLinking}
            className="px-4 py-2 rounded-lg text-[11px] font-semibold cursor-pointer"
            style={{ background: '#8AB4FF', color: '#fff', opacity: (!selectedPnidId || linkMut.isLinking) ? 0.4 : 1 }}
          >
            {linkMut.isLinking ? 'Linking...' : 'Link to P&ID'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

/** Simple modal overlay */
function ModalOverlay({ onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}
