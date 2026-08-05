import { useState } from 'react';
import VisionCredentialsPanel from './VisionCredentialsPanel';
import AiConfigCard from './AiConfigCard';
import VisualDetectionConfigCard from './VisualDetectionConfigCard';
import TagDictionaryCard from './TagDictionaryCard';
import { useVisionConfig, useAiConfig, useVisualConfig, useOcrProvider, useSaveOcrProvider, usePromptPreview, useLearningHistory } from '../../hooks/useOcrPipelineV2';

/**
 * PipelineSettingsDrawer — Right-side slide-over drawer consolidating all
 * pipeline configuration: Storage summary, Vision API, Claude AI, and
 * Classification Rules (Tag Dictionary).
 */
export default function PipelineSettingsDrawer({ platformId, platform, batches, onClose }) {
  const [openSection, setOpenSection] = useState('vision'); // storage | vision | ai | visual | prompt | provider | dictionary
  const { data: visionConfig } = useVisionConfig(platformId);
  const { data: aiConfig } = useAiConfig(platformId);
  const { data: visualConfig } = useVisualConfig(platformId);
  const { data: ocrProviderConfig } = useOcrProvider(platformId);
  const saveOcrProvider = useSaveOcrProvider();

  const toggle = (key) => setOpenSection(prev => prev === key ? null : key);

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 h-full w-[480px] bg-md-surface-container z-50 shadow-2xl flex flex-col"
        style={{ animation: 'slideInRight 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 h-14 border-b border-md-outline-variant/20 shrink-0">
          <span className="material-symbols-outlined text-[22px] text-md-primary">settings</span>
          <div className="flex-1">
            <div className="text-title-sm font-bold text-md-on-surface">Pipeline Settings</div>
            <div className="text-label-sm text-md-on-surface-variant">
              {platform?.code} — {platform?.name}
            </div>
          </div>
          <button onClick={onClose} className="md-icon-btn w-8 h-8">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Section 1: Storage (read-only summary) */}
          <AccordionSection
            icon="cloud"
            title="Storage"
            subtitle={platform?.hasStorage
              ? `${platform.storageProvider?.toUpperCase()} — ${platform.storageBucket}`
              : 'Not configured'
            }
            isOpen={openSection === 'storage'}
            onToggle={() => toggle('storage')}
            status={platform?.hasStorage ? 'ok' : 'warning'}
          >
            <div className="px-5 py-4">
              {platform?.hasStorage ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold flex items-center gap-1">
                      <span className="material-symbols-outlined text-[10px]">check_circle</span>
                      Connected
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-body-sm">
                    <div>
                      <div className="text-label-sm text-md-on-surface-variant mb-0.5">Provider</div>
                      <div className="text-md-on-surface font-semibold">{platform.storageProvider?.toUpperCase()}</div>
                    </div>
                    <div>
                      <div className="text-label-sm text-md-on-surface-variant mb-0.5">Bucket</div>
                      <div className="text-md-on-surface font-mono text-[12px]">{platform.storageBucket}</div>
                    </div>
                  </div>
                  <p className="text-label-sm text-md-on-surface-variant/70 mt-2">
                    Storage is configured in the Admin panel.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-md bg-amber-900/10 border border-amber-600/20">
                  <span className="material-symbols-outlined text-[20px] text-amber-400">warning</span>
                  <div>
                    <div className="text-body-sm text-amber-300 font-semibold">No storage configured</div>
                    <div className="text-label-sm text-md-on-surface-variant">
                      Configure cloud storage in the Admin panel to browse and process P&ID files.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </AccordionSection>

          {/* Section 2: Vision API */}
          <AccordionSection
            icon="visibility"
            iconColor="#A855F7"
            title="Vision API"
            subtitle={visionConfig?.hasVisionCredentials ? 'Configured' : 'Not configured'}
            isOpen={openSection === 'vision'}
            onToggle={() => toggle('vision')}
            status={visionConfig?.hasVisionCredentials ? 'ok' : 'warning'}
          >
            <VisionCredentialsPanel platformId={platformId} embedded />
          </AccordionSection>

          {/* Section 3: Claude AI */}
          <AccordionSection
            icon="psychology"
            iconColor="#F59E0B"
            title="Claude AI"
            subtitle={aiConfig?.hasAiCredentials
              ? `${aiConfig.source === 'env' ? 'Env var' : 'Configured'} — ${aiConfig.aiModel || 'default'}`
              : 'Not configured'
            }
            isOpen={openSection === 'ai'}
            onToggle={() => toggle('ai')}
            status={aiConfig?.hasAiCredentials ? 'ok' : 'neutral'}
          >
            <AiConfigCard platformId={platformId} embedded />
          </AccordionSection>

          {/* Section 4: OCR Provider Selection */}
          <AccordionSection
            icon="capture"
            iconColor="#3BE494"
            title="Visual Detector"
            subtitle={visualConfig?.endpointUrl ? `${visualConfig.provider === 'trex2' ? 'T-Rex2' : 'GroundingDINO'} configured` : 'Not configured'}
            isOpen={openSection === 'visual'}
            onToggle={() => toggle('visual')}
            status={visualConfig?.endpointUrl ? 'ok' : 'warning'}
          >
            <VisualDetectionConfigCard platformId={platformId} embedded />
          </AccordionSection>

          {/* Section 5: Prompt & Learning */}
          <AccordionSection
            icon="lab_profile"
            iconColor="#8AB4FF"
            title="Prompt & Learning"
            subtitle="Inspect effective prompt and learning history"
            isOpen={openSection === 'prompt'}
            onToggle={() => toggle('prompt')}
            status="neutral"
          >
            <PromptLearningPanel
              platformId={platformId}
              platform={platform}
            />
          </AccordionSection>

          {/* Section 6: OCR Provider Selection */}
          <AccordionSection
            icon="document_scanner"
            iconColor="#60A5FA"
            title="OCR Provider"
            subtitle={
              ocrProviderConfig?.provider === 'claude' ? 'Claude Vision'
              : ocrProviderConfig?.provider === 'both' ? 'Google + Claude (merged)'
              : ocrProviderConfig?.provider === 'paddle' ? 'Paddle OCR'
              : ocrProviderConfig?.provider === 'florence' ? 'Florence-2 OCR'
              : 'Google Vision'
            }
            isOpen={openSection === 'provider'}
            onToggle={() => toggle('provider')}
            status="neutral"
          >
            <OcrProviderSelector
              currentProvider={ocrProviderConfig?.provider || 'google'}
              hasVision={!!visionConfig?.hasVisionCredentials}
              hasAi={!!aiConfig?.hasAiCredentials}
              paddleReady={!!ocrProviderConfig?.paddleReady}
              florenceReady={!!ocrProviderConfig?.florenceReady}
              onSave={(provider) => saveOcrProvider.mutate({ platformId, provider })}
              isSaving={saveOcrProvider.isPending}
            />
          </AccordionSection>

          {/* Section 7: Classification Rules (Tag Dictionary) */}
          <AccordionSection
            icon="dictionary"
            iconColor="#3BE494"
            title="Classification Rules"
            subtitle="Tag dictionary for client-specific patterns"
            isOpen={openSection === 'dictionary'}
            onToggle={() => toggle('dictionary')}
            status="neutral"
          >
            <div className="pb-2">
              <TagDictionaryCard platformId={platformId} batches={batches} embedded />
            </div>
          </AccordionSection>
        </div>
      </div>
    </>
  );
}

function PromptLearningPanel({ platformId, platform }) {
  const [days, setDays] = useState(30);
  const [showPrompt, setShowPrompt] = useState(false);
  const { data: promptData, isLoading: promptLoading, refetch: refetchPrompt } = usePromptPreview(platformId, {
    platformCode: platform?.code,
    platformName: platform?.name,
  });
  const { data: learningData, isLoading: learningLoading, refetch: refetchLearning } = useLearningHistory(platformId, days);

  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => { refetchPrompt(); refetchLearning(); }}
          className="px-2 py-1 rounded text-[11px] font-semibold bg-md-primary/15 text-md-primary hover:bg-md-primary/25"
        >
          Refresh
        </button>
        <button
          onClick={() => setShowPrompt(v => !v)}
          className="px-2 py-1 rounded text-[11px] font-semibold bg-md-on-surface/5 text-md-on-surface-variant hover:bg-md-on-surface/10"
        >
          {showPrompt ? 'Hide Prompt' : 'Show Prompt'}
        </button>
        <div className="flex-1" />
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="px-2 py-1 bg-md-surface border border-md-outline-variant/30 rounded text-[11px] text-md-on-surface"
        >
          <option value={14}>14d</option>
          <option value={30}>30d</option>
          <option value={60}>60d</option>
          <option value={90}>90d</option>
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="p-2 rounded bg-md-on-surface/5">
          <div className="text-md-on-surface-variant">Dictionary rules</div>
          <div className="text-md-on-surface font-bold">{promptData?.dictionaryCount ?? '—'}</div>
        </div>
        <div className="p-2 rounded bg-md-on-surface/5">
          <div className="text-md-on-surface-variant">Learned patterns</div>
          <div className="text-md-on-surface font-bold">{promptData?.learnedPatternCount ?? '—'}</div>
        </div>
        <div className="p-2 rounded bg-md-on-surface/5">
          <div className="text-md-on-surface-variant">Feedback events</div>
          <div className="text-md-on-surface font-bold">{learningData?.summary?.totalFeedbackEvents ?? '—'}</div>
        </div>
      </div>

      <div className="p-2 rounded bg-md-on-surface/5 text-[10px] text-md-on-surface-variant">
        Prompt input is built from: Tag Dictionary + Learned Patterns + OCR words + grouped candidates.
        Model memory is not persistent by itself; learning persists in DB and is re-injected into prompts.
      </div>

      {showPrompt && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-md-on-surface-variant">Resolved Stage 2 User Prompt</div>
          <pre className="max-h-56 overflow-auto p-2 rounded bg-black/20 text-[10px] text-md-on-surface whitespace-pre-wrap break-words">
            {promptLoading ? 'Loading prompt preview...' : (promptData?.userPrompt || 'Prompt preview unavailable')}
          </pre>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-md-on-surface-variant">Recent learned patterns</div>
        <div className="max-h-40 overflow-auto rounded border border-md-outline-variant/20">
          {learningLoading ? (
            <div className="p-2 text-[10px] text-md-on-surface-variant">Loading learning history...</div>
          ) : !learningData?.patterns?.length ? (
            <div className="p-2 text-[10px] text-md-on-surface-variant">No learned patterns yet.</div>
          ) : (
            learningData.patterns.slice(0, 20).map((p, i) => (
              <div key={`${p.pattern_key}-${i}`} className="px-2 py-1 text-[10px] border-b border-md-outline-variant/10">
                <span className="text-md-on-surface font-semibold">{p.pattern_key}</span>
                <span className="text-md-on-surface-variant">{` -> ${p.target_type} (support ${p.support_count}, conf ${p.confidence})`}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * OCR Provider selector — Google Vision, Claude Vision, Paddle OCR, Florence-2 OCR, or Both.
 */
function OcrProviderSelector({ currentProvider, hasVision, hasAi, paddleReady, florenceReady, onSave, isSaving }) {
  const providers = [
    {
      key: 'google',
      label: 'Google Vision',
      icon: 'visibility',
      color: '#A855F7',
      desc: 'Google Cloud Vision API — best for precise word-level bounding boxes and coordinates.',
      requires: 'Vision API credentials',
      available: hasVision,
    },
    {
      key: 'claude',
      label: 'Claude Vision',
      icon: 'psychology',
      color: '#F59E0B',
      desc: 'Claude AI vision — processes PDFs directly, understands engineering context, discovers more tags.',
      requires: 'Claude API key',
      available: hasAi,
    },
    {
      key: 'paddle',
      label: 'Paddle OCR',
      icon: 'text_snippet',
      color: '#3BE494',
      desc: 'Text-first OCR for dense technical drawings with multi-oriented tags and annotation-friendly boxes.',
      requires: 'PADDLE_OCR_URL runtime config',
      available: paddleReady,
    },
    {
      key: 'florence',
      label: 'Florence-2 OCR',
      icon: 'model_training',
      color: '#22C55E',
      desc: 'Florence-2 OCR with region grounding, good for technical drawing text and rotated tags.',
      requires: 'FLORENCE_OCR_URL runtime config',
      available: florenceReady,
    },
    {
      key: 'both',
      label: 'Both (Merged)',
      icon: 'merge',
      color: '#60A5FA',
      desc: 'Run both providers and merge results. Google for coordinates, Claude for extra tag discovery.',
      requires: 'Both Vision API and Claude API',
      available: hasVision && hasAi,
    },
  ];

  return (
    <div className="px-5 py-4 space-y-2">
      {providers.map(p => (
        <button
          key={p.key}
          onClick={() => {
            if (p.available && p.key !== currentProvider) onSave(p.key);
          }}
          disabled={!p.available || isSaving}
          className={`w-full text-left p-3 rounded-md border transition-all ${
            currentProvider === p.key
              ? 'border-md-primary/50 bg-md-primary/8'
              : p.available
                ? 'border-md-outline-variant/20 hover:border-md-outline-variant/40 hover:bg-md-on-surface/3'
                : 'border-md-outline-variant/10 opacity-50 cursor-not-allowed'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-[18px]" style={{ color: p.color }}>{p.icon}</span>
            <span className="text-body-sm font-bold text-md-on-surface">{p.label}</span>
            {currentProvider === p.key && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold ml-auto">
                Active
              </span>
            )}
            {!p.available && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold ml-auto">
                {p.requires}
              </span>
            )}
          </div>
          <div className="text-label-sm text-md-on-surface-variant pl-[26px]">{p.desc}</div>
        </button>
      ))}
      <p className="text-[10px] text-md-on-surface-variant/60 pt-1">
        Provider selection applies to new batches. Existing batches keep their original provider.
      </p>
    </div>
  );
}

/**
 * Collapsible accordion section for the settings drawer.
 */
function AccordionSection({ icon, iconColor, title, subtitle, isOpen, onToggle, status, children }) {
  const statusIcon = status === 'ok' ? 'check_circle' : status === 'warning' ? 'warning' : null;
  const statusColor = status === 'ok' ? '#3BE494' : status === 'warning' ? '#F39C12' : '#919A9B';

  return (
    <div className="border-b border-md-outline-variant/15">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-md-on-surface/3 transition-colors"
      >
        <span
          className="material-symbols-outlined text-[20px]"
          style={{ color: iconColor || '#919A9B' }}
        >
          {icon}
        </span>
        <div className="flex-1 text-left min-w-0">
          <div className="text-body-sm font-bold text-md-on-surface">{title}</div>
          <div className="text-label-sm text-md-on-surface-variant truncate">{subtitle}</div>
        </div>
        {statusIcon && (
          <span className="material-symbols-outlined text-[16px]" style={{ color: statusColor }}>
            {statusIcon}
          </span>
        )}
        <span className={`material-symbols-outlined text-[18px] text-md-on-surface-variant transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>
      {isOpen && (
        <div className="bg-md-surface/30">
          {children}
        </div>
      )}
    </div>
  );
}
