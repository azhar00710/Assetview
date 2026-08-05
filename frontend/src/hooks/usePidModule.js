import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const BASE = '/api/v1';

async function fetchJson(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Get all P&IDs for the dedicated module with annotation/OCR columns
export function usePidModulePnids(platformId, filters = {}) {
  const params = new URLSearchParams();
  if (platformId) params.set('platform_id', platformId);
  if (filters.status) params.set('status', filters.status);
  if (filters.annotationStatus) params.set('annotation_status', filters.annotationStatus);
  if (filters.ocrStatus) params.set('ocr_status', filters.ocrStatus);
  if (filters.search) params.set('search', filters.search);

  return useQuery({
    queryKey: ['pid-module-pnids', platformId, filters],
    queryFn: () => fetchJson(`${BASE}/pid-module/pnids?${params}`),
    select: d => d.pnids,
    enabled: !!platformId,
  });
}

// Get module-level stats
export function usePidModuleStats(platformId) {
  return useQuery({
    queryKey: ['pid-module-stats', platformId],
    queryFn: () => fetchJson(`${BASE}/pid-module/stats?platform_id=${platformId}`),
    enabled: !!platformId,
  });
}

// Update annotation status
export function useUpdateAnnotationStatus(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pnidId, annotationStatus }) =>
      fetchJson(`${BASE}/pid-module/pnids/${pnidId}/annotation-status`, {
        method: 'PATCH',
        body: JSON.stringify({ annotationStatus }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pid-module-pnids', platformId] });
      qc.invalidateQueries({ queryKey: ['pid-module-stats', platformId] });
    },
  });
}

// Get full P&ID detail (entity lists, file references, systems, annotation summary)
export function usePnidDetail(pnidId) {
  return useQuery({
    queryKey: ['pid-detail', pnidId],
    queryFn: () => fetchJson(`${BASE}/pid-module/pnids/${pnidId}/detail`),
    enabled: !!pnidId,
  });
}

// Generate annotations for a single P&ID from OCR data
export function useGenerateAnnotations(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pnidId, entityTypes, overwriteExisting, createKonvaAnnotations }) =>
      fetchJson(`${BASE}/pid-module/pnids/${pnidId}/generate-annotations`, {
        method: 'POST',
        body: JSON.stringify({
          mode: 'from_ocr',
          entityTypes: entityTypes || ['equipment', 'instrument', 'line'],
          overwriteExisting: overwriteExisting || false,
          createKonvaAnnotations: createKonvaAnnotations === true,
        }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['pid-module-pnids', platformId] });
      qc.invalidateQueries({ queryKey: ['pid-module-stats', platformId] });
      qc.invalidateQueries({ queryKey: ['pid-detail', variables.pnidId] });
      qc.invalidateQueries({ queryKey: ['annotations'] });
      qc.invalidateQueries({ queryKey: ['overlay'] });
    },
  });
}

// Bulk generate annotations across multiple P&IDs
export function useBulkGenerateAnnotations(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pnidIds, entityTypes, overwriteExisting, createKonvaAnnotations }) =>
      fetchJson(`${BASE}/pid-module/bulk-generate-annotations`, {
        method: 'POST',
        body: JSON.stringify({
          pnidIds,
          mode: 'from_ocr',
          entityTypes: entityTypes || ['equipment', 'instrument', 'line'],
          overwriteExisting: overwriteExisting || false,
          createKonvaAnnotations: createKonvaAnnotations === true,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pid-module-pnids', platformId] });
      qc.invalidateQueries({ queryKey: ['pid-module-stats', platformId] });
      qc.invalidateQueries({ queryKey: ['pid-detail'] });
    },
  });
}

// Get OCR data for a P&ID
export function usePidOcrData(pnidId, type) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  return useQuery({
    queryKey: ['pid-ocr-data', pnidId, type],
    queryFn: () => fetchJson(`${BASE}/pid-module/pnids/${pnidId}/ocr-data?${params}`),
    enabled: !!pnidId,
  });
}
