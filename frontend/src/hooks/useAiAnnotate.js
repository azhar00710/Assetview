import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_URL || '/api/v1';

async function fetchJson(url, options = {}) {
  const headers = { ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export function useAiModels(platformId, enabled = true) {
  const querySuffix = platformId ? `?platformId=${encodeURIComponent(platformId)}` : '';
  return useQuery({
    queryKey: ['ai-annotate-models', platformId || 'none'],
    queryFn: () => fetchJson(`${API}/ai/models${querySuffix}`),
    enabled,
    retry: false,
  });
}

export function useAiAnnotate(pnidId) {
  return useMutation({
    mutationFn: ({ examples, mode = 'few_shot' }) =>
      fetchJson(`${API}/ai/annotate`, {
        method: 'POST',
        body: JSON.stringify({ pnidId, examples, mode }),
      }),
  });
}

export function useAiAnnotateAccept(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, detections, accepted }) =>
      fetchJson(`${API}/ai/annotate/accept`, {
        method: 'POST',
        body: JSON.stringify({ pnidId, runId, detections, accepted }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Batch detection across multiple P&IDs
// ---------------------------------------------------------------------------

export function useAiBatchAnnotate() {
  return useMutation({
    mutationFn: ({ platformId, sourcePnidId, examples, category, targetPnidIds, threshold }) =>
      fetchJson(`${API}/ai/annotate/batch`, {
        method: 'POST',
        body: JSON.stringify({ platformId, sourcePnidId, examples, category, targetPnidIds, threshold }),
      }),
  });
}

export function useAiBatchProgress(batchId) {
  return useQuery({
    queryKey: ['ai-batch-progress', batchId],
    queryFn: () => fetchJson(`${API}/ai/annotate/batch/${batchId}/progress`),
    enabled: !!batchId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return 2000;
    },
  });
}

export function useAiBatchResults(batchId, pnidId) {
  return useQuery({
    queryKey: ['ai-batch-results', batchId, pnidId],
    queryFn: () => fetchJson(`${API}/ai/annotate/batch/${batchId}/results/${pnidId}`),
    enabled: !!batchId && !!pnidId,
  });
}

export function useAiBatchAccept(batchId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ decisions }) =>
      fetchJson(`${API}/ai/annotate/batch/${batchId}/accept`, {
        method: 'POST',
        body: JSON.stringify({ decisions }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations'] });
      qc.invalidateQueries({ queryKey: ['overlay'] });
    },
  });
}

export function useAiBatchAcceptAll(batchId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threshold }) =>
      fetchJson(`${API}/ai/annotate/batch/${batchId}/accept-all`, {
        method: 'POST',
        body: JSON.stringify({ threshold }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations'] });
      qc.invalidateQueries({ queryKey: ['overlay'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Detection Profiles
// ---------------------------------------------------------------------------

export function useAiProfiles(platformId) {
  return useQuery({
    queryKey: ['ai-profiles', platformId],
    queryFn: () => fetchJson(`${API}/ai/annotate/profiles?platformId=${encodeURIComponent(platformId)}`),
    enabled: !!platformId,
  });
}

export function useAiProfileSave(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, category, examples, embeddings }) =>
      fetchJson(`${API}/ai/annotate/profiles`, {
        method: 'POST',
        body: JSON.stringify({ platformId, name, category, examples, embeddings }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-profiles', platformId] });
    },
  });
}

export function useAiProfileLoad(platformId, name) {
  return useQuery({
    queryKey: ['ai-profile', platformId, name],
    queryFn: () => fetchJson(`${API}/ai/annotate/profiles/${encodeURIComponent(name)}?platformId=${encodeURIComponent(platformId)}`),
    enabled: !!platformId && !!name,
  });
}

