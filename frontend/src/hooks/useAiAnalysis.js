import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_URL || '/api/v1';

async function fetchJson(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

/** Trigger AI analysis on a batch */
export function useRunAiAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, analysisType }) => {
      if (!batchId) return Promise.reject(new Error('No batch selected for analysis'));
      return fetchJson(`${API}/ai-analysis/batches/${batchId}/analyze`, {
        method: 'POST',
        body: JSON.stringify({ analysisType }),
      });
    },
    onSuccess: (_, { batchId }) => {
      qc.invalidateQueries({ queryKey: ['ocr-batches'] });
      qc.invalidateQueries({ queryKey: ['ocr-batch-detail'] });
      qc.invalidateQueries({ queryKey: ['ai-analysis-job'] });
    },
  });
}

/** Get AI analysis job status */
export function useAiAnalysisJob(jobId) {
  return useQuery({
    queryKey: ['ai-analysis-job', jobId],
    queryFn: () => fetchJson(`${API}/ai-analysis/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return (status === 'processing' || status === 'pending') ? 3000 : false;
    },
  });
}

/** Get AI-generated entities */
export function useAiAnalysisEntities(jobId, filters = {}) {
  const params = new URLSearchParams();
  if (filters.entityType) params.set('entity_type', filters.entityType);
  if (filters.status) params.set('status', filters.status);
  if (filters.minConfidence) params.set('min_confidence', filters.minConfidence);
  const qs = params.toString();

  return useQuery({
    queryKey: ['ai-analysis-entities', jobId, filters],
    queryFn: () => fetchJson(`${API}/ai-analysis/jobs/${jobId}/entities${qs ? `?${qs}` : ''}`),
    enabled: !!jobId,
  });
}

/** Get AI relationships */
export function useAiAnalysisRelationships(jobId) {
  return useQuery({
    queryKey: ['ai-analysis-relationships', jobId],
    queryFn: () => fetchJson(`${API}/ai-analysis/jobs/${jobId}/relationships`),
    enabled: !!jobId,
  });
}

/** Get AI summary */
export function useAiAnalysisSummary(jobId) {
  return useQuery({
    queryKey: ['ai-analysis-summary', jobId],
    queryFn: () => fetchJson(`${API}/ai-analysis/jobs/${jobId}/summary`),
    enabled: !!jobId,
  });
}

/** Approve single entity */
export function useApproveAiEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityId }) =>
      fetchJson(`${API}/ai-analysis/entities/${entityId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-analysis-entities'] });
      qc.invalidateQueries({ queryKey: ['ai-analysis-job'] });
    },
  });
}

/** Bulk approve entities */
export function useBulkApproveAiEntities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      fetchJson(`${API}/ai-analysis/entities/bulk-approve`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-analysis-entities'] });
      qc.invalidateQueries({ queryKey: ['ai-analysis-job'] });
    },
  });
}

/** Reject entity */
export function useRejectAiEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityId }) =>
      fetchJson(`${API}/ai-analysis/entities/${entityId}/reject`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-analysis-entities'] });
      qc.invalidateQueries({ queryKey: ['ai-analysis-job'] });
    },
  });
}

/** Edit entity */
export function useEditAiEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityId, suggestedData, suggestedTag }) =>
      fetchJson(`${API}/ai-analysis/entities/${entityId}/edit`, {
        method: 'POST',
        body: JSON.stringify({ suggestedData, suggestedTag }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-analysis-entities'] });
    },
  });
}

/** Import cleaned data */
export function useImportCleanedData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, records, csvText }) =>
      fetchJson(`${API}/ai-analysis/batches/${batchId}/import-cleaned`, {
        method: 'POST',
        body: JSON.stringify({ records, csvText }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-analysis'] });
    },
  });
}

/** Export for cleaning */
export function useExportForCleaning() {
  return useMutation({
    mutationFn: async ({ batchId, format = 'json' }) => {
      const res = await fetch(`${API}/ai-analysis/batches/${batchId}/export-for-cleaning?format=${format}`);
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);

      if (format === 'csv') {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ocr_cleaning_${batchId.slice(0, 8)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return { downloaded: true };
      }

      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ocr_cleaning_${batchId.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { downloaded: true };
    },
  });
}

/** Auto-annotate a single P&ID */
export function useAutoAnnotate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pnidId }) =>
      fetchJson(`${API}/ai-analysis/pnids/${pnidId}/auto-annotate`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations'] });
    },
  });
}

/** Batch auto-annotate */
export function useBatchAutoAnnotate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId }) => {
      const res = await fetch(`${API}/ai-analysis/batches/${batchId}/auto-annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const text = await res.text().catch(() => '');
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        const err = new Error(body.error || `${res.status}: ${text || res.statusText}`);
        err.status = res.status;
        err.nextStep = body.nextStep;
        throw err;
      }
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations'] });
    },
  });
}

/** Browse tags in a batch */
export function useBrowseTags(batchId, entityType) {
  const params = entityType ? `?entity_type=${entityType}` : '';
  return useQuery({
    queryKey: ['ai-analysis-browse', batchId, entityType],
    queryFn: () => fetchJson(`${API}/ai-analysis/batches/${batchId}/browse${params}`),
    enabled: !!batchId,
  });
}

/** Check data readiness for a batch (extraction counts per file) */
export function useBatchDataCheck(batchId) {
  return useQuery({
    queryKey: ['ai-analysis-data-check', batchId],
    queryFn: () => fetchJson(`${API}/ai-analysis/batches/${batchId}/data-check`),
    enabled: !!batchId,
  });
}

/** Re-run OCR for batch files that need it */
export function useReprocessFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, fileIds }) =>
      fetchJson(`${API}/ai-analysis/batches/${batchId}/reprocess`, {
        method: 'POST',
        body: JSON.stringify({ fileIds }),
      }),
    onSuccess: (_, { batchId }) => {
      qc.invalidateQueries({ queryKey: ['ai-analysis-data-check', batchId] });
      qc.invalidateQueries({ queryKey: ['ocr-batch-detail'] });
    },
  });
}
