import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_URL || '/api/v1';

async function fetchJson(url, options = {}) {
  const headers = { ...options.headers };
  // Only set Content-Type for requests that send a body
  if (options.body) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  // DELETE may return empty body
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { success: true }; }
}

// Fetch all annotations for a P&ID
export function useAnnotations(pnidId) {
  return useQuery({
    queryKey: ['annotations', pnidId],
    queryFn: () => fetchJson(`${API}/pnids/${pnidId}/annotations`),
    enabled: !!pnidId,
    select: (data) => data.annotations,
  });
}

// Fetch overlay data (equipment, instrument, line positions)
export function useOverlay(pnidId) {
  return useQuery({
    queryKey: ['overlay', pnidId],
    queryFn: () => fetchJson(`${API}/pnids/${pnidId}/overlay`),
    enabled: !!pnidId,
  });
}

// Fetch linkable entities for a P&ID
export function useLinkableEntities(pnidId) {
  return useQuery({
    queryKey: ['linkable-entities', pnidId],
    queryFn: () => fetchJson(`${API}/pnids/${pnidId}/linkable-entities`),
    enabled: !!pnidId,
  });
}

// Create annotation
export function useCreateAnnotation(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      fetchJson(`${API}/pnids/${pnidId}/annotations`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['annotations', pnidId] }),
  });
}

// Update annotation
export function useUpdateAnnotation(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ annotationId, ...body }) =>
      fetchJson(`${API}/annotations/${annotationId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['annotations', pnidId] }),
  });
}

// Bulk update annotations
export function useBulkUpdateAnnotations(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ annotationIds, updates }) =>
      fetchJson(`${API}/annotations/bulk-update`, {
        method: 'PATCH',
        body: JSON.stringify({ annotationIds, updates }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
    },
  });
}

// Delete annotation (optionally delete linked entity too)
// Supports: mutate(annotationId) or mutate({ annotationId, deleteEntity: true })
export function useDeleteAnnotation(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (arg) => {
      const id = typeof arg === 'string' ? arg : arg.annotationId;
      const deleteEntity = typeof arg === 'object' && arg.deleteEntity;
      const params = deleteEntity ? '?deleteEntity=true' : '';
      return fetchJson(`${API}/annotations/${id}${params}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
      qc.invalidateQueries({ queryKey: ['linkable-entities', pnidId] });
    },
  });
}

// Bulk delete annotations (optionally delete linked entities)
export function useBulkDeleteAnnotations(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ annotationIds, deleteEntities = false }) =>
      fetchJson(`${API}/annotations/bulk-delete`, {
        method: 'POST',
        body: JSON.stringify({ annotationIds, deleteEntities }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
      qc.invalidateQueries({ queryKey: ['linkable-entities', pnidId] });
    },
  });
}

// Bulk revert approved annotations to draft
export function useBulkRevertAnnotations(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ annotationIds }) =>
      fetchJson(`${API}/annotations/bulk-revert`, {
        method: 'POST',
        body: JSON.stringify({ annotationIds }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['annotations', pnidId] }),
  });
}

// Fetch orphaned entities (tags with no active annotations)
export function useOrphanedEntities(platformId) {
  return useQuery({
    queryKey: ['orphaned-entities', platformId],
    queryFn: () => fetchJson(`${API}/annotations/orphaned-entities${platformId ? `?platformId=${platformId}` : ''}`),
    enabled: true,
  });
}

// Delete orphaned entities
export function useCleanupEntities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityIds, entityType }) =>
      fetchJson(`${API}/annotations/cleanup-entities`, {
        method: 'POST',
        body: JSON.stringify({ entityIds, entityType }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orphaned-entities'] });
      qc.invalidateQueries({ queryKey: ['linkable-entities'] });
    },
  });
}

// Add reply
export function useAddReply(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ annotationId, text }) =>
      fetchJson(`${API}/annotations/${annotationId}/replies`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['annotations', pnidId] }),
  });
}

// Approve or revert annotation to draft
export function useApproveAnnotation(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ annotationId, approve }) =>
      fetchJson(`${API}/annotations/${annotationId}/approve`, {
        method: 'PATCH',
        body: JSON.stringify({ approve }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['annotations', pnidId] }),
  });
}

// Place entity on P&ID (create entity if new + junction + annotation)
export function usePlaceEntity(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      fetchJson(`${API}/pnids/${pnidId}/place-entity`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
      qc.invalidateQueries({ queryKey: ['linkable-entities', pnidId] });
    },
  });
}

// Bulk-link placed entities (create annotations for junction-only entities)
export function useBulkLinkPlaced(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson(`${API}/pnids/${pnidId}/bulk-link-placed`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
    },
  });
}

// Bulk-approve all draft annotations
export function useBulkApprove(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body = {}) =>
      fetchJson(`${API}/pnids/${pnidId}/bulk-approve`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
    },
  });
}

// Get P&ID file URL (proxied through backend to avoid CORS)
export function usePnidImage(pnidId) {
  // Return proxy URL directly — no fetch needed, the backend streams the file
  const url = pnidId ? `${API}/pnids/${pnidId}/file` : null;
  return { data: url };
}

// Fetch systems for a P&ID
export function usePnidSystems(pnidId) {
  return useQuery({
    queryKey: ['pnid-systems', pnidId],
    queryFn: () => fetchJson(`${API}/pnids/${pnidId}/systems`),
    enabled: !!pnidId,
    select: (data) => data.systems,
  });
}

// Fetch P&IDs list
export function usePnids(platformId) {
  return useQuery({
    queryKey: ['pnids', platformId],
    queryFn: () => fetchJson(`${API}/pnids${platformId ? `?platform_id=${platformId}` : ''}`),
    select: (data) => data.pnids,
  });
}
