import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_URL || '/api/v1';

async function fetchJson(url, options) {
  const headers = { ...options?.headers };
  if (options?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

/** All platforms with OCR processing summary */
export function useOcrPlatforms() {
  return useQuery({
    queryKey: ['ocr-pipeline-platforms'],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/platforms`),
    select: d => d.platforms,
  });
}

/** Browse storage files for a platform */
export function useStorageBrowse(platformId, prefix) {
  return useQuery({
    queryKey: ['ocr-storage-browse', platformId, prefix],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/storage/browse${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`),
    enabled: !!platformId,
  });
}

/** Create batch and run OCR */
export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, storageKeys, batchName, ocrProvider }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/batches`, {
        method: 'POST',
        body: JSON.stringify({ storageKeys, batchName, ocrProvider }),
      }),
    onSuccess: (_, { platformId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
      qc.invalidateQueries({ queryKey: ['ocr-batches', platformId] });
      qc.invalidateQueries({ queryKey: ['ocr-storage-browse', platformId] });
    },
  });
}

/** Create batch from existing OCR output files (skip extraction) */
export function useCreateBatchFromExisting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, files, batchName }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/batches/from-existing`, {
        method: 'POST',
        body: JSON.stringify({ files, batchName }),
      }),
    onSuccess: (_, { platformId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
      qc.invalidateQueries({ queryKey: ['ocr-batches', platformId] });
      qc.invalidateQueries({ queryKey: ['ocr-storage-browse', platformId] });
    },
  });
}

/** Get all batches for a platform (processing history) */
export function useOcrBatches(platformId) {
  return useQuery({
    queryKey: ['ocr-batches', platformId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/batches`),
    enabled: !!platformId,
    select: d => d.batches,
    refetchInterval: 5000, // Poll while processing
  });
}

/** Get single batch detail */
export function useOcrBatchDetail(batchId) {
  return useQuery({
    queryKey: ['ocr-batch-detail', batchId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/batches/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (query) => {
      const batch = query.state.data?.batch;
      const ocrActive = batch?.status === 'processing' || batch?.status === 'pending';
      const stage2Active = batch?.stage2Status === 'processing';
      const stage3Active = batch?.stage3Status === 'processing';
      const stage4Active = batch?.stage4Status === 'processing';
      const cleanupActive = batch?.aiCleanupStatus === 'processing';
      return (ocrActive || stage2Active || stage3Active || stage4Active || cleanupActive) ? 3000 : false;
    },
  });
}

/** Export batch results */
export function useExportBatch() {
  return useMutation({
    mutationFn: async ({ batchId, format }) => {
      const res = await fetch(`${API}/ocr-pipeline/batches/${batchId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] || `ocr_results.${format}`;

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      return { filename };
    },
  });
}

/** Pass batch to annotation module */
export function usePassToAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/pass-to-annotation`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
      qc.invalidateQueries({ queryKey: ['ocr-batch-detail'] });
    },
  });
}

/** Get Vision API config status for a platform */
export function useVisionConfig(platformId) {
  return useQuery({
    queryKey: ['vision-config', platformId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/vision-config`),
    enabled: !!platformId,
  });
}

/** Save Vision API credentials for a platform */
export function useSaveVisionConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, visionCredentialsJson }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/vision-config`, {
        method: 'PUT',
        body: JSON.stringify({ visionCredentialsJson }),
      }),
    onSuccess: (_, { platformId }) => {
      qc.invalidateQueries({ queryKey: ['vision-config', platformId] });
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
    },
  });
}

/** Test Vision API connectivity */
export function useTestVisionApi() {
  return useMutation({
    mutationFn: ({ platformId, credentialsJson }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/vision-test`, {
        method: 'POST',
        body: JSON.stringify({ credentialsJson: credentialsJson || undefined }),
      }),
  });
}

// ═══ AI CONFIG (Claude Credentials) ═══════════════════════════════════════

