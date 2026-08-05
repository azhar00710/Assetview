import { useEffect, useMemo, useState } from 'react';
import { useSaveVisualConfig, useTestVisualConnection, useVisualConfig, useGroundingConfig, useSaveGroundingConfig } from '../../hooks/useOcrPipelineV2';

// Canonical DDS Cloud API endpoints. Confirmed working as of Apr 2026.
// If DDS ever moves them, update these constants in one place.
const DEFAULT_TREX2_ENDPOINT = 'https://api.deepdataspace.com/v2/task/trex/detection';
const DEFAULT_GROUNDING_ENDPOINT = 'https://api.deepdataspace.com/v2/task/grounding_dino/detection';
const DEFAULT_TREX2_MODEL = 'T-Rex-2.0';
const DEFAULT_GROUNDING_MODEL = 'GroundingDino-1.6-Pro';

export default function VisualDetectionConfigCard({ platformId, embedded = false }) {
  const { data: visualConfig, isLoading } = useVisualConfig(platformId);
  const { data: groundingConfig, isLoading: groundingLoading } = useGroundingConfig(platformId);
  const saveConfig = useSaveVisualConfig();
  const saveGrounding = useSaveGroundingConfig();
  const testConfig = useTestVisualConnection();

  // T-Rex2 state — pre-fill with the recommended URL so first-time setup is one click.
  const [trexUrl, setTrexUrl] = useState(DEFAULT_TREX2_ENDPOINT);
  const [trexToken, setTrexToken] = useState('');
  const [trexModel, setTrexModel] = useState(DEFAULT_TREX2_MODEL);
  const [trexTestResult, setTrexTestResult] = useState(null);

  // GroundingDINO state — same pattern.
  const [gUrl, setGUrl] = useState(DEFAULT_GROUNDING_ENDPOINT);
  const [gToken, setGToken] = useState('');
  const [gModel, setGModel] = useState(DEFAULT_GROUNDING_MODEL);
  const [gTestResult, setGTestResult] = useState(null);

  // Load T-Rex2 config from DB. If the server has an endpoint, use it; otherwise
  // keep the recommended default we initialised with so the field is never empty.
  useEffect(() => {
    if (!visualConfig) return;
    if (visualConfig.endpointUrl) setTrexUrl(visualConfig.endpointUrl);
    if (visualConfig.model) setTrexModel(visualConfig.model);
  }, [visualConfig]);

  useEffect(() => {
    if (!groundingConfig) return;
    if (groundingConfig.endpointUrl) setGUrl(groundingConfig.endpointUrl);
    if (groundingConfig.model) setGModel(groundingConfig.model);
  }, [groundingConfig]);

  const trexUrlValid = useMemo(() => /^https?:\/\/.+/i.test(trexUrl.trim()), [trexUrl]);
  const gUrlValid = useMemo(() => /^https?:\/\/.+/i.test(gUrl.trim()), [gUrl]);

  // T-Rex2 handlers
  // Only send token if user typed a new one — empty field preserves existing stored token
  const handleSaveTrex = () => {
    const payload = { platformId, provider: 'trex2', endpointUrl: trexUrl.trim(), model: trexModel.trim() || null };
    if (trexToken.trim()) payload.token = trexToken.trim();
    saveConfig.mutate(payload, { onSuccess: () => setTrexTestResult({ ok: true, message: 'Saved T-Rex2 config.' }) });
  };
  const handleTestTrex = () => {
    setTrexTestResult(null);
    testConfig.mutate(
      { platformId, provider: 'trex2', endpointUrl: trexUrl.trim(), token: trexToken.trim() || undefined, model: trexModel.trim() || undefined },
      { onSuccess: (res) => setTrexTestResult(res) }
    );
  };

  // GroundingDINO handlers
  const handleSaveGrounding = () => {
    const payload = { platformId, endpointUrl: gUrl.trim(), model: gModel.trim() || null };
    if (gToken.trim()) payload.token = gToken.trim();
    saveGrounding.mutate(payload, { onSuccess: () => setGTestResult({ ok: true, message: 'Saved GroundingDINO config.' }) });
  };
  const handleTestGrounding = () => {
    setGTestResult(null);
    testConfig.mutate(
      { platformId, provider: 'grounding_dino', endpointUrl: gUrl.trim(), token: gToken.trim() || undefined, model: gModel.trim() || undefined },
      { onSuccess: (res) => setGTestResult(res) }
    );
  };

  if (isLoading) {
    return (
      <div className={`px-4 py-3 ${embedded ? '' : 'bg-md-surface-container border-b border-md-outline-variant/20'}`}>
        <span className="text-label-sm text-md-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
          Loading visual detector config...
        </span>
      </div>
    );
  }

  return (
    <div className={`px-4 py-3 space-y-4 ${embedded ? '' : 'bg-md-surface-container border-b border-md-outline-variant/20'}`}>

      {/* ═══ T-Rex2 — Equipment & Instrument Detection ═══ */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-label-sm font-semibold text-[#3BE494]">T-Rex2</span>
          <span className="text-[10px] text-md-on-surface-variant">Equipment & instrument detection (visual matching)</span>
          {visualConfig?.source === 'configured' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold ml-auto">
              Configured
            </span>
          )}
        </div>

        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-label-sm text-md-on-surface-variant font-semibold">Endpoint URL</label>
              {trexUrl !== DEFAULT_TREX2_ENDPOINT && (
                <button
                  type="button"
                  onClick={() => setTrexUrl(DEFAULT_TREX2_ENDPOINT)}
                  className="text-[10px] text-[#3BE494] hover:underline"
                  title={`Reset to ${DEFAULT_TREX2_ENDPOINT}`}
                >
                  Use recommended
                </button>
              )}
            </div>
            <input
              type="text"
              value={trexUrl}
              onChange={e => setTrexUrl(e.target.value)}
              placeholder={DEFAULT_TREX2_ENDPOINT}
              className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface font-mono focus:outline-none focus:ring-1 focus:ring-[#3BE494]/50"
            />
          </div>
          <div>
            <label className="text-label-sm text-md-on-surface-variant font-semibold mb-1 block">API Token / Key</label>
            <input
              type="password"
              value={trexToken}
              onChange={e => setTrexToken(e.target.value)}
              placeholder={visualConfig?.hasToken ? 'Stored token exists - paste to replace' : 'Bearer token or API key'}
              className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface focus:outline-none focus:ring-1 focus:ring-[#3BE494]/50"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-label-sm text-md-on-surface-variant font-semibold mb-1 block">Model</label>
            <input
              type="text"
              value={trexModel}
              onChange={e => setTrexModel(e.target.value)}
              placeholder="T-Rex-2.0"
              className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface font-mono focus:outline-none focus:ring-1 focus:ring-[#3BE494]/50"
            />
          </div>
        </div>

        {trexTestResult && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-md-md mt-2 ${
            trexTestResult.ok ? 'bg-green-900/20 border border-green-600/30' : 'bg-red-900/20 border border-red-600/30'
          }`}>
            <span className={`material-symbols-outlined text-[16px] ${trexTestResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {trexTestResult.ok ? 'check_circle' : 'error'}
            </span>
            <span className={`text-body-sm font-semibold ${trexTestResult.ok ? 'text-green-300' : 'text-red-300'}`}>
              {trexTestResult.message}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 mt-2">
          <button type="button" onClick={handleTestTrex} disabled={!trexUrlValid || testConfig.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold border border-md-outline-variant/30 text-md-on-surface-variant hover:bg-md-on-surface/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
            <span className="material-symbols-outlined text-[14px]">science</span>
            Test Endpoint
          </button>
          <button type="button" onClick={handleSaveTrex} disabled={!trexUrlValid || saveConfig.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            style={{ backgroundColor: '#3BE494', color: '#0D1F17' }}>
            <span className="material-symbols-outlined text-[14px]">save</span>
            Save T-Rex2 Config
          </button>
        </div>
      </div>

      {/* ═══ Divider ═══ */}
      <div className="border-t border-md-outline-variant/20" />

      {/* ═══ GroundingDINO — Line Number Detection ═══ */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-label-sm font-semibold text-[#8AB4FF]">GroundingDINO</span>
          <span className="text-[10px] text-md-on-surface-variant">Line number detection (text-prompt matching)</span>
          {groundingConfig?.source === 'configured' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#8AB4FF]/15 text-[#8AB4FF] font-semibold ml-auto">
              Configured
            </span>
          )}
        </div>

        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-label-sm text-md-on-surface-variant font-semibold">Endpoint URL</label>
              {gUrl !== DEFAULT_GROUNDING_ENDPOINT && (
                <button
                  type="button"
                  onClick={() => setGUrl(DEFAULT_GROUNDING_ENDPOINT)}
                  className="text-[10px] text-[#8AB4FF] hover:underline"
                  title={`Reset to ${DEFAULT_GROUNDING_ENDPOINT}`}
                >
                  Use recommended
                </button>
              )}
            </div>
            <input
              type="text"
              value={gUrl}
              onChange={e => setGUrl(e.target.value)}
              placeholder={DEFAULT_GROUNDING_ENDPOINT}
              className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface font-mono focus:outline-none focus:ring-1 focus:ring-[#8AB4FF]/50"
            />
            <div className="mt-1 text-[10px] text-md-on-surface-variant">
              Uses same DDS API key as T-Rex2. Leave token blank to reuse T-Rex2 key.
            </div>
          </div>
          <div>
            <label className="text-label-sm text-md-on-surface-variant font-semibold mb-1 block">API Token (blank = use T-Rex2 token)</label>
            <input
              type="password"
              value={gToken}
              onChange={e => setGToken(e.target.value)}
              placeholder={groundingConfig?.hasToken ? 'Stored token exists' : 'Leave blank to use T-Rex2 token'}
              className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface focus:outline-none focus:ring-1 focus:ring-[#8AB4FF]/50"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-label-sm text-md-on-surface-variant font-semibold mb-1 block">Model</label>
            <input
              type="text"
              value={gModel}
              onChange={e => setGModel(e.target.value)}
              placeholder="GroundingDino-1.6-Pro"
              className="w-full px-3 py-2 rounded-md-md bg-md-surface border border-md-outline-variant/30 text-body-sm text-md-on-surface font-mono focus:outline-none focus:ring-1 focus:ring-[#8AB4FF]/50"
            />
            <div className="mt-1 text-[10px] text-md-on-surface-variant">
              Options: <span className="font-mono">GroundingDino-1.5-Pro</span>, <span className="font-mono">GroundingDino-1.6-Pro</span>, <span className="font-mono">GroundingDino-2.0-Pro</span>
            </div>
          </div>
        </div>

        {gTestResult && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-md-md mt-2 ${
            gTestResult.ok ? 'bg-green-900/20 border border-green-600/30' : 'bg-red-900/20 border border-red-600/30'
          }`}>
            <span className={`material-symbols-outlined text-[16px] ${gTestResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {gTestResult.ok ? 'check_circle' : 'error'}
            </span>
            <span className={`text-body-sm font-semibold ${gTestResult.ok ? 'text-green-300' : 'text-red-300'}`}>
              {gTestResult.message}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 mt-2">
          <button type="button" onClick={handleTestGrounding} disabled={!gUrlValid || testConfig.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold border border-md-outline-variant/30 text-md-on-surface-variant hover:bg-md-on-surface/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
            <span className="material-symbols-outlined text-[14px]">science</span>
            Test Endpoint
          </button>
          <button type="button" onClick={handleSaveGrounding} disabled={!gUrlValid || saveGrounding.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            style={{ backgroundColor: '#8AB4FF', color: '#0D1F17' }}>
            <span className="material-symbols-outlined text-[14px]">save</span>
            Save GroundingDINO Config
          </button>
        </div>
      </div>
    </div>
  );
}
