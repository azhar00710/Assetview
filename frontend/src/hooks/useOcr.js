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

/** Trigger OCR extraction for a P&ID */
export function useOcrExtract(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson(`${API}/ocr/extract/${pnidId}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-results', pnidId] });
      qc.invalidateQueries({ queryKey: ['ocr-jobs', pnidId] });
    },
  });
}

/** Get OCR results for a P&ID */
export function useOcrResults(pnidId) {
  return useQuery({
    queryKey: ['ocr-results', pnidId],
    queryFn: () => fetchJson(`${API}/ocr/results/${pnidId}`),
    enabled: !!pnidId,
  });
}

/** Get OCR job status */
export function useOcrJob(jobId) {
  return useQuery({
    queryKey: ['ocr-job', jobId],
    queryFn: () => fetchJson(`${API}/ocr/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (data) => {
      const status = data?.job?.status;
      return status === 'processing' || status === 'pending' ? 2000 : false;
    },
  });
}

/** Get all OCR jobs for a P&ID */
export function useOcrJobs(pnidId) {
  return useQuery({
    queryKey: ['ocr-jobs', pnidId],
    queryFn: () => fetchJson(`${API}/ocr/jobs/pnid/${pnidId}`),
    enabled: !!pnidId,
  });
}

/** Approve or reject OCR extractions */
export function useOcrApprove(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ extractionIds, action }) =>
      fetchJson(`${API}/ocr/results/${pnidId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ extractionIds, action }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-results', pnidId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
    },
  });
}

/** Bulk approve above threshold */
export function useOcrApproveAll(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ minConfidence = 0.9 } = {}) =>
      fetchJson(`${API}/ocr/results/${pnidId}/approve-all`, {
        method: 'POST',
        body: JSON.stringify({ minConfidence }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-results', pnidId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
    },
  });
}

/** Modify a single extraction (reassign, reclassify) */
export function useOcrUpdateExtraction(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ extractionId, ...body }) =>
      fetchJson(`${API}/ocr/extractions/${extractionId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-results', pnidId] });
    },
  });
}