/** Get AI config status for a platform */
export function useAiConfig(platformId) {
  return useQuery({
    queryKey: ['ai-config', platformId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/ai-config`),
    enabled: !!platformId,
  });
}

/** Get resolved Stage 2 prompt preview (dictionary + learned patterns included) */
export function usePromptPreview(platformId, params = {}) {
  const qs = new URLSearchParams();
  if (params.drawingNumber) qs.set('drawingNumber', params.drawingNumber);
  if (params.platformCode) qs.set('platformCode', params.platformCode);
  if (params.platformName) qs.set('platformName', params.platformName);
  const query = qs.toString();

  return useQuery({
    queryKey: ['prompt-preview', platformId, query],
    queryFn: () =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/prompt-preview${query ? `?${query}` : ''}`),
    enabled: !!platformId,
  });
}

/** Get learning history to track prompt-evolution inputs over time */
export function useLearningHistory(platformId, days = 30) {
  return useQuery({
    queryKey: ['learning-history', platformId, days],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/learning-history?days=${days}`),
    enabled: !!platformId,
  });
}

/** Save AI credentials for a platform */
export function useSaveAiConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, apiKey, model }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/ai-config`, {
        method: 'PUT',
        body: JSON.stringify({ apiKey, model }),
      }),
    onSuccess: (_, { platformId }) => {
      qc.invalidateQueries({ queryKey: ['ai-config', platformId] });
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
    },
  });
}

/** Test AI (Claude) connectivity */
export function useTestAiConnection() {
  return useMutation({
    mutationFn: ({ platformId, apiKey }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/ai-test`, {
        method: 'POST',
        body: JSON.stringify({ apiKey: apiKey || undefined }),
      }),
  });
}

// ═══ VISUAL DETECTOR CONFIG (T-Rex2 / GroundingDINO) ═══════════════════════

export function useVisualConfig(platformId) {
  return useQuery({
    queryKey: ['visual-config', platformId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/visual-config`),
    enabled: !!platformId,
  });
}

export function useSaveVisualConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, provider, endpointUrl, token, model }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/visual-config`, {
        method: 'PUT',
        body: JSON.stringify({ provider, endpointUrl, token, model }),
      }),
    onSuccess: (_, { platformId }) => {
      qc.invalidateQueries({ queryKey: ['visual-config', platformId] });
      qc.invalidateQueries({ queryKey: ['ai-annotate-models', platformId] });
    },
  });
}

export function useTestVisualConnection() {
  return useMutation({
    mutationFn: ({ platformId, provider, endpointUrl, token, model }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/visual-test`, {
        method: 'POST',
        body: JSON.stringify({ provider, endpointUrl, token, model }),
      }),
  });
}

// ═══ GROUNDING DINO SECONDARY CONFIG (Line Detection) ═════════════════════════

export function useGroundingConfig(platformId) {
  return useQuery({
    queryKey: ['grounding-config', platformId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/grounding-config`),
    enabled: !!platformId,
  });
}

export function useSaveGroundingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, endpointUrl, token, model }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/grounding-config`, {
        method: 'PUT',
        body: JSON.stringify({ endpointUrl, token, model }),
      }),
    onSuccess: (_, { platformId }) => {
      qc.invalidateQueries({ queryKey: ['grounding-config', platformId] });
      qc.invalidateQueries({ queryKey: ['ai-annotate-models', platformId] });
    },
  });
}

// ═══ OCR PROVIDER PREFERENCE ═══════════════════════════════════════════════════

/** Get OCR provider preference for a platform */
export function useOcrProvider(platformId) {
  return useQuery({
    queryKey: ['ocr-provider', platformId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/ocr-provider`),
    enabled: !!platformId,
  });
}

/** Save OCR provider preference */
export function useSaveOcrProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, provider }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/ocr-provider`, {
        method: 'PUT',
        body: JSON.stringify({ provider }),
      }),
    onSuccess: (_, { platformId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-provider', platformId] });
    },
  });
}

// ═══ CANCEL BATCH ═════════════════════════════════════════════════════════════

/** Cancel a running batch — marks pending files as cancelled */
export function useCancelBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
    },
  });
}

// ═══ DELETE BATCH ═════════════════════════════════════════════════════════════

/** Delete a single batch (must be stopped/completed/failed first) */
export function useDeleteBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
    },
  });
}

