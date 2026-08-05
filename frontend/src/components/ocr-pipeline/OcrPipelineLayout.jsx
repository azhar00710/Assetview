import { useState, useMemo, useCallback, useEffect } from 'react';
import { md } from '../../lib/theme';
import { useOcrPlatforms, useCreateBatch, useCreateBatchFromExisting, useOcrBatches, useVisionConfig, useAiConfig, useOcrProvider } from '../../hooks/useOcrPipelineV2';
import StorageBrowser from './StorageBrowser';
import ProcessingHistory from './ProcessingHistory';
import BatchReviewPanel from './BatchReviewPanel';
import AiAnalysisLayout from '../ai-analysis/AiAnalysisLayout';
import WorkflowStepper from './WorkflowStepper';
import PipelineSettingsDrawer from './PipelineSettingsDrawer';
import RegisterStagingCard from './RegisterStagingCard';

/**
 * OCR Pipeline V2 — Redesigned with guided workflow stepper.
 *
 * Steps: (1) Setup → (2) Select Files → (3) Process → (4) Review & Analyze → (5) Register & Annotate
 */

export default function OcrPipelineLayout({ onBack, onOpenPnidViewer }) {
  const { data: platforms, isLoading: platformsLoading } = useOcrPlatforms();

  // Navigation state
  const [selectedPlatformId, setSelectedPlatformId] = useState(null);
  const [activeStep, setActiveStep] = useState(2); // 1-4
  const [showSettings, setShowSettings] = useState(false);
  const [analysisBatchId, setAnalysisBatchId] = useState(null);
  const [reviewBatchId, setReviewBatchId] = useState(null);

  // Derive selectedPlatform from fresh platforms data (stays in sync after cache invalidation)
  const selectedPlatform = useMemo(
    () => platforms?.find(p => p.id === selectedPlatformId) || null,
    [platforms, selectedPlatformId]
  );
  const setSelectedPlatform = useCallback((p) => setSelectedPlatformId(p?.id || null), []);

  const createBatch = useCreateBatch();
  const createFromExisting = useCreateBatchFromExisting();

  // Config status
  const { data: visionConfig } = useVisionConfig(selectedPlatform?.id);
  const { data: aiConfig } = useAiConfig(selectedPlatform?.id);
  const { data: ocrProviderConfig } = useOcrProvider(selectedPlatform?.id);

  // Batches
  const { data: batches, isLoading: batchesLoading } = useOcrBatches(selectedPlatform?.id);
  const processingCount = (batches || []).filter(b => b.status === 'processing').length;
  const completedCount = (batches || []).filter(b => b.status === 'completed' || b.status === 'partial').length;
  const totalBatches = (batches || []).length;

  // Derive which step is "completed up to"
  const hasStorage = selectedPlatform?.hasStorage;
  const hasVision = visionConfig?.hasVisionCredentials;
  const hasAi = aiConfig?.hasAiCredentials;
  const ocrProvider = ocrProviderConfig?.provider || 'google';
  const paddleReady = !!ocrProviderConfig?.paddleReady;
  const florenceReady = !!ocrProviderConfig?.florenceReady;
  // Setup is complete when storage is configured AND at least one OCR provider is ready
  const hasOcrProvider = ocrProvider === 'claude' ? hasAi
    : ocrProvider === 'both' ? hasVision && hasAi
    : ocrProvider === 'paddle' ? paddleReady
    : ocrProvider === 'florence' ? florenceReady
    : hasVision; // google (default)
  const setupComplete = hasStorage && hasOcrProvider;

  const annotatedCount = (batches || []).filter(b => b.passedToAnnotation).length;
  const completedUpTo = useMemo(() => {
    if (!setupComplete) return 0;
    if (totalBatches === 0) return 1;
    if (completedCount === 0 && processingCount > 0) return 2;
    if (completedCount > 0 && annotatedCount > 0) return 5;
    if (completedCount > 0) return 4;
    return 2;
  }, [setupComplete, totalBatches, completedCount, processingCount, annotatedCount]);

  // Auto-navigate to appropriate step when platform selected
  useEffect(() => {
    if (!selectedPlatform) return;
    if (!setupComplete) {
      setActiveStep(1);
      setShowSettings(true);
    } else if (totalBatches === 0) {
      setActiveStep(2);
    } else if (processingCount > 0) {
      setActiveStep(3);
    } else if (completedCount > 0) {
      setActiveStep(4);
    } else {
      setActiveStep(2);
    }
  }, [selectedPlatform?.id, setupComplete, totalBatches, processingCount, completedCount]);

  // Handle OCR launch
  const handleRunOcr = useCallback((storageKeys, batchName, batchOptions = {}) => {
    if (!selectedPlatform) return;
    createBatch.mutate(
      {
        platformId: selectedPlatform.id,
        storageKeys,
        batchName,
        ocrProvider: batchOptions.ocrProvider || ocrProviderConfig?.provider || 'google',
        storageConfigId: batchOptions.storageConfigId,
        aiModel: batchOptions.aiModel,
      },
      { onSuccess: () => setActiveStep(3) }
    );
  }, [selectedPlatform, createBatch, ocrProviderConfig]);

  // Handle "Use Existing OCR" — create batch from already-extracted OCR files
  const handleUseExistingOcr = useCallback((files, batchName) => {
    if (!selectedPlatform) return;
    createFromExisting.mutate(
      { platformId: selectedPlatform.id, files, batchName },
      { onSuccess: () => setActiveStep(3) }
    );
  }, [selectedPlatform, createFromExisting]);

  // Handle "Analyze with AI" from review
  const handleOpenAnalysis = useCallback((batchId) => {
    setAnalysisBatchId(batchId);
    setActiveStep(4);
  }, []);

  // Handle "Review Results" from ProcessingHistory
  const handleReviewBatch = useCallback((batchId) => {
    setReviewBatchId(batchId);
    setActiveStep(4);
  }, []);

  // Auto-select latest batch for analysis
  const effectiveBatchId = useMemo(() => {
    if (analysisBatchId) return analysisBatchId;
    if (!batches?.length) return null;
    const completed = batches.filter(b => b.status === 'completed' || b.status === 'partial');
    return completed.length > 0 ? completed[0].id : batches[0].id;
  }, [analysisBatchId, batches]);

  // Step click handler
  const handleStepClick = useCallback((step) => {
    setActiveStep(step);
  }, []);

  // Settings click from stepper step 1
  const handleSettingsClick = useCallback(() => {
    setShowSettings(true);
  }, []);

  // ═══ PLATFORM SELECTION SCREEN ═══
  if (!selectedPlatform) {
    return (
      <div className="flex flex-col h-full bg-md-surface overflow-hidden">
        <div className="flex items-center px-4 h-14 bg-md-surface-container shadow-md-1 gap-3 shrink-0 z-10">
          <button onClick={onBack} className="md-icon-btn w-8 h-8">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
          <span className="material-symbols-outlined text-[22px]" style={{ color: md.tertiary }}>document_scanner</span>
          <div className="flex flex-col leading-none">
            <span className="text-title-sm text-md-on-surface font-bold">OCR Pipeline</span>
            <span className="text-label-sm text-md-on-surface-variant">Select a platform to start</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {platformsLoading ? (
            <div className="flex items-center justify-center h-64 text-md-on-surface-variant">
              <span className="material-symbols-outlined animate-spin text-[20px] mr-2">progress_activity</span>
              Loading platforms...
            </div>
          ) : !platforms?.length ? (
            <div className="flex flex-col items-center justify-center h-64 text-md-on-surface-variant">
              <span className="material-symbols-outlined text-[40px] opacity-30 mb-2">info</span>
              <span className="text-body-md">No platforms found</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 max-w-5xl mx-auto">
              {platforms.map(p => (
                <PlatformCard key={p.id} platform={p} onClick={() => setSelectedPlatform(p)} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══ PLATFORM SELECTED — STEPPER + CONTENT ═══
  return (
    <div className="flex flex-col h-full bg-md-surface overflow-hidden">
      {/* ═══ SIMPLIFIED TOOLBAR ═══ */}
      <div className="flex items-center px-4 h-14 bg-md-surface-container shadow-md-1 gap-3 shrink-0 z-10">
        <button
          onClick={() => setSelectedPlatform(null)}
          className="md-icon-btn w-8 h-8"
          title="Back to platforms"
        >
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[22px]" style={{ color: md.tertiary }}>document_scanner</span>
          <div className="flex flex-col leading-none">
            <span className="text-title-sm text-md-on-surface font-bold">OCR Pipeline</span>
            <span className="text-label-sm text-md-on-surface-variant">
              {selectedPlatform.code} — {selectedPlatform.name}
            </span>
          </div>
        </div>

        {/* Status dots — compact, read-only */}
        <div className="flex items-center gap-1.5 ml-2">
          <StatusDot ok={hasStorage} label={hasStorage ? 'Storage' : 'No Storage'} icon={hasStorage ? 'cloud_done' : 'cloud_off'} />
          <StatusDot ok={hasVision} label={hasVision ? 'Vision' : 'No Vision'} icon={hasVision ? 'visibility' : 'visibility_off'} color="#A855F7" />
          <StatusDot ok={aiConfig?.hasAiCredentials} label={aiConfig?.hasAiCredentials ? 'Claude AI' : 'No AI Key'} icon="psychology" color="#F59E0B" />
        </div>

        <div className="flex-1" />

        {/* Platform stats */}
        <div className="flex items-center gap-3 text-label-sm">
          <span className="text-md-on-surface-variant">
            <strong className="text-md-on-surface">{selectedPlatform.totalPnids}</strong> P&IDs
          </span>
          <span className="text-md-on-surface-variant">
            <strong className="text-md-on-surface">{selectedPlatform.completedBatches || 0}</strong> batches done
          </span>
          <span className="text-md-on-surface-variant">
            <strong style={{ color: '#3BE494' }}>{selectedPlatform.annotatedBatches || 0}</strong> annotated
          </span>
        </div>

        {/* Single settings gear */}
        <button
          onClick={() => setShowSettings(true)}
          className={`md-icon-btn w-8 h-8 ${showSettings ? 'text-md-primary' : ''}`}
          title="Pipeline Settings"
        >
          <span className="material-symbols-outlined text-[18px]">settings</span>
        </button>
      </div>

      {/* ═══ WORKFLOW STEPPER ═══ */}
      <WorkflowStepper
        activeStep={activeStep}
        completedUpTo={completedUpTo}
        onStepClick={handleStepClick}
        onSettingsClick={handleSettingsClick}
      />

      {/* ═══ BATCH CREATING BANNER ═══ */}
      {createBatch.isPending && (
        <div className="px-4 py-2 bg-amber-900/20 border-b border-amber-600/30 flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined animate-spin text-[16px] text-amber-400">progress_activity</span>
          <span className="text-body-sm text-amber-300 font-semibold">Creating batch and starting OCR pipeline...</span>
        </div>
      )}
      {createBatch.isSuccess && (
        <div className="px-4 py-2 bg-green-900/20 border-b border-green-600/30 flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[16px] text-green-400">check_circle</span>
          <span className="text-body-sm text-green-300 font-semibold">
            Batch created — processing {createBatch.data?.message}
          </span>
          <button
            onClick={() => setActiveStep(3)}
            className="ml-2 text-label-sm text-green-400 underline hover:no-underline"
          >
            View processing
          </button>
        </div>
      )}
      {createFromExisting.isPending && (
        <div className="px-4 py-2 bg-amber-900/20 border-b border-amber-600/30 flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined animate-spin text-[16px]" style={{ color: '#F39C12' }}>progress_activity</span>
          <span className="text-body-sm font-semibold" style={{ color: '#F39C12' }}>Loading existing OCR data from storage...</span>
        </div>
      )}
      {createFromExisting.isSuccess && (
        <div className="px-4 py-2 bg-green-900/20 border-b border-green-600/30 flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[16px] text-green-400">check_circle</span>
          <span className="text-body-sm text-green-300 font-semibold">
            {createFromExisting.data?.message}
          </span>
          <button onClick={() => setActiveStep(3)} className="ml-2 text-label-sm text-green-400 underline hover:no-underline">
            View processing
          </button>
        </div>
      )}

      {/* ═══ CONTENT AREA — Step-based ═══ */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {activeStep === 1 && (
          <SetupChecklist
            hasStorage={hasStorage}
            hasVision={hasVision}
            hasAi={hasAi}
            ocrProvider={ocrProvider}
            onOpenSettings={() => setShowSettings(true)}
            onProceed={() => setActiveStep(2)}
            setupComplete={setupComplete}
          />
        )}

        {activeStep === 2 && (
          <StorageBrowser
            platformId={selectedPlatform.id}
            platformCode={selectedPlatform.code}
            onRunOcr={handleRunOcr}
            onUseExistingOcr={handleUseExistingOcr}
            onBack={() => setSelectedPlatform(null)}
          />
        )}

        {activeStep === 3 && (
          <ProcessingHistory
            platformId={selectedPlatform.id}
            platformCode={selectedPlatform.code}
            onAddMore={() => setActiveStep(2)}
            onAnalyze={handleOpenAnalysis}
            onReview={handleReviewBatch}
          />
        )}

        {activeStep === 4 && (
          analysisBatchId ? (
            batchesLoading && !effectiveBatchId ? (
              <div className="flex items-center justify-center h-full">
                <span className="material-symbols-outlined animate-spin text-[32px] text-purple-400">progress_activity</span>
              </div>
            ) : (
              <AiAnalysisLayout
                batchId={effectiveBatchId}
                platformId={selectedPlatform.id}
                onBack={() => { setAnalysisBatchId(null); }}
              />
            )
          ) : (
            <BatchReviewPanel
              platformId={selectedPlatform.id}
              initialBatchId={reviewBatchId}
            />
          )
        )}

        {activeStep === 5 && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <div className="max-w-5xl mx-auto">
              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <span className="material-symbols-outlined text-[24px]" style={{ color: '#3BE494' }}>inventory_2</span>
                <div>
                  <h2 className="text-title-md text-md-on-surface font-bold">Register & Annotate</h2>
                  <p className="text-body-sm text-md-on-surface-variant">
                    Compare approved tags with existing registers, stage changes, and auto-generate annotations.
                  </p>
                </div>
                <div className="flex-1" />
                <button
                  onClick={() => setActiveStep(4)}
                  className="text-label-sm text-md-on-surface-variant hover:text-md-on-surface"
                >
                  ← Back to Review
                </button>
              </div>

              {/* Register Changes — unified sync + compare + apply workflow */}
              <RegisterStagingCard
                platformId={selectedPlatform.id}
                batches={(batches || []).filter(b => b.status === 'completed' || b.status === 'partial')}
              />
            </div>
          </div>
        )}
      </div>

      {/* ═══ SETTINGS DRAWER ═══ */}
      {showSettings && (
        <PipelineSettingsDrawer
          platformId={selectedPlatform.id}
          platform={selectedPlatform}
          batches={batches}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

/** Compact read-only status dot */
function StatusDot({ ok, label, icon, color }) {
  const bgColor = ok
    ? (color ? `${color}15` : 'rgba(59, 228, 148, 0.12)')
    : 'rgba(245, 158, 11, 0.12)';
  const textColor = ok
    ? (color || '#3BE494')
    : '#F59E0B';

  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"
      style={{ background: bgColor, color: textColor }}
    >
      <span className="material-symbols-outlined text-[12px]">{icon}</span>
      {label}
    </span>
  );
}

/** Step 1 content — Setup checklist card */
function SetupChecklist({ hasStorage, hasVision, hasAi, ocrProvider, onOpenSettings, onProceed, setupComplete }) {
  const providerLabel = ocrProvider === 'claude' ? 'Claude Vision'
    : ocrProvider === 'paddle' ? 'Paddle OCR'
    : ocrProvider === 'florence' ? 'Florence-2 OCR'
    : ocrProvider === 'both' ? 'Google + Claude' : 'Google Vision';

  const visionRequired = ocrProvider === 'google' || ocrProvider === 'both';
  const claudeRequired = ocrProvider === 'claude' || ocrProvider === 'both';

  const items = [
    { label: 'Cloud storage configured', done: hasStorage, required: true },
    {
      label: 'Vision API credentials',
      done: hasVision,
      required: visionRequired,
      note: visionRequired ? null : `Not needed for ${providerLabel}`,
    },
    {
      label: 'Claude AI key',
      done: hasAi,
      required: claudeRequired,
      note: claudeRequired ? `Required for ${providerLabel}` : 'Optional for OCR, required for AI cleanup',
    },
    { label: 'Classification rules', done: false, required: false, note: 'Optional — improves tag accuracy' },
    { label: `OCR Provider: ${providerLabel}`, done: true, required: false, note: 'Change in settings' },
  ];

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-[440px] rounded-md-xl border border-md-outline-variant/20 bg-md-surface-container p-6">
        <div className="flex items-center gap-3 mb-5">
          <span className="material-symbols-outlined text-[28px] text-md-primary">tune</span>
          <div>
            <div className="text-title-md font-bold text-md-on-surface">Complete Setup</div>
            <div className="text-body-sm text-md-on-surface-variant">Configure your pipeline before processing files</div>
          </div>
        </div>

        <div className="space-y-2 mb-5">
          {items.map(item => (
            <div key={item.label} className="flex items-center gap-3 px-3 py-2 rounded-md bg-md-on-surface/3">
              <span
                className="material-symbols-outlined text-[18px]"
                style={{ color: item.done ? '#3BE494' : item.required ? '#F39C12' : '#919A9B' }}
              >
                {item.done ? 'check_circle' : item.required ? 'radio_button_unchecked' : 'radio_button_unchecked'}
              </span>
              <div className="flex-1">
                <span className="text-body-sm text-md-on-surface">{item.label}</span>
                {item.note && (
                  <span className="text-label-sm text-md-on-surface-variant ml-1">— {item.note}</span>
                )}
              </div>
              {item.required && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold">
                  Required
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-4 py-2 rounded-md-full text-label-md font-semibold border border-md-outline-variant/30 text-md-on-surface-variant hover:bg-md-on-surface/5 transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">settings</span>
            Open Settings
          </button>
          {setupComplete && (
            <button
              onClick={onProceed}
              className="flex items-center gap-2 px-4 py-2 rounded-md-full text-label-md font-semibold bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-all"
            >
              Continue to Select Files
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Platform selection card */
function PlatformCard({ platform, onClick }) {
  const hasStorage = platform.hasStorage;
  const hasBatches = (platform.totalBatches || 0) > 0;

  return (
    <button
      onClick={onClick}
      className="text-left p-4 rounded-md-lg border border-md-outline-variant/20 hover:border-md-primary/40 hover:bg-md-on-surface/3 transition-all group"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-[24px]" style={{ color: md.primary }}>oil_barrel</span>
        <div className="flex-1 min-w-0">
          <div className="text-body-md font-bold text-md-on-surface truncate">{platform.name}</div>
          <div className="text-label-sm text-md-on-surface-variant font-mono">{platform.code}</div>
        </div>
        <span className="material-symbols-outlined text-[18px] text-md-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity">arrow_forward</span>
      </div>

      <div className="flex gap-3 mb-3">
        <div className="text-center flex-1">
          <div className="text-title-sm font-bold text-md-on-surface">{platform.totalPnids}</div>
          <div className="text-[10px] text-md-on-surface-variant">P&IDs</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-title-sm font-bold" style={{ color: hasBatches ? '#3BE494' : '#919A9B' }}>{platform.completedBatches || 0}</div>
          <div className="text-[10px] text-md-on-surface-variant">Batches</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-title-sm font-bold" style={{ color: platform.annotatedBatches > 0 ? '#3BE494' : '#919A9B' }}>{platform.annotatedBatches || 0}</div>
          <div className="text-[10px] text-md-on-surface-variant">Annotated</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {hasStorage ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/12 text-green-400/80 font-semibold flex items-center gap-1">
            <span className="material-symbols-outlined text-[10px]">cloud_done</span>
            {platform.storageProvider?.toUpperCase()}
            {platform.storageBucket && ` — ${platform.storageBucket}`}
          </span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-400/80 font-semibold flex items-center gap-1">
            <span className="material-symbols-outlined text-[10px]">cloud_off</span>
            No Storage Configured
          </span>
        )}
        {platform.latestBatch && (
          <span className="text-[10px] text-md-on-surface-variant">
            Last: {platform.latestBatch.status}
          </span>
        )}
      </div>
    </button>
  );
}
