import { useState, useCallback, useEffect } from 'react';
import { md } from '../../lib/theme';
import { useVisionConfig, useSaveVisionConfig, useTestVisionApi } from '../../hooks/useOcrPipelineV2';

/**
 * VisionCredentialsPanel — inline panel for configuring Google Cloud Vision API credentials.
 * Defaults to using the same credentials as storage config. Allows override with separate Vision credentials.
 */
export default function VisionCredentialsPanel({ platformId, onClose, embedded = false }) {
  const { data: visionConfig, isLoading } = useVisionConfig(platformId);
  const saveConfig = useSaveVisionConfig();
  const testVision = useTestVisionApi();

  const [useSeparate, setUseSeparate] = useState(false);
  const [credentialsJson, setCredentialsJson] = useState('');
  const [jsonValid, setJsonValid] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Sync toggle from server state
  useEffect(() => {
    if (visionConfig) {
      setUseSeparate(visionConfig.usesSeparateCredentials);
    }
  }, [visionConfig]);

  // Validate JSON on change
  useEffect(() => {
    if (!credentialsJson.trim()) {
      setJsonValid(false);
      return;
    }
    try {
      const parsed = JSON.parse(credentialsJson);
      setJsonValid(!!(parsed.project_id && parsed.private_key));
    } catch {
      setJsonValid(false);
    }
  }, [credentialsJson]);

  const handleTest = useCallback(() => {
    setTestResult(null);
    testVision.mutate(
      { platformId, credentialsJson: useSeparate ? credentialsJson : undefined },
      { onSuccess: (result) => setTestResult(result) }
    );
  }, [platformId, useSeparate, credentialsJson, testVision]);

  const handleSave = useCallback(() => {
    saveConfig.mutate(
      { platformId, visionCredentialsJson: useSeparate ? credentialsJson : null },
      {
        onSuccess: () => {
          setTestResult({ ok: true, message: 'Saved successfully' });
        },
      }
    );
  }, [platformId, useSeparate, credentialsJson, saveConfig]);

  const handleToggle = useCallback((separate) => {
    setUseSeparate(separate);
    setTestResult(null);
    if (!separate) {
      setCredentialsJson('');
    }
  }, []);

  if (isLoading) {
    return (
      <div className={`px-4 py-3 ${embedded ? '' : 'bg-md-surface-container border-b border-md-outline-variant/20'}`}>
        <span className="text-label-sm text-md-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
          Loading Vision config...
        </span>
      </div>
    );
  }

  return (
    <div className={`px-4 py-3 ${embedded ? '' : 'bg-md-surface-container border-b border-md-outline-variant/20'}`}>
      {/* Header — hidden when embedded (parent drawer provides header) */}
      {!embedded && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]" style={{ color: '#A855F7' }}>visibility</span>
            <span className="text-title-sm font-bold text-md-on-surface">Vision API Credentials</span>
            {visionConfig?.hasVisionCredentials && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px]">check_circle</span>
                {visionConfig.source === 'global' ? 'From Admin — Global' : 'Configured'}
              </span>
            )}
          </div>
          {onClose && (
            <button onClick={onClose} className="md-icon-btn w-6 h-6">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>
      )}

      {/* Toggle */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => handleToggle(false)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold transition-all ${
            !useSeparate
              ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30'
              : 'text-md-on-surface-variant hover:bg-md-on-surface/5'
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">link</span>
          Use storage credentials
        </button>
        <button
          onClick={() => handleToggle(true)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold transition-all ${
            useSeparate
              ? 'bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/30'
              : 'text-md-on-surface-variant hover:bg-md-on-surface/5'
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">key</span>
          Separate Vision credentials
        </button>
      </div>

      {!useSeparate && (
        <p className="text-body-sm text-md-on-surface-variant mb-3">
          Vision API will use the same service account as your GCS storage config.
          Make sure the Cloud Vision API is enabled in your Google Cloud project.
        </p>
      )}

      {/* Separate credentials form */}
      {useSeparate && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <label className="text-label-sm text-md-on-surface-variant font-semibold">
              Service Account JSON
            </label>
            {credentialsJson.trim() && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5 ${
                jsonValid
                  ? 'bg-green-500/15 text-green-400'
                  : 'bg-red-500/15 text-red-400'
              }`}>
                <span className="material-symbols-outlined text-[10px]">
                  {jsonValid ? 'check' : 'close'}
                </span>
                {jsonValid ? 'Valid JSON' : 'Invalid'}
              </span>
            )}
          </div>
          <textarea
            value={credentialsJson}
            onChange={e => setCredentialsJson(e.target.value)}
            placeholder='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
            rows={6}
            className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface font-mono resize-y focus:outline-none focus:ring-1 focus:ring-purple-500/50"
            spellCheck={false}
          />
        </div>
      )}

      {/* Test result banner */}
      {testResult && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-md-md mb-3 ${
          testResult.ok
            ? 'bg-green-900/20 border border-green-600/30'
            : 'bg-red-900/20 border border-red-600/30'
        }`}>
          <span className={`material-symbols-outlined text-[16px] ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.ok ? 'check_circle' : 'error'}
          </span>
          <span className={`text-body-sm font-semibold ${testResult.ok ? 'text-green-300' : 'text-red-300'}`}>
            {testResult.message}
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testVision.isPending || (useSeparate && !jsonValid)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold border border-md-outline-variant/30 text-md-on-surface-variant hover:bg-md-on-surface/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {testVision.isPending ? (
            <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-[14px]">science</span>
          )}
          Test Vision API
        </button>

        {useSeparate && (
          <button
            onClick={handleSave}
            disabled={saveConfig.isPending || !jsonValid}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            style={{ backgroundColor: '#A855F7' }}
          >
            {saveConfig.isPending ? (
              <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[14px]">save</span>
            )}
            Save Vision Credentials
          </button>
        )}

        {!useSeparate && visionConfig?.usesSeparateCredentials && (
          <button
            onClick={() => {
              saveConfig.mutate(
                { platformId, visionCredentialsJson: null },
                { onSuccess: () => setTestResult({ ok: true, message: 'Cleared separate credentials — now using storage credentials' }) }
              );
            }}
            disabled={saveConfig.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 disabled:opacity-40 transition-all"
          >
            <span className="material-symbols-outlined text-[14px]">delete</span>
            Clear separate credentials
          </button>
        )}
      </div>
    </div>
  );
}