// ═══ CLEAR FAILED BATCHES ════════════════════════════════════════════════════

/** Clear all failed/stale batches for a platform */
export function useClearFailedBatches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/clear-failed`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
    },
  });
}

// ═══ RE-RUN OCR ═══════════════════════════════════════════════════════════════

/** Re-run OCR on a batch (all files or selected files, with optional provider override) */
export function useRerunOcr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, ocrProvider, fileIds }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/rerun-ocr`, {
        method: 'POST',
        body: JSON.stringify({ ocrProvider, fileIds }),
      }),
    onSuccess: (_, { platformId }) => {
      if (platformId) {
        qc.invalidateQueries({ queryKey: ['ocr-batches', platformId] });
      }
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
    },
  });
}

/** Reset Stage 2 outputs while keeping Stage 1 raw OCR */
export function useResetStage2() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/reset-stage2`, {
        method: 'POST',
      }),
    onSuccess: (_, { batchId, platformId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-batch-detail', batchId] });
      qc.invalidateQueries({ queryKey: ['batch-stages', batchId] });
      if (platformId) qc.invalidateQueries({ queryKey: ['ocr-batches', platformId] });
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
      qc.invalidateQueries({ queryKey: ['stage-file', batchId] });
      qc.invalidateQueries({ queryKey: ['candidate-ledger', batchId] });
    },
  });
}

// ═══ AI CLEANUP ═══════════════════════════════════════════════════════════════

/** Get reconciliation report for a batch */
export function useReconciliationReport(batchId) {
  return useQuery({
    queryKey: ['ocr-reconciliation', batchId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/batches/${batchId}/reconciliation`),
    enabled: !!batchId,
  });
}

/** Retry AI cleanup for a batch */
export function useRetryCleanup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/retry-cleanup`, {
        method: 'POST',
      }),
    onSuccess: (_, { batchId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-batch-detail', batchId] });
      qc.invalidateQueries({ queryKey: ['ocr-reconciliation', batchId] });
    },
  });
}

// ═══ OCR FILE DETECTION & IMPORT ═══════════════════════════════════════════

/** Detect existing OCR output files in storage (manual trigger) */
export function useDetectOcrFiles(platformId) {
  return useQuery({
    queryKey: ['ocr-detect-files', platformId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/detect-ocr-files`),
    enabled: false, // Manual trigger only — call refetch()
  });
}

/** Import detected OCR files back into the DB */
export function useImportOcrFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, files }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/import-ocr-files`, {
        method: 'POST',
        body: JSON.stringify({ files }),
      }),
    onSuccess: (_, { platformId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-detect-files', platformId] });
      qc.invalidateQueries({ queryKey: ['ocr-pipeline-platforms'] });
      qc.invalidateQueries({ queryKey: ['ocr-storage-browse', platformId] });
      qc.invalidateQueries({ queryKey: ['pid-module-pnids'] });
      qc.invalidateQueries({ queryKey: ['pid-module-stats'] });
    },
  });
}

/** Add more files to existing batch */
export function useAddFilesToBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, storageKeys }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/add-files`, {
        method: 'POST',
        body: JSON.stringify({ storageKeys }),
      }),
    onSuccess: (_, { batchId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-batch-detail', batchId] });
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
    },
  });
}

/** Reset OCR status for all batch files of a platform (allows re-processing) */
export function useResetOcrStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId }) =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/reset-ocr-status`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-storage-browse'] });
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
    },
  });
}

/** Fetch available storage configs for a platform (for batch selection dropdown) */
export function useAvailableStorageConfigs(platformId) {
  return useQuery({
    queryKey: ['available-storage-configs', platformId],
    queryFn: async () => {
      const res = await fetchJson(
        `${API}/ocr-pipeline/platforms/${platformId}/storage-configs`,
        { method: 'GET' }
      );
      return res;
    },
    enabled: !!platformId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/** Get stage summary for a batch (extraction/grouping/cleanup/import status + file stage outputs) */
export function useBatchStages(batchId) {
  return useQuery({
    queryKey: ['batch-stages', batchId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/batches/${batchId}/stages`),
    enabled: !!batchId,
    refetchInterval: (query) => {
      const stages = query.state.data?.stages;
      const anyProcessing = stages && Object.values(stages).some(s => s.status === 'processing');
      return anyProcessing ? 3000 : false;
    },
  });
}

