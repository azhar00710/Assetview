import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useStorageConfig, useStorageConfigMutation, useStorageSync, useStorageConfigDelete, useAdminAiConfig, useAdminAiConfigMutation, useAdminVisionConfig, useAdminVisionConfigMutation } from '../../hooks/useAdminApi';
import { usePlatforms } from '../../hooks/useApi';

const PROVIDERS = [
  { value: 'local', label: 'Local / NAS', icon: 'folder', description: 'Files stored on local disk or network share' },
  { value: 's3', label: 'AWS S3 / MinIO', icon: 'cloud', description: 'S3-compatible cloud storage' },
  { value: 'gcs', label: 'Google Cloud', icon: 'cloud_upload', description: 'Google Cloud Storage buckets' },
  { value: 'azure', label: 'Azure Blob', icon: 'cloud_queue', description: 'Microsoft Azure Blob Storage' },
  { value: 'do_spaces', label: 'DigitalOcean Spaces', icon: 'cloud_circle', description: 'S3-compatible DigitalOcean Spaces' },
];

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

export default function StorageSettings({ onBrowseConfig }) {
  const { isDark } = useTheme();
  const { data: configData, isLoading } = useStorageConfig();
  const mutation = useStorageConfigMutation();
  const sync = useStorageSync();
  const { data: platforms = [] } = usePlatforms();

  // Config state
  const [provider, setProvider] = useState('local');
  const [bucketOrContainer, setBucketOrContainer] = useState('');
  const [region, setRegion] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [basePath, setBasePath] = useState('./storage/pids');
  const [credentialsJson, setCredentialsJson] = useState('');
  const [scopeType, setScopeType] = useState('global');
  const [scopeId, setScopeId] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync state
  const [syncPlatformId, setSyncPlatformId] = useState('');
  const [syncConfigId, setSyncConfigId] = useState('');
  const [syncScanPrefix, setSyncScanPrefix] = useState('');
  const [syncSystemId, setSyncSystemId] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [selectedNewFiles, setSelectedNewFiles] = useState(new Set());
  const [selectedRevisions, setSelectedRevisions] = useState(new Set());
  const [selectedDuplicates, setSelectedDuplicates] = useState(new Set());
  const [fileSystemOverrides, setFileSystemOverrides] = useState({}); // { 'new-0': systemId, 'rev-2': systemId }
  const [importResult, setImportResult] = useState(null);

  // Active tab
  const [activeTab, setActiveTab] = useState('config'); // 'config' | 'sync' | 'configs'

  // Load existing config
  useEffect(() => {
    const configs = configData?.configs;
    if (configs?.length > 0) {
      const cfg = configs[0];
      setProvider(cfg.provider || 'local');
      setBucketOrContainer(cfg.bucket_or_container || '');
      setRegion(cfg.region || '');
      setEndpointUrl(cfg.endpoint_url || '');
      setBasePath(cfg.base_path || './storage/pids');
      setCredentialsJson(cfg.credentials_ref || '');
      setScopeType(cfg.scope_type || 'global');
      setScopeId(cfg.scope_id || '');
    }
  }, [configData]);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await mutation.testConnection({
        provider,
        bucket_or_container: bucketOrContainer,
        region,
        endpoint_url: endpointUrl,
        base_path: basePath,
        credentials_json: credentialsJson || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await mutation.save({
        scope_type: scopeType,
        scope_id: scopeId || null,
        provider,
        bucket_or_container: bucketOrContainer || null,
        region: region || null,
        endpoint_url: endpointUrl || null,
        base_path: basePath || null,
        credentials_ref: credentialsJson || null,
      });
      setTestResult({ ok: true, message: 'Configuration saved successfully' });
    } catch (err) {
      setTestResult({ ok: false, message: `Save failed: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleScan = async (preserveImportResult = false) => {
    if (!syncPlatformId) return;
    setScanResult(null);
    if (!preserveImportResult) setImportResult(null);
    setSelectedNewFiles(new Set());
    setSelectedRevisions(new Set());
    setSelectedDuplicates(new Set());
    try {
      const body = { platform_id: syncPlatformId };
      if (syncScanPrefix.trim()) body.scan_prefix = syncScanPrefix.trim();
      if (syncConfigId) body.config_id = syncConfigId;
      const result = await sync.scan(body);
      setScanResult(result);
      // Auto-select all new files
      if (result.newFiles?.length > 0) {
        setSelectedNewFiles(new Set(result.newFiles.map((_, i) => i)));
      }
      // Auto-select system if only one
      if (result.systems?.length === 1 && !syncSystemId) {
        setSyncSystemId(result.systems[0].id);
      }
    } catch (err) {
      setScanResult({ error: err.message });
    }
  };

  const handleImportSelected = async () => {
    const filesToImport = [];

    // New files — each file carries its own system_id (from per-file override or auto-detected)
    if (scanResult?.newFiles) {
      scanResult.newFiles.forEach((f, i) => {
        if (selectedNewFiles.has(i)) {
          const fileSystemId = fileSystemOverrides[`new-${i}`] || f.detectedSystem?.id || syncSystemId || null;
          filesToImport.push({ ...f, importType: 'new', system_id: fileSystemId });
        }
      });
    }

    // New revisions
    if (scanResult?.newRevisions) {
      scanResult.newRevisions.forEach((f, i) => {
        if (selectedRevisions.has(i)) {
          const fileSystemId = fileSystemOverrides[`rev-${i}`] || f.detectedSystem?.id || syncSystemId || null;
          filesToImport.push({ ...f, importType: 'revision', existingPnidId: f.existingPnid?.id, system_id: fileSystemId });
        }
      });
    }

    // Duplicate updates
    if (scanResult?.duplicates) {
      scanResult.duplicates.forEach((f, i) => {
        if (selectedDuplicates.has(i)) filesToImport.push({ ...f, importType: 'duplicate_update', existingPnidId: f.existingPnid?.id });
      });
    }

    if (filesToImport.length === 0) return;

    try {
      const result = await sync.importFiles({
        platform_id: syncPlatformId,
        system_id: syncSystemId || null,
        files: filesToImport,
      });
      setImportResult(result);
      // Re-scan to update (preserve import result so user sees feedback)
      handleScan(true);
    } catch (err) {
      setImportResult({ errors: [{ error: err.message }] });
    }
  };

  const toggleSelection = (setter, idx) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[12px]" style={{ color: 'var(--md-on-surface-variant)' }}>Loading storage configuration...</div>
      </div>
    );
  }

  const allConfigs = configData?.configs || [];

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(79,226,176,0.1)' }}>
            <span className="material-symbols-outlined text-[20px]" style={{ color: 'var(--md-primary)' }}>cloud_sync</span>
          </div>
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--md-on-surface)' }}>Storage & Sync</h2>
            <p className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
              Configure P&ID file storage and sync from cloud or NAS
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--md-surface-container)' }}>
          {[
            { key: 'config', label: 'Configuration', icon: 'settings' },
            { key: 'sync', label: 'Sync & Detect', icon: 'sync' },
            { key: 'configs', label: 'All Configs', icon: 'list' },
            { key: 'ai', label: 'AI & Vision', icon: 'psychology' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex-1 justify-center"
              style={{
                color: activeTab === tab.key ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
                background: activeTab === tab.key ? 'var(--md-primary-container)' : 'transparent',
              }}
            >
              <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═══ CONFIG TAB ═══ */}
        {activeTab === 'config' && (
          <>
            {/* Scope Selection */}
            <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
                Configuration Scope
              </label>
              <div className="flex gap-2">
                {['global', 'platform'].map(s => (
                  <button
                    key={s}
                    onClick={() => setScopeType(s)}
                    className="px-4 py-2 rounded-lg text-[11px] font-medium transition-all cursor-pointer"
                    style={{
                      color: scopeType === s ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
                      background: scopeType === s ? 'var(--md-primary-container)' : 'transparent',
                      border: `1px solid ${scopeType === s ? 'var(--md-primary-container)' : 'var(--md-outline-variant)'}`,
                    }}
                  >
                    {s === 'global' ? 'Global (all platforms)' : 'Per Platform'}
                  </button>
                ))}
              </div>
              {scopeType === 'platform' && (
                <div className="mt-3">
                  <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>Platform</label>
                  <select
                    value={scopeId}
                    onChange={e => setScopeId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-[12px] outline-none transition-colors cursor-pointer"
                    style={{ background: 'var(--md-surface-container-high)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
                  >
                    <option value="">Select Platform...</option>
                    {platforms.map(p => (
                      <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Provider Selection */}
            <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
                Storage Provider
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setProvider(p.value)}
                    className="text-left p-3 rounded-lg border transition-all duration-150 cursor-pointer"
                    style={{
                      borderColor: provider === p.value ? 'var(--md-primary)' : 'var(--md-outline-variant)',
                      background: provider === p.value ? 'rgba(79,226,176,0.08)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px]" style={{ color: provider === p.value ? 'var(--md-primary)' : 'var(--md-on-surface-variant)' }}>
                        {p.icon}
                      </span>
                      <span className="text-[12px] font-semibold" style={{ color: provider === p.value ? 'var(--md-primary)' : 'var(--md-on-surface)' }}>
                        {p.label}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1" style={{ color: 'var(--md-on-surface-variant)' }}>{p.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Provider-Specific Config */}
            <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
                {provider === 'local' ? 'Local Storage Settings' : provider === 'gcs' ? 'Google Cloud Storage Settings' : 'S3 Connection Settings'}
              </label>

              <div className="space-y-3">
                {/* ── Local ── */}
                {provider === 'local' && (
                  <>
                    <InputField label="Base Path" value={basePath} onChange={setBasePath} placeholder="/mnt/nas/assetview/pids" hint="Absolute path to storage directory (local disk or mounted NAS)" />
                    <InputField label="Serve URL (optional)" value={endpointUrl} onChange={setEndpointUrl} placeholder="https://files.company.com/assetview" hint="If files are served via a web server. Otherwise proxied through API." />
                  </>
                )}

                {/* ── S3 ── */}
                {provider === 's3' && (
                  <>
                    <InputField label="Bucket Name" value={bucketOrContainer} onChange={setBucketOrContainer} placeholder="assetview-pids" />
                    <div className="grid grid-cols-2 gap-3">
                      <InputField label="Region" value={region} onChange={setRegion} placeholder="us-east-1" />
                      <InputField label="Base Path (prefix)" value={basePath} onChange={setBasePath} placeholder="projects/" />
                    </div>
                    <InputField label="Custom Endpoint (MinIO)" value={endpointUrl} onChange={setEndpointUrl} placeholder="http://minio.local:9000" hint="Leave empty for AWS S3. Set for MinIO or S3-compatible storage." />
                  </>
                )}

                {/* ── GCS ── */}
                {provider === 'gcs' && (
                  <>
                    <InputField label="Bucket Name" value={bucketOrContainer} onChange={setBucketOrContainer} placeholder="assetview-pids" hint="GCS bucket name (must exist already)" />
                    <InputField label="Base Path (prefix)" value={basePath} onChange={setBasePath} placeholder="projects/" hint="Optional prefix path within the bucket" />
                    <div>
                      <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>
                        Service Account Key (JSON)
                      </label>
                      <textarea
                        value={credentialsJson}
                        onChange={e => setCredentialsJson(e.target.value)}
                        placeholder='Paste service account JSON key here, or set GOOGLE_APPLICATION_CREDENTIALS env var on server'
                        rows={4}
                        className="w-full px-3 py-2 rounded-lg border text-[11px] outline-none transition-colors resize-none font-mono"
                        style={{ background: 'var(--md-surface-container-high)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
                      />
                      <span className="text-[9px] mt-0.5 block" style={{ color: 'var(--md-on-surface-variant)' }}>
                        Paste the JSON key from Google Cloud Console → IAM → Service Accounts → Keys. Needs "Storage Object Admin" role.
                      </span>
                    </div>
                  </>
                )}

                {/* ── Azure Blob ── */}
                {provider === 'azure' && (
                  <>
                    <InputField label="Container Name" value={bucketOrContainer} onChange={setBucketOrContainer} placeholder="assetview-files" hint="Azure Blob container name" />
                    <InputField label="Base Path (prefix)" value={basePath} onChange={setBasePath} placeholder="projects/" />
                    <InputField label="Endpoint URL (optional)" value={endpointUrl} onChange={setEndpointUrl} placeholder="https://myaccount.blob.core.windows.net" hint="Leave empty for auto-detected endpoint" />
                    <div>
                      <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>
                        Connection String or Account Key
                      </label>
                      <textarea
                        value={credentialsJson}
                        onChange={e => setCredentialsJson(e.target.value)}
                        placeholder='Paste Azure connection string, or JSON: {"account_name":"...","account_key":"..."}'
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg border text-[11px] outline-none transition-colors resize-none font-mono"
                        style={{ background: 'var(--md-surface-container-high)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
                      />
                      <span className="text-[9px] mt-0.5 block" style={{ color: 'var(--md-on-surface-variant)' }}>
                        Azure Portal → Storage Account → Access Keys → Connection String. Or provide account name + key as JSON.
                      </span>
                    </div>
                  </>
                )}

                {/* ── DigitalOcean Spaces ── */}
                {provider === 'do_spaces' && (
                  <>
                    <InputField label="Space Name" value={bucketOrContainer} onChange={setBucketOrContainer} placeholder="assetview-pids" hint="DigitalOcean Space name" />
                    <div className="grid grid-cols-2 gap-3">
                      <InputField label="Region" value={region} onChange={setRegion} placeholder="nyc3" hint="nyc3, sfo3, ams3, sgp1, fra1" />
                      <InputField label="Base Path (prefix)" value={basePath} onChange={setBasePath} placeholder="projects/" />
                    </div>
                    <span className="text-[9px] mt-0.5 block" style={{ color: 'var(--md-on-surface-variant)' }}>
                      Credentials: set STORAGE_S3_ACCESS_KEY and STORAGE_S3_SECRET_KEY environment variables on the server with your DO Spaces API keys.
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
                  style={{
                    background: 'var(--md-surface-container-high)',
                    border: '1px solid var(--md-outline-variant)',
                    color: 'var(--md-on-surface)',
                    opacity: testing ? 0.5 : 1,
                  }}
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
                  style={{
                    background: 'var(--md-primary)',
                    color: '#fff',
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  {saving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>

              {testResult && (
                <div className="mt-3 px-3 py-2 rounded-lg text-[11px] font-medium" style={{
                  background: testResult.ok ? 'rgba(79,226,176,0.1)' : 'rgba(255,137,122,0.1)',
                  color: testResult.ok ? 'var(--md-primary)' : 'var(--md-error)',
                  border: `1px solid ${testResult.ok ? 'rgba(79,226,176,0.2)' : 'rgba(255,137,122,0.2)'}`,
                }}>
                  {testResult.ok ? 'OK' : 'Error'}: {testResult.message}
                </div>
              )}
            </div>

            {/* GCS Setup Guide */}
            {provider === 'gcs' && (
              <div className="rounded-xl p-4 border" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--md-on-surface-variant)' }}>GCS Setup Guide</div>
                <ol className="text-[11px] space-y-1.5 list-decimal list-inside" style={{ color: 'var(--md-on-surface-variant)' }}>
                  <li>Go to <strong>Google Cloud Console</strong> → Create a project (or use existing)</li>
                  <li>Enable <strong>Cloud Storage API</strong></li>
                  <li>Create a <strong>Storage Bucket</strong> (e.g., <code>assetview-pids</code>) — choose region closest to your users</li>
                  <li>Go to <strong>IAM & Admin → Service Accounts</strong> → Create service account</li>
                  <li>Grant role: <strong>Storage Object Admin</strong></li>
                  <li>Create a <strong>JSON key</strong> and paste it above</li>
                  <li>Organize files as: <code>PLATFORM/pids/DRAWING_NUMBER/rev_REV/filename.pdf</code></li>
                </ol>
              </div>
            )}

            {/* How It Works */}
            <div className="rounded-xl p-4 border" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--md-on-surface-variant)' }}>How It Works</div>
              <ul className="text-[11px] space-y-1.5" style={{ color: 'var(--md-on-surface-variant)' }}>
                <li>P&ID files are uploaded through the P&IDs tab and stored in the configured backend.</li>
                <li>AssetView stores only references (storage keys) — your files remain on your infrastructure.</li>
                <li>For cloud storage, access is via time-limited signed URLs (no credentials exposed to browser).</li>
                <li>Each platform can have its own storage backend via per-platform configuration.</li>
                <li>Use the <strong>Sync</strong> tab to auto-detect new P&IDs dropped into storage.</li>
              </ul>
            </div>
          </>
        )}

        {/* ═══ SYNC TAB ═══ */}
        {activeTab === 'sync' && (
          <>
            {/* Scan Configuration */}
            <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
                Scan Storage for P&IDs
              </label>
              <p className="text-[11px] mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
                Select a platform and storage configuration, then scan to detect P&ID files.
                New files, new revisions, and duplicates are shown separately.
              </p>

              <div className="space-y-3">
                {/* Platform selector */}
                <div>
                  <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>Platform</label>
                  <select
                    value={syncPlatformId}
                    onChange={e => { setSyncPlatformId(e.target.value); setScanResult(null); }}
                    className="w-full px-3 py-2 rounded-lg border text-[12px] outline-none transition-colors cursor-pointer"
                    style={{ background: 'var(--md-surface-container-high)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
                  >
                    <option value="">Select Platform...</option>
                    {platforms.map(p => (
                      <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                    ))}
                  </select>
                </div>

                {/* Storage config selector */}
                {allConfigs.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>Storage Configuration</label>
                    <select
                      value={syncConfigId}
                      onChange={e => setSyncConfigId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-[12px] outline-none transition-colors cursor-pointer"
                      style={{ background: 'var(--md-surface-container-high)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
                    >
                      <option value="">Auto-detect (by platform scope)</option>
                      {allConfigs.map(cfg => {
                        const pm = PROVIDERS.find(p => p.value === cfg.provider);
                        return (
                          <option key={cfg.id} value={cfg.id}>
                            {pm?.label || cfg.provider} — {cfg.bucket_or_container || cfg.base_path || 'default'}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}

                {/* Scan prefix */}
                <div>
                  <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>
                    Scan Path (prefix)
                  </label>
                  <input
                    type="text"
                    value={syncScanPrefix}
                    onChange={e => setSyncScanPrefix(e.target.value)}
                    placeholder="Leave empty for auto (PLATFORM_CODE/pids/)"
                    className="w-full px-3 py-2 rounded-lg border text-[12px] outline-none transition-colors"
                    style={{ background: 'var(--md-surface-container-high)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
                  />
                  <span className="text-[9px] mt-0.5 block" style={{ color: 'var(--md-on-surface-variant)' }}>
                    Path within the bucket/storage to scan. E.g. <code>AKK4/pids/</code> or <code>project-name/drawings/</code>
                  </span>
                </div>

                {/* Scan button */}
                <button
                  onClick={handleScan}
                  disabled={sync.isScanning || !syncPlatformId}
                  className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
                  style={{
                    background: 'var(--md-primary)',
                    color: '#fff',
                    opacity: (sync.isScanning || !syncPlatformId) ? 0.5 : 1,
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">search</span>
                    {sync.isScanning ? 'Scanning...' : 'Scan Storage'}
                  </span>
                </button>
              </div>
            </div>

            {/* Scan Results */}
            {scanResult && !scanResult.error && (
              <>
                {/* Summary stats */}
                <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
                  <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--md-on-surface)' }}>
                    Scan Results — {scanResult.platform?.code}
                    {scanResult.scanPrefix && (
                      <span className="text-[9px] font-normal ml-2" style={{ color: 'var(--md-on-surface-variant)' }}>
                        scanned: {scanResult.scanPrefix}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <StatBox label="In Storage" value={scanResult.totalInStorage} color="var(--md-on-surface)" />
                    <StatBox label="In Database" value={scanResult.totalInDb} color="var(--md-on-surface)" />
                    <StatBox label="New" value={scanResult.newFiles?.length || 0} color="var(--md-primary)" />
                    <StatBox label="New Rev" value={scanResult.newRevisions?.length || 0} color="#8AB4FF" />
                    <StatBox label="Duplicates" value={scanResult.duplicates?.length || 0} color="#F39C12" />
                    <StatBox label="Orphaned" value={scanResult.orphaned?.length || 0} color="var(--md-error)" />
                  </div>
                </div>

                {/* System selector — optional default for all files */}
                {(scanResult.newFiles?.length > 0 || scanResult.newRevisions?.length > 0 || scanResult.duplicates?.length > 0) && (
                  <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
                    <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>
                      Default System (optional — can be assigned per file or later from P&ID list)
                    </label>
                    <select
                      value={syncSystemId}
                      onChange={e => setSyncSystemId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-[12px] outline-none transition-colors cursor-pointer"
                      style={{ background: 'var(--md-surface-container-high)', borderColor: syncSystemId ? 'var(--md-primary)' : 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
                    >
                      <option value="">No default — use auto-detected or assign later</option>
                      {(scanResult.systems || []).map(s => (
                        <option key={s.id} value={s.id}>{s.code} — {s.name} ({s.sys_type})</option>
                      ))}
                    </select>
                    {(() => {
                      const autoCount = [...(scanResult.newFiles || []), ...(scanResult.newRevisions || [])].filter(f => f.detectedSystem).length;
                      return autoCount > 0 ? (
                        <span className="text-[9px] mt-0.5 block" style={{ color: 'var(--md-primary)' }}>
                          {autoCount} file{autoCount !== 1 ? 's' : ''} auto-detected with matching system codes
                        </span>
                      ) : null;
                    })()}
                  </div>
                )}

                {/* ── NEW FILES ── */}
                {scanResult.newFiles?.length > 0 && (
                  <FileListSection
                    title="New P&IDs"
                    subtitle="Brand new drawing numbers — not in database yet. System can be assigned per file or later."
                    files={scanResult.newFiles}
                    selected={selectedNewFiles}
                    onToggle={(i) => toggleSelection(setSelectedNewFiles, i)}
                    onSelectAll={() => {
                      if (selectedNewFiles.size === scanResult.newFiles.length) setSelectedNewFiles(new Set());
                      else setSelectedNewFiles(new Set(scanResult.newFiles.map((_, i) => i)));
                    }}
                    color="var(--md-primary)"
                    bgColor="rgba(79,226,176,0.06)"
                    borderColor="rgba(79,226,176,0.2)"
                    badgeLabel="NEW"
                    systems={scanResult.systems}
                    fileKeyPrefix="new"
                    fileSystemOverrides={fileSystemOverrides}
                    onSystemOverride={(key, val) => setFileSystemOverrides(prev => ({ ...prev, [key]: val }))}
                  />
                )}

                {/* ── NEW REVISIONS ── */}
                {scanResult.newRevisions?.length > 0 && (
                  <FileListSection
                    title="New Revisions"
                    subtitle="Same drawing number, different revision — old revision will be marked as superseded"
                    files={scanResult.newRevisions}
                    selected={selectedRevisions}
                    onToggle={(i) => toggleSelection(setSelectedRevisions, i)}
                    onSelectAll={() => {
                      if (selectedRevisions.size === scanResult.newRevisions.length) setSelectedRevisions(new Set());
                      else setSelectedRevisions(new Set(scanResult.newRevisions.map((_, i) => i)));
                    }}
                    color="#8AB4FF"
                    bgColor="rgba(138,180,255,0.06)"
                    borderColor="rgba(138,180,255,0.2)"
                    badgeLabel="REV"
                    showRevisionInfo
                    systems={scanResult.systems}
                    fileKeyPrefix="rev"
                    fileSystemOverrides={fileSystemOverrides}
                    onSystemOverride={(key, val) => setFileSystemOverrides(prev => ({ ...prev, [key]: val }))}
                  />
                )}

                {/* ── DUPLICATES ── */}
                {scanResult.duplicates?.length > 0 && (
                  <FileListSection
                    title="Duplicates"
                    subtitle="Same drawing number AND same revision — select to update storage link to the new file"
                    files={scanResult.duplicates}
                    selected={selectedDuplicates}
                    onToggle={(i) => toggleSelection(setSelectedDuplicates, i)}
                    onSelectAll={() => {
                      if (selectedDuplicates.size === scanResult.duplicates.length) setSelectedDuplicates(new Set());
                      else setSelectedDuplicates(new Set(scanResult.duplicates.map((_, i) => i)));
                    }}
                    color="#F39C12"
                    bgColor="rgba(243,156,18,0.06)"
                    borderColor="rgba(243,156,18,0.2)"
                    badgeLabel="DUP"
                    showDuplicateReason
                  />
                )}

                {/* Import button (consolidated) */}
                {(selectedNewFiles.size > 0 || selectedRevisions.size > 0 || selectedDuplicates.size > 0) && (
                  <div className="rounded-xl border p-4 flex items-center justify-between" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-primary)' }}>
                    <div className="text-[11px]" style={{ color: 'var(--md-on-surface)' }}>
                      <strong>{selectedNewFiles.size + selectedRevisions.size + selectedDuplicates.size}</strong> files selected
                      {selectedNewFiles.size > 0 && <span className="ml-2" style={{ color: 'var(--md-primary)' }}>{selectedNewFiles.size} new</span>}
                      {selectedRevisions.size > 0 && <span className="ml-2" style={{ color: '#8AB4FF' }}>{selectedRevisions.size} revisions</span>}
                      {selectedDuplicates.size > 0 && <span className="ml-2" style={{ color: '#F39C12' }}>{selectedDuplicates.size} updates</span>}
                    </div>
                    <button
                      onClick={handleImportSelected}
                      disabled={sync.isImporting}
                      className="px-4 py-2 rounded-lg text-[11px] font-semibold cursor-pointer"
                      style={{
                        background: 'var(--md-primary)',
                        color: '#fff',
                        opacity: sync.isImporting ? 0.4 : 1,
                      }}
                    >
                      {sync.isImporting ? 'Importing...' : 'Import Selected'}
                    </button>
                  </div>
                )}

                {/* Matched */}
                {scanResult.matched?.length > 0 && (
                  <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
                    <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--md-on-surface-variant)' }}>
                      Already Linked ({scanResult.matched.length})
                    </div>
                    <div className="space-y-1 max-h-[200px] overflow-y-auto">
                      {scanResult.matched.map((m, i) => (
                        <div key={m.file?.key || i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(79,226,176,0.04)', border: '1px solid rgba(79,226,176,0.15)' }}>
                          <span className="material-symbols-outlined text-[14px]" style={{ color: 'var(--md-primary)' }}>check_circle</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium truncate" style={{ color: 'var(--md-on-surface)' }}>
                              {m.pnid?.drawing_number || m.file?.key?.split('/').pop() || 'Unknown'}
                            </div>
                          </div>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{
                            background: m.status === 'matched_by_key' ? 'rgba(79,226,176,0.1)' : 'rgba(138,180,255,0.1)',
                            color: m.status === 'matched_by_key' ? 'var(--md-primary)' : 'var(--md-secondary)',
                          }}>
                            {m.status === 'matched_by_key' ? 'by key' : 'by name'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Orphaned records */}
                {scanResult.orphaned?.length > 0 && (
                  <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
                    <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--md-error)' }}>
                      Orphaned Records ({scanResult.orphaned.length})
                    </div>
                    <p className="text-[10px] mb-2" style={{ color: 'var(--md-on-surface-variant)' }}>
                      Database records with storage references, but files not found in storage.
                    </p>
                    <div className="space-y-1 max-h-[200px] overflow-y-auto">
                      {scanResult.orphaned.map(p => (
                        <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,137,122,0.05)', border: '1px solid rgba(255,137,122,0.15)' }}>
                          <span className="text-[11px] font-medium" style={{ color: 'var(--md-on-surface)' }}>{p.drawing_number}</span>
                          <span className="text-[9px]" style={{ color: 'var(--md-on-surface-variant)' }}>Rev {p.revision || '-'}</span>
                          <div className="flex-1" />
                          <span className="text-[9px] truncate max-w-[200px]" style={{ color: 'var(--md-error)' }}>{p.storage_key}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Import result */}
                {importResult && (() => {
                  const hasCreated = importResult.created?.length > 0;
                  const hasUpdated = importResult.updated?.length > 0;
                  const hasSkipped = importResult.skipped?.length > 0;
                  const hasErrors = importResult.errors?.length > 0;
                  const isSuccess = (hasCreated || hasUpdated) && !hasErrors;
                  const borderColor = hasErrors ? 'rgba(255,137,122,0.4)' : isSuccess ? 'rgba(75,226,176,0.4)' : 'var(--md-outline-variant)';
                  const bgColor = hasErrors ? 'rgba(255,137,122,0.08)' : isSuccess ? 'rgba(75,226,176,0.08)' : 'var(--md-surface-container)';
                  return (
                    <div className="rounded-xl border p-4" style={{ background: bgColor, borderColor }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="material-symbols-outlined text-[16px]" style={{ color: hasErrors ? 'var(--md-error)' : isSuccess ? '#4FE2B0' : 'var(--md-on-surface-variant)' }}>
                          {hasErrors ? 'error' : isSuccess ? 'check_circle' : 'info'}
                        </span>
                        <div className="text-[12px] font-semibold" style={{ color: hasErrors ? 'var(--md-error)' : isSuccess ? '#4FE2B0' : 'var(--md-on-surface)' }}>
                          {hasErrors ? 'Import completed with errors' : isSuccess ? 'Import successful' : 'Import completed'}
                        </div>
                        <div className="flex-1" />
                        <button onClick={() => setImportResult(null)} className="text-[10px] px-2 py-0.5 rounded hover:bg-white/10" style={{ color: 'var(--md-on-surface-variant)' }}>dismiss</button>
                      </div>
                      {hasCreated && (
                        <div className="text-[11px] mb-1" style={{ color: 'var(--md-primary)' }}>
                          Created {importResult.created.length} P&ID record{importResult.created.length > 1 ? 's' : ''}
                          {importResult.created.some(c => c.type === 'new_revision') && (
                            <span className="ml-1" style={{ color: '#8AB4FF' }}>
                              ({importResult.created.filter(c => c.type === 'new_revision').length} new revisions)
                            </span>
                          )}
                        </div>
                      )}
                      {hasUpdated && (
                        <div className="text-[11px] mb-1" style={{ color: '#F39C12' }}>
                          Updated {importResult.updated.length} existing record{importResult.updated.length > 1 ? 's' : ''}
                          <span className="ml-1 text-[10px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                            ({importResult.updated.map(u => u.drawing_number).join(', ')})
                          </span>
                        </div>
                      )}
                      {hasSkipped && (
                        <div className="text-[11px] mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>
                          Skipped {importResult.skipped.length} (already exist)
                        </div>
                      )}
                      {hasErrors && (
                        <div className="text-[11px]" style={{ color: 'var(--md-error)' }}>
                          {importResult.errors.length} error{importResult.errors.length > 1 ? 's' : ''}: {importResult.errors.map(e => e.error || e.message).join(', ')}
                        </div>
                      )}
                      {!hasCreated && !hasUpdated && !hasSkipped && !hasErrors && (
                        <div className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
                          No files were processed. Make sure files are selected before importing.
                        </div>
                      )}
                      {(hasCreated || hasUpdated) && (
                        <div className="text-[10px] mt-2 pt-2 border-t" style={{ color: 'var(--md-on-surface-variant)', borderColor: 'var(--md-outline-variant)' }}>
                          Imported P&IDs are now visible in the Miller Columns view for this platform.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}

            {scanResult?.error && (
              <div className="rounded-xl border p-4" style={{ background: 'rgba(255,137,122,0.05)', borderColor: 'rgba(255,137,122,0.2)' }}>
                <div className="text-[11px] font-medium" style={{ color: 'var(--md-error)' }}>
                  Scan failed: {scanResult.error}
                </div>
              </div>
            )}

            {!scanResult && (
              <div className="rounded-xl p-4 border" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--md-on-surface-variant)' }}>How Sync Works</div>
                <ul className="text-[11px] space-y-1.5" style={{ color: 'var(--md-on-surface-variant)' }}>
                  <li><strong>1. Select platform & config</strong> — Choose which platform and storage backend to scan.</li>
                  <li><strong>2. Set scan path</strong> — Specify the folder path within your bucket (e.g. <code>AKK4/pids/</code>).</li>
                  <li><strong>3. Scan</strong> — The system lists all PDF/PNG/TIFF files and compares with the database.</li>
                  <li><strong>4. Review categories</strong> — New files, new revisions, and duplicates are shown separately.</li>
                  <li><strong>5. Import</strong> — Systems are auto-detected from filenames. You can override per file or assign later from the P&ID list.</li>
                  <li><strong>Files stay on cloud</strong> — Only references (storage keys) are stored. P&IDs load via signed URLs.</li>
                </ul>
              </div>
            )}
          </>
        )}

        {/* ═══ ALL CONFIGS TAB ═══ */}
        {activeTab === 'configs' && (
          <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
              All Storage Configurations
            </div>
            {allConfigs.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>No configurations saved yet.</p>
            ) : (
              <div className="space-y-2">
                {allConfigs.map(cfg => {
                  const providerMeta = PROVIDERS.find(p => p.value === cfg.provider);
                  return (
                    <div key={cfg.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg group" style={{ border: '1px solid var(--md-outline-variant)' }}>
                      <span className="material-symbols-outlined text-[16px]" style={{ color: cfg.is_active ? 'var(--md-primary)' : 'var(--md-on-surface-variant)' }}>
                        {providerMeta?.icon || 'cloud'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold" style={{ color: 'var(--md-on-surface)' }}>
                          {providerMeta?.label || cfg.provider.toUpperCase()} — {cfg.scope_type}
                          {cfg.scope_id && ` (${cfg.scope_id.slice(0, 8)}...)`}
                        </div>
                        <div className="text-[9px] truncate" style={{ color: 'var(--md-on-surface-variant)' }}>
                          {cfg.bucket_or_container || cfg.base_path || '-'}
                          {cfg.region && ` (${cfg.region})`}
                        </div>
                      </div>
                      {cfg.is_active && (
                        <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ color: 'var(--md-primary)', background: 'rgba(79,226,176,0.1)' }}>Active</span>
                      )}
                      {/* Browse button */}
                      {onBrowseConfig && (
                        <button
                          onClick={() => onBrowseConfig(cfg)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: 'var(--md-primary-container)', color: 'var(--md-primary)' }}
                          title="Browse files"
                        >
                          <span className="material-symbols-outlined text-[12px]">folder_open</span>
                          Browse
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ AI & VISION TAB ═══ */}
        {activeTab === 'ai' && (
          <AiVisionTab />
        )}
      </div>
    </div>
  );
}

/** AI & Vision credentials tab */
function AiVisionTab() {
  const { data: aiConfig, isLoading: aiLoading } = useAdminAiConfig();
  const { data: visionConfig, isLoading: visionLoading } = useAdminVisionConfig();
  const aiMutation = useAdminAiConfigMutation();
  const visionMutation = useAdminVisionConfigMutation();

  // Claude AI state
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [aiTestResult, setAiTestResult] = useState(null);

  // Vision state
  const [useSeparateVision, setUseSeparateVision] = useState(false);
  const [visionCreds, setVisionCreds] = useState('');
  const [visionTestResult, setVisionTestResult] = useState(null);

  // Sync model from server
  useEffect(() => {
    if (aiConfig?.aiModel) setModel(aiConfig.aiModel);
    if (visionConfig) setUseSeparateVision(visionConfig.usesSeparateCredentials);
  }, [aiConfig, visionConfig]);

  const MODELS = [
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (Recommended)' },
    { value: 'claude-opus-4-20250514', label: 'Claude Opus 4 (Highest quality)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fastest)' },
  ];

  const handleAiTest = useCallback(async () => {
    setAiTestResult(null);
    try {
      const result = await aiMutation.test({ apiKey: apiKey || undefined });
      setAiTestResult(result);
    } catch (err) {
      setAiTestResult({ ok: false, message: err.message });
    }
  }, [apiKey, aiMutation]);

  const handleAiSave = useCallback(async () => {
    setAiTestResult(null);
    try {
      await aiMutation.save({ apiKey: apiKey || undefined, model });
      setAiTestResult({ ok: true, message: 'Claude AI credentials saved successfully.' });
      setApiKey('');
    } catch (err) {
      setAiTestResult({ ok: false, message: err.message });
    }
  }, [apiKey, model, aiMutation]);

  const handleVisionTest = useCallback(async () => {
    setVisionTestResult(null);
    try {
      const result = await visionMutation.test({ credentialsJson: useSeparateVision && visionCreds ? visionCreds : undefined });
      setVisionTestResult(result);
    } catch (err) {
      setVisionTestResult({ ok: false, message: err.message });
    }
  }, [useSeparateVision, visionCreds, visionMutation]);

  const handleVisionSave = useCallback(async () => {
    setVisionTestResult(null);
    try {
      await visionMutation.save({ visionCredentialsJson: useSeparateVision ? visionCreds : null });
      setVisionTestResult({ ok: true, message: useSeparateVision ? 'Separate Vision credentials saved.' : 'Now using storage credentials for Vision API.' });
      if (useSeparateVision) setVisionCreds('');
    } catch (err) {
      setVisionTestResult({ ok: false, message: err.message });
    }
  }, [useSeparateVision, visionCreds, visionMutation]);

  const keyValid = !apiKey || apiKey.startsWith('sk-ant-');
  let visionJsonValid = false;
  if (visionCreds) {
    try { const p = JSON.parse(visionCreds); visionJsonValid = !!(p.project_id && p.private_key); } catch { visionJsonValid = false; }
  }

  return (
    <div className="space-y-4">
      {/* ── Claude AI Card ── */}
      <div className="rounded-xl border p-5" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-[22px]" style={{ color: '#F59E0B' }}>psychology</span>
          <div className="flex-1">
            <div className="font-semibold text-[13px]" style={{ color: 'var(--md-on-surface)' }}>Claude AI</div>
            <div className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>Anthropic API key for AI cleanup and Claude Vision OCR</div>
          </div>
          {!aiLoading && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"
              style={{ background: aiConfig?.hasAiCredentials ? 'rgba(59,228,148,0.12)' : 'rgba(243,156,18,0.12)', color: aiConfig?.hasAiCredentials ? '#3BE494' : '#F39C12' }}>
              <span className="material-symbols-outlined text-[10px]">{aiConfig?.hasAiCredentials ? 'check_circle' : 'warning'}</span>
              {aiConfig?.hasAiCredentials
                ? `Configured${aiConfig.source === 'env' ? ' (env var)' : ' — Global'}`
                : 'Not configured'}
            </span>
          )}
        </div>

        <form onSubmit={e => e.preventDefault()} className="space-y-3">
          {/* API Key */}
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>
              API Key {aiConfig?.hasAiCredentials && <span style={{ color: '#3BE494' }}>(leave blank to keep existing)</span>}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-api03-..."
              className="w-full px-3 py-2 rounded-lg text-[12px] font-mono border focus:outline-none focus:ring-1"
              autoComplete="off"
              style={{
                background: 'var(--md-surface)',
                borderColor: apiKey && !keyValid ? 'var(--md-error)' : 'var(--md-outline-variant)',
                color: 'var(--md-on-surface)',
              }}
            />
            {apiKey && !keyValid && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--md-error)' }}>Key must start with sk-ant-</p>
            )}
          </div>

          {/* Model */}
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>Model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[12px] border focus:outline-none"
              style={{ background: 'var(--md-surface)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
            >
              {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {/* Test result */}
          {aiTestResult && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]"
              style={{ background: aiTestResult.ok ? 'rgba(59,228,148,0.08)' : 'rgba(231,76,60,0.08)', color: aiTestResult.ok ? '#3BE494' : 'var(--md-error)' }}>
              <span className="material-symbols-outlined text-[14px]">{aiTestResult.ok ? 'check_circle' : 'error'}</span>
              {aiTestResult.message}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 pt-1">
            <button onClick={handleAiTest} disabled={aiMutation.isTesting || (!!apiKey && !keyValid)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border disabled:opacity-40 transition-all"
              style={{ borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface-variant)' }}>
              {aiMutation.isTesting
                ? <span className="material-symbols-outlined animate-spin text-[13px]">progress_activity</span>
                : <span className="material-symbols-outlined text-[13px]">science</span>}
              Test Connection
            </button>
            <button onClick={handleAiSave} disabled={aiMutation.isSaving || (!!apiKey && !keyValid)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white disabled:opacity-40 transition-all"
              style={{ background: '#F59E0B' }}>
              {aiMutation.isSaving
                ? <span className="material-symbols-outlined animate-spin text-[13px]">progress_activity</span>
                : <span className="material-symbols-outlined text-[13px]">save</span>}
              Save
            </button>
          </div>
        </form>
      </div>

      {/* ── Vision API Card ── */}
      <div className="rounded-xl border p-5" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-[22px]" style={{ color: '#A855F7' }}>visibility</span>
          <div className="flex-1">
            <div className="font-semibold text-[13px]" style={{ color: 'var(--md-on-surface)' }}>Google Vision API</div>
            <div className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>Credentials for Google Cloud Vision OCR</div>
          </div>
          {!visionLoading && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"
              style={{ background: visionConfig?.hasVisionCredentials ? 'rgba(59,228,148,0.12)' : 'rgba(243,156,18,0.12)', color: visionConfig?.hasVisionCredentials ? '#3BE494' : '#F39C12' }}>
              <span className="material-symbols-outlined text-[10px]">{visionConfig?.hasVisionCredentials ? 'check_circle' : 'warning'}</span>
              {visionConfig?.hasVisionCredentials
                ? (visionConfig.usesSeparateCredentials ? 'Separate credentials' : 'Using storage credentials')
                : 'Not configured'}
            </span>
          )}
        </div>

        <div className="space-y-3">
          {/* Toggle */}
          <div className="flex gap-2">
            <button onClick={() => setUseSeparateVision(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all"
              style={{ background: !useSeparateVision ? 'rgba(59,228,148,0.12)' : 'transparent', color: !useSeparateVision ? '#3BE494' : 'var(--md-on-surface-variant)', border: !useSeparateVision ? '1px solid rgba(59,228,148,0.3)' : '1px solid transparent' }}>
              <span className="material-symbols-outlined text-[13px]">link</span>
              Use storage credentials
            </button>
            <button onClick={() => setUseSeparateVision(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all"
              style={{ background: useSeparateVision ? 'rgba(168,85,247,0.12)' : 'transparent', color: useSeparateVision ? '#A855F7' : 'var(--md-on-surface-variant)', border: useSeparateVision ? '1px solid rgba(168,85,247,0.3)' : '1px solid transparent' }}>
              <span className="material-symbols-outlined text-[13px]">key</span>
              Separate Vision credentials
            </button>
          </div>

          {!useSeparateVision && (
            <p className="text-[11px]" style={{ color: 'var(--md-on-surface-variant)' }}>
              Vision API will use the same GCS service account as your storage config.
              Ensure the <strong>Cloud Vision API</strong> is enabled in your Google Cloud project.
            </p>
          )}

          {useSeparateVision && (
            <div>
              <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>
                Service Account JSON
                {visionCreds && (
                  <span className="ml-2 text-[10px] font-semibold" style={{ color: visionJsonValid ? '#3BE494' : 'var(--md-error)' }}>
                    {visionJsonValid ? '✓ Valid' : '✗ Invalid'}
                  </span>
                )}
              </label>
              <textarea
                value={visionCreds}
                onChange={e => setVisionCreds(e.target.value)}
                rows={5}
                placeholder='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
                className="w-full px-3 py-2 rounded-lg text-[11px] font-mono border resize-y focus:outline-none focus:ring-1"
                style={{ background: 'var(--md-surface)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
                spellCheck={false}
              />
            </div>
          )}

          {/* Test result */}
          {visionTestResult && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]"
              style={{ background: visionTestResult.ok ? 'rgba(59,228,148,0.08)' : 'rgba(231,76,60,0.08)', color: visionTestResult.ok ? '#3BE494' : 'var(--md-error)' }}>
              <span className="material-symbols-outlined text-[14px]">{visionTestResult.ok ? 'check_circle' : 'error'}</span>
              {visionTestResult.message}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 pt-1">
            <button onClick={handleVisionTest} disabled={visionMutation.isTesting || (useSeparateVision && visionCreds && !visionJsonValid)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border disabled:opacity-40 transition-all"
              style={{ borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface-variant)' }}>
              {visionMutation.isTesting
                ? <span className="material-symbols-outlined animate-spin text-[13px]">progress_activity</span>
                : <span className="material-symbols-outlined text-[13px]">science</span>}
              Test Connection
            </button>
            <button onClick={handleVisionSave} disabled={visionMutation.isSaving || (useSeparateVision && visionCreds && !visionJsonValid)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white disabled:opacity-40 transition-all"
              style={{ background: '#A855F7' }}>
              {visionMutation.isSaving
                ? <span className="material-symbols-outlined animate-spin text-[13px]">progress_activity</span>
                : <span className="material-symbols-outlined text-[13px]">save</span>}
              Save
            </button>
          </div>
        </div>
      </div>

      <p className="text-[10px] px-1" style={{ color: 'var(--md-on-surface-variant)' }}>
        Credentials saved here are stored globally and used by the OCR Pipeline for all platforms.
      </p>
    </div>
  );
}

/** Reusable input field */
function InputField({ label, value, onChange, placeholder, hint }) {
  return (
    <div>
      <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--md-on-surface-variant)' }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border text-[12px] outline-none transition-colors"
        style={{ background: 'var(--md-surface-container-high)', borderColor: 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
      />
      {hint && <span className="text-[9px] mt-0.5 block" style={{ color: 'var(--md-on-surface-variant)' }}>{hint}</span>}
    </div>
  );
}

/** Stat box for sync results */
function StatBox({ label, value, color }) {
  return (
    <div className="text-center p-2 rounded-lg" style={{ background: 'var(--md-surface-container-high)' }}>
      <div className="text-[18px] font-bold" style={{ color }}>{value}</div>
      <div className="text-[9px] font-medium" style={{ color: 'var(--md-on-surface-variant)' }}>{label}</div>
    </div>
  );
}

/** Reusable file list section for scan results */
function FileListSection({ title, subtitle, files, selected, onToggle, onSelectAll, color, bgColor, borderColor, badgeLabel, showRevisionInfo, showDuplicateReason, systems, fileKeyPrefix, fileSystemOverrides, onSystemOverride }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--md-surface-container)', borderColor: 'var(--md-outline-variant)' }}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-semibold" style={{ color }}>
          {title} ({files.length})
        </div>
        <button
          onClick={onSelectAll}
          className="text-[10px] font-medium cursor-pointer"
          style={{ color: 'var(--md-on-surface-variant)' }}
        >
          {selected.size === files.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      {subtitle && (
        <p className="text-[9px] mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>{subtitle}</p>
      )}

      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {files.map((file, i) => {
          const overrideKey = `${fileKeyPrefix}-${i}`;
          const assignedSystem = fileSystemOverrides?.[overrideKey] || file.detectedSystem?.id || '';
          return (
            <div
              key={file.key}
              className="rounded-lg transition-colors"
              style={{
                background: selected.has(i) ? bgColor : 'transparent',
                border: `1px solid ${selected.has(i) ? borderColor : 'var(--md-outline-variant)'}`,
              }}
            >
              <label className="flex items-center gap-2 px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => onToggle(i)}
                  className="accent-emerald-400"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium truncate" style={{ color: 'var(--md-on-surface)' }}>
                    {file.parsed?.drawingNumber || file.key.split('/').pop()}
                  </div>
                  <div className="text-[9px] truncate" style={{ color: 'var(--md-on-surface-variant)' }}>
                    {file.key}
                  </div>
                  {showRevisionInfo && file.existingRevision != null && (
                    <div className="text-[9px] mt-0.5" style={{ color: '#8AB4FF' }}>
                      Existing: Rev {file.existingRevision} → New: Rev {file.newRevision || file.parsed?.revision || '?'}
                    </div>
                  )}
                  {showDuplicateReason && file.reason && (
                    <div className="text-[9px] mt-0.5" style={{ color: '#F39C12' }}>
                      {file.reason}
                    </div>
                  )}
                </div>
                <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase shrink-0" style={{ background: bgColor, color, border: `1px solid ${borderColor}` }}>
                  {badgeLabel}
                </span>
                {file.parsed?.revision && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0" style={{ background: 'rgba(138,180,255,0.1)', color: '#8AB4FF' }}>
                    Rev {file.parsed.revision}
                  </span>
                )}
                {file.size && (
                  <span className="text-[9px] shrink-0" style={{ color: 'var(--md-on-surface-variant)' }}>
                    {formatBytes(file.size)}
                  </span>
                )}
              </label>
              {/* Per-file system assignment */}
              {systems && systems.length > 0 && selected.has(i) && (
                <div className="flex items-center gap-2 px-3 pb-2">
                  <span className="text-[9px] shrink-0" style={{ color: 'var(--md-on-surface-variant)' }}>System:</span>
                  <select
                    value={assignedSystem}
                    onChange={e => { e.stopPropagation(); onSystemOverride?.(overrideKey, e.target.value); }}
                    onClick={e => e.stopPropagation()}
                    className="flex-1 px-2 py-1 rounded border text-[10px] outline-none cursor-pointer"
                    style={{ background: 'var(--md-surface-container-high)', borderColor: assignedSystem ? 'var(--md-primary)' : 'var(--md-outline-variant)', color: 'var(--md-on-surface)' }}
                  >
                    <option value="">Unassigned — assign later</option>
                    {systems.map(s => (
                      <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                    ))}
                  </select>
                  {file.detectedSystem && !fileSystemOverrides?.[overrideKey] && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(79,226,176,0.1)', color: 'var(--md-primary)' }}>
                      auto-detected
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
