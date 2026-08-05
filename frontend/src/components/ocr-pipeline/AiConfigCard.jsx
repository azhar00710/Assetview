import { useState, useCallback, useEffect } from 'react';
import { useAiConfig, useSaveAiConfig, useTestAiConnection } from '../../hooks/useOcrPipelineV2';

/**
 * AiConfigCard — inline panel for configuring Claude AI API credentials.
 * Follows same pattern as VisionCredentialsPanel.
 */
export default function AiConfigCard({ platformId, onClose, embedded = false }) {
  const { data: aiConfig, isLoading } = useAiConfig(platformId);
  const saveConfig = useSaveAiConfig();
  const testAi = useTestAiConnection();

  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [testResult, setTestResult] = useState(null);
  const [keyValid, setKeyValid] = useState(false);

  useEffect(() => {
    if (aiConfig?.aiModel) setModel(aiConfig.aiModel);
  }, [aiConfig]);

  useEffect(() => {
    setKeyValid(apiKey.startsWith('sk-ant-') && apiKey.length > 20);
  }, [apiKey]);

  const handleTest = useCallback(() => {
    setTestResult(null);
    testAi.mutate(
      { platformId, apiKey: apiKey || undefined },
      { onSuccess: (result) => setTestResult(result) }
    );
  }, [platformId, apiKey, testAi]);

  const handleSave = useCallback(() => {
    saveConfig.mutate(
      { platformId, apiKey, model },
      { onSuccess: () => setTestResult({ ok: true, message: 'Saved successfully' }) }
    );
  }, [platformId, apiKey, model, saveConfig]);

  if (isLoading) {
    return (
      <div className={`px-4 py-3 ${embedded ? '' : 'bg-md-surface-container border-b border-md-outline-variant/20'}`}>
        <span className="text-label-sm text-md-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
          Loading AI config...
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={e => e.preventDefault()} className={`px-4 py-3 ${embedded ? '' : 'bg-md-surface-container border-b border-md-outline-variant/20'}`}>
      {/* Header — hidden when embedded */}
      {!embedded && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]" style={{ color: '#F59E0B' }}>psychology</span>
            <span className="text-title-sm font-bold text-md-on-surface">Claude AI Credentials</span>
            {aiConfig?.hasAiCredentials && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px]">check_circle</span>
                {aiConfig.source === 'env' ? 'Env var' : 'Configured'}
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

      {/* Current source info */}
      {aiConfig?.hasAiCredentials && aiConfig.source !== 'none' && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"
            style={{ background: 'rgba(59,228,148,0.12)', color: '#3BE494' }}>
            <span className="material-symbols-outlined text-[10px]">check_circle</span>
            {aiConfig.source === 'global' ? 'From Admin — Global' :
             aiConfig.source === 'platform' ? 'Platform override' :
             'Environment variable'}
          </span>
          <span className="text-[10px] text-md-on-surface-variant font-mono">{aiConfig.aiModel}</span>
        </div>
      )}

      {/* API Key input */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <label className="text-label-sm text-md-on-surface-variant font-semibold">
            Anthropic API Key
          </label>
          {apiKey.trim() && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5 ${
              keyValid ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
            }`}>
              <span className="material-symbols-outlined text-[10px]">{keyValid ? 'check' : 'close'}</span>
              {keyValid ? 'Valid format' : 'Must start with sk-ant-'}
            </span>
          )}
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="sk-ant-api03-..."
          className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface font-mono focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          autoComplete="off"
        />
      </div>

      {/* Model selector */}
      <div className="mb-3">
        <label className="text-label-sm text-md-on-surface-variant font-semibold mb-1 block">
          AI Model
        </label>
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        >
          <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (Recommended)</option>
          <option value="claude-opus-4-20250514">Claude Opus 4 (Higher quality, slower)</option>
          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Faster, cheaper)</option>
        </select>
      </div>

      {/* Test result */}
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
          disabled={testAi.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold border border-md-outline-variant/30 text-md-on-surface-variant hover:bg-md-on-surface/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {testAi.isPending ? (
            <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-[14px]">science</span>
          )}
          Test Connection
        </button>

        <button
          onClick={handleSave}
          disabled={saveConfig.isPending || !keyValid}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          style={{ backgroundColor: '#F59E0B' }}
        >
          {saveConfig.isPending ? (
            <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-[14px]">save</span>
          )}
          Save AI Credentials
        </button>
      </div>
    </form>
  );
}