/** Get stage file content (raw/grouped/cleaned JSON) */
export function useStageFile(batchId, fileId, stage) {
  return useQuery({
    queryKey: ['stage-file', batchId, fileId, stage],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/stage/${stage}`),
    enabled: !!batchId && !!fileId && !!stage,
    staleTime: 30 * 60 * 1000, // 30 min — stage outputs are immutable
  });
}

/** Get persisted candidate ledger rows for a classified file */
export function useCandidateLedger(batchId, fileId, params = {}, enabled = true) {
  const {
    outcome,
    reason,
    limit = 50,
    offset = 0,
  } = params;
  const qs = new URLSearchParams();
  if (outcome) qs.set('outcome', outcome);
  if (reason) qs.set('reason', reason);
  qs.set('limit', String(limit));
  qs.set('offset', String(offset));
  const query = qs.toString();

  return useQuery({
    queryKey: ['candidate-ledger', batchId, fileId, outcome || '', reason || '', limit, offset],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/candidate-ledger?${query}`),
    enabled: !!batchId && !!fileId && enabled,
    staleTime: 30 * 1000,
  });
}

/** Run Stage 2 (word grouping) for a batch */
export function useRunStage2() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, phaseProfile = 'phase3_full_rescue' }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/run-stage2`, {
        method: 'POST',
        body: JSON.stringify({ phaseProfile }),
      }),
    onSuccess: (_, { batchId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-batch-detail', batchId] });
      qc.invalidateQueries({ queryKey: ['batch-stages', batchId] });
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
    },
  });
}

/** Run deterministic Stage 2 grouping only (no AI classify) */
export function useRunStage2GroupingOnly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/run-stage2-grouping-only`, { method: 'POST' }),
    onSuccess: (_, { batchId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-batch-detail', batchId] });
      qc.invalidateQueries({ queryKey: ['batch-stages', batchId] });
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
    },
  });
}

/** Poll Stage 2 live progress (per-file, per-chunk updates) */
export function useStage2Progress(batchId, enabled) {
  return useQuery({
    queryKey: ['stage2-progress', batchId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/batches/${batchId}/stage2-progress`),
    enabled: !!batchId && enabled,
    refetchInterval: 1500, // Poll every 1.5 seconds during processing
  });
}

/** Run Stage 2 AI Classify across multiple batches with optional file selection */
export function useRunStage2Multi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ selections, phaseProfile = 'phase3_full_rescue' }) =>
      fetchJson(`${API}/ocr-pipeline/run-stage2-multi`, {
        method: 'POST',
        body: JSON.stringify({ selections, phaseProfile }),
      }),
    onSuccess: (_, { selections }) => {
      for (const sel of selections) {
        qc.invalidateQueries({ queryKey: ['ocr-batch-detail', sel.batchId] });
        qc.invalidateQueries({ queryKey: ['batch-stages', sel.batchId] });
      }
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
    },
  });
}

/** Get download URL for a stage file */
export function getStageFileDownloadUrl(batchId, fileId, stage) {
  return `${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/stage/${stage}/download`;
}

// ═══ WORD GROUPING DIAGNOSTIC (read-only, no AI, no DB writes) ═════════════
/**
 * Runs the word grouping diagnostic for a single file. Re-runs grouping on raw
 * OCR with all passes enabled (vertical + rotation) so we can SEE every
 * candidate group, color-coded by source, plus the atoms that never grouped.
 *
 * @param {object} params  Optional knobs:
 *   - arbitration: 'none' | 'priority_lock' | 'nms_best' | 'cluster'
 *   - stoppers:    string[] subset of ['median_gap','symbol_region','number_break']
 */
export function useGroupingDiagnostic(batchId, fileId, params = {}, enabled = true) {
  const arbitration = params.arbitration || 'none';
  const stoppers = Array.isArray(params.stoppers) ? params.stoppers.slice().sort().join(',') : '';
  const verticalRelaxed = !!params.verticalRelaxed;
  // bipartite defaults to true unless explicitly disabled
  const bipartite = params.bipartite !== false;
  // relaxed mids are excluded from bipartite by default unless explicitly enabled
  const bipartiteIncludeRelaxed = !!params.bipartiteIncludeRelaxed;
  const qs = new URLSearchParams();
  if (arbitration !== 'none') qs.set('arbitration', arbitration);
  if (stoppers) qs.set('stoppers', stoppers);
  if (verticalRelaxed) qs.set('vertical_relaxed', '1');
  if (!bipartite) qs.set('bipartite', '0');
  if (bipartiteIncludeRelaxed) qs.set('bipartite_relaxed', '1');
  const query = qs.toString();
  return useQuery({
    queryKey: ['grouping-diagnostic', batchId, fileId, arbitration, stoppers, verticalRelaxed, bipartite, bipartiteIncludeRelaxed],
    queryFn: () =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/grouping-diagnostic${query ? `?${query}` : ''}`),
    enabled: !!batchId && !!fileId && enabled,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** Direct download URL for the diagnostic CSV (one row per group). */
export function getGroupingDiagnosticCsvUrl(batchId, fileId, params = {}) {
  const qs = new URLSearchParams({ csv: '1' });
  if (params.arbitration && params.arbitration !== 'none') qs.set('arbitration', params.arbitration);
  if (Array.isArray(params.stoppers) && params.stoppers.length) qs.set('stoppers', params.stoppers.join(','));
  if (params.verticalRelaxed) qs.set('vertical_relaxed', '1');
  if (params.bipartite === false) qs.set('bipartite', '0');
  if (params.bipartiteIncludeRelaxed) qs.set('bipartite_relaxed', '1');
  return `${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/grouping-diagnostic?${qs.toString()}`;
}

/** Direct download URL for the diagnostic JSON. */
export function getGroupingDiagnosticJsonUrl(batchId, fileId, params = {}) {
  const qs = new URLSearchParams();
  if (params.arbitration && params.arbitration !== 'none') qs.set('arbitration', params.arbitration);
  if (Array.isArray(params.stoppers) && params.stoppers.length) qs.set('stoppers', params.stoppers.join(','));
  if (params.verticalRelaxed) qs.set('vertical_relaxed', '1');
  if (params.bipartite === false) qs.set('bipartite', '0');
  if (params.bipartiteIncludeRelaxed) qs.set('bipartite_relaxed', '1');
  const query = qs.toString();
  return `${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/grouping-diagnostic${query ? `?${query}` : ''}`;
}

/**
 * Atom-label feedback hooks (per-drawing user labels for the grouping
 * diagnostic).  Roles: prefix | mid | suffix | line_tag | equipment_tag | noise.
 *
 * Mutations invalidate the matching `grouping-diagnostic` query so the canvas
 * re-paints with the label-aware groups immediately.
 */
export function useUpsertAtomLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, fileId, atomIdx, role, text, decidedBy }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/labels/${atomIdx}`, {
        method: 'PUT',
        body: JSON.stringify({ role, text, decidedBy }),
      }),
    onSuccess: (_, { batchId, fileId }) => {
      qc.invalidateQueries({ queryKey: ['grouping-diagnostic', batchId, fileId] });
    },
  });
}

export function useDeleteAtomLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, fileId, atomIdx }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/labels/${atomIdx}`, {
        method: 'DELETE',
      }),
    onSuccess: (_, { batchId, fileId }) => {
      qc.invalidateQueries({ queryKey: ['grouping-diagnostic', batchId, fileId] });
    },
  });
}

export function useClearAllAtomLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, fileId }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/labels`, {
        method: 'DELETE',
      }),
    onSuccess: (_, { batchId, fileId }) => {
      qc.invalidateQueries({ queryKey: ['grouping-diagnostic', batchId, fileId] });
    },
  });
}

/**
 * Re-OCR selected OCR-miss regions (Vision API), merge rescued atoms in memory,
 * and return a fresh grouping diagnostic from the merged raw OCR.
 */
export function useRunGroupingDiagnosticRepass() {
  return useMutation({
    mutationFn: ({
      batchId,
      fileId,
      regions = [],
      arbitration = 'none',
      stoppers = [],
      verticalRelaxed = false,
      bipartite = true,
      bipartiteIncludeRelaxed = false,
      scale = 4,
      rasterDensity,
    }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/grouping-diagnostic/repass`, {
        method: 'POST',
        body: JSON.stringify({
          regions,
          arbitration,
          stoppers,
          verticalRelaxed,
          bipartite,
          bipartiteIncludeRelaxed,
          scale,
          rasterDensity,
        }),
      }),
  });
}

/** Save review decisions for a file */
export function useSaveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, fileId, decisions }) =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/files/${fileId}/save-review`, {
        method: 'POST',
        body: JSON.stringify({ decisions }),
      }),
    onSuccess: (_, { batchId, fileId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-batch-detail', batchId] });
      qc.invalidateQueries({ queryKey: ['batch-stages', batchId] });
      qc.invalidateQueries({ queryKey: ['review-summary', batchId] });
      qc.invalidateQueries({ queryKey: ['stage-file', batchId, fileId, 'review'] });
    },
  });
}

/** Get review summary for a batch */
export function useReviewSummary(batchId) {
  return useQuery({
    queryKey: ['review-summary', batchId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/batches/${batchId}/review-summary`),
    enabled: !!batchId,
  });
}

/** Stage 1 — read-only: OCR line tags vs registered lines (no DB writes) */
export function useLineRegisterPreview(batchId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['ocr-line-register-preview', batchId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/batches/${batchId}/line-register/preview`),
    enabled: !!batchId && enabled,
  });
}

/** Equipment register preview — OCR equipment tags vs DB equipment register */
export function useEquipmentRegisterPreview(batchId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['ocr-equipment-register-preview', batchId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/batches/${batchId}/equipment-register/preview`),
    enabled: !!batchId && enabled,
  });
}

/** Instrument register preview — OCR instrument tags vs DB instrument register */
export function useInstrumentRegisterPreview(batchId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['ocr-instrument-register-preview', batchId],
    queryFn: () => fetchJson(`${API}/ocr-pipeline/batches/${batchId}/instrument-register/preview`),
    enabled: !!batchId && enabled,
  });
}

/** Persist approved/edited review tags to ocr_extraction with OCR bbox (position_pct). */
export function useSyncReviewToExtractions(batchId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson(`${API}/ocr-pipeline/batches/${batchId}/sync-review-to-extractions`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-line-register-preview', batchId] });
    },
  });
}

/** Register staging inbox (platform): list queued items */
export function useRegisterStagingItems(platformId, { status, batchId, entityKind, enabled = true } = {}) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (batchId) q.set('batchId', batchId);
  if (entityKind) q.set('entityKind', entityKind);
  const qs = q.toString();
  return useQuery({
    queryKey: ['register-staging-items', platformId, status ?? '', batchId ?? '', entityKind ?? ''],
    queryFn: () =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/register-staging/items${qs ? `?${qs}` : ''}`),
    enabled: !!platformId && enabled,
  });
}

/** Queue approved review tags from selected batches into register staging */
export function usePushRegisterStaging(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: body =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/register-staging/from-batches`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['register-staging-items', platformId] });
    },
  });
}

export function useApplyRegisterStaging(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: body =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/register-staging/apply`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['register-staging-items', platformId] });
    },
  });
}

export function useCancelRegisterStaging(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: body =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/register-staging/cancel`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['register-staging-items', platformId] });
    },
  });
}

/**
 * Fetch full traceability chain for a staging item.
 */
export function useStagingTraceability(platformId, itemId) {
  return useQuery({
    queryKey: ['staging-traceability', platformId, itemId],
    queryFn: () =>
      fetchJson(`${API}/ocr-pipeline/platforms/${platformId}/register-staging/traceability/${itemId}`),
    enabled: !!platformId && !!itemId,
    staleTime: 30_000,
  });
}
