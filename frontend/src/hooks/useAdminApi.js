import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '../lib/authApi';

const BASE = '/api/v1';

async function fetchJson(url) {
  const res = await authFetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function mutateJson(url, method, body) {
  const headers = {};
  const hasBody = body != null;
  if (hasBody) headers['Content-Type'] = 'application/json';
  const res = await authFetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.error || text;
    } catch { /* keep raw */ }
    throw new Error(message || `API error ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function mutateCSV(url, method, body) {
  const res = await authFetch(url, {
    method,
    headers: { 'Content-Type': 'text/csv' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function uploadFormData(url, method, formData) {
  const res = await authFetch(url, {
    method,
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Hierarchy ───────────────────────────────────────────────────────────────

export function useHierarchy() {
  return useQuery({
    queryKey: ['admin-hierarchy'],
    queryFn: () => fetchJson(`${BASE}/admin/hierarchy`),
  });
}

function makeHierarchyMutation(level) {
  return function useLevelMutation() {
    const qc = useQueryClient();
    const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-hierarchy'] });

    const createMut = useMutation({
      mutationFn: (data) => mutateJson(`${BASE}/admin/${level}`, 'POST', data),
      onSuccess: invalidate,
    });
    const updateMut = useMutation({
      mutationFn: ({ id, ...data }) => mutateJson(`${BASE}/admin/${level}/${id}`, 'PUT', data),
      onSuccess: invalidate,
    });
    const removeMut = useMutation({
      mutationFn: (id) => mutateJson(`${BASE}/admin/${level}/${id}`, 'DELETE'),
      onSuccess: invalidate,
    });

    return {
      create: (data) => createMut.mutateAsync(data),
      update: (id, data) => updateMut.mutateAsync({ id, ...data }),
      remove: (id) => removeMut.mutateAsync(id),
      isLoading: createMut.isPending || updateMut.isPending || removeMut.isPending,
    };
  };
}

export const useClientMutation = makeHierarchyMutation('clients');
export const useProjectMutation = makeHierarchyMutation('projects');
export const useConcessionMutation = makeHierarchyMutation('concessions');
export const useLocationMutation = makeHierarchyMutation('locations');
export const useComplexMutation = makeHierarchyMutation('complexes');
export const usePlatformMutation = makeHierarchyMutation('platforms');

// ─── Auto-Code Generation ────────────────────────────────────────────────────

export function useNextCode(level, parentId) {
  const params = parentId ? `?parent_id=${parentId}` : '';
  return useQuery({
    queryKey: ['admin-next-code', level, parentId],
    queryFn: () => fetchJson(`${BASE}/admin/next-code/${level}${params}`),
    enabled: !!level,
  });
}

// ─── Platform Stats ──────────────────────────────────────────────────────────

export function usePlatformStats(platformId) {
  return useQuery({
    queryKey: ['admin-platform-stats', platformId],
    queryFn: () => fetchJson(`${BASE}/admin/platforms/${platformId}/stats`),
    enabled: !!platformId,
  });
}

// ─── Systems ─────────────────────────────────────────────────────────────────

export function useAdminSystems(platformId) {
  return useQuery({
    queryKey: ['admin-systems', platformId],
    queryFn: () => fetchJson(`${BASE}/admin/systems?platform_id=${platformId}`),
    enabled: !!platformId,
  });
}

export function useSystemMutation() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-systems'] });
    qc.invalidateQueries({ queryKey: ['systems'] });
    qc.invalidateQueries({ queryKey: ['hierarchy'] });
    qc.invalidateQueries({ queryKey: ['register'] });
    qc.invalidateQueries({ queryKey: ['admin-platform-stats'] });
  };

  const createMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/systems`, 'POST', data),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => mutateJson(`${BASE}/admin/systems/${id}`, 'PUT', data),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id) => mutateJson(`${BASE}/admin/systems/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });

  return {
    create: (data) => createMut.mutateAsync(data),
    update: (id, data) => updateMut.mutateAsync({ id, ...data }),
    remove: (id) => removeMut.mutateAsync(id),
    isLoading: createMut.isPending || updateMut.isPending || removeMut.isPending,
  };
}

// ─── P&IDs ───────────────────────────────────────────────────────────────────

export function useAdminPnids(platformId) {
  return useQuery({
    queryKey: ['admin-pnids', platformId],
    queryFn: () => fetchJson(`${BASE}/admin/pnids?platform_id=${platformId}`),
    enabled: !!platformId,
  });
}

export function usePnidMutation() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-pnids'] });
    qc.invalidateQueries({ queryKey: ['pnids'] });
    qc.invalidateQueries({ queryKey: ['pnids-platform'] });
    qc.invalidateQueries({ queryKey: ['hierarchy'] });
    qc.invalidateQueries({ queryKey: ['register'] });
    qc.invalidateQueries({ queryKey: ['admin-platform-stats'] });
  };

  const createMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/pnids`, 'POST', data),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => mutateJson(`${BASE}/admin/pnids/${id}`, 'PUT', data),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id) => mutateJson(`${BASE}/admin/pnids/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });

  return {
    create: (data) => createMut.mutateAsync(data),
    update: (id, data) => updateMut.mutateAsync({ id, ...data }),
    remove: (id) => removeMut.mutateAsync(id),
    isLoading: createMut.isPending || updateMut.isPending || removeMut.isPending,
  };
}

export function usePnidSystemMutation() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-pnids'] });
    qc.invalidateQueries({ queryKey: ['pnids'] });
  };

  const addMut = useMutation({
    mutationFn: ({ pnidId, systemId, isPrimary }) =>
      mutateJson(`${BASE}/admin/pnids/${pnidId}/systems`, 'POST', { systemId, isPrimary }),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: ({ pnidId, systemId }) =>
      mutateJson(`${BASE}/admin/pnids/${pnidId}/systems/${systemId}`, 'DELETE'),
    onSuccess: invalidate,
  });

  return {
    add: (pnidId, systemId, isPrimary = false) => addMut.mutateAsync({ pnidId, systemId, isPrimary }),
    remove: (pnidId, systemId) => removeMut.mutateAsync({ pnidId, systemId }),
    isLoading: addMut.isPending || removeMut.isPending,
  };
}

// ─── Lines ───────────────────────────────────────────────────────────────────

export function useAdminLines(platformId) {
  return useQuery({
    queryKey: ['admin-lines', platformId],
    queryFn: () => fetchJson(`${BASE}/admin/lines?platform_id=${platformId}`),
    enabled: !!platformId,
  });
}

export function useLineMutation() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-lines'] });
    qc.invalidateQueries({ queryKey: ['lines'] });
    qc.invalidateQueries({ queryKey: ['hierarchy'] });
    qc.invalidateQueries({ queryKey: ['register'] });
    qc.invalidateQueries({ queryKey: ['admin-platform-stats'] });
  };

  const createMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/lines`, 'POST', data),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => mutateJson(`${BASE}/admin/lines/${id}`, 'PUT', data),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id) => mutateJson(`${BASE}/admin/lines/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });

  return {
    create: (data) => createMut.mutateAsync(data),
    update: (id, data) => updateMut.mutateAsync({ id, ...data }),
    remove: (id) => removeMut.mutateAsync(id),
    isLoading: createMut.isPending || updateMut.isPending || removeMut.isPending,
  };
}

// ─── Equipment ───────────────────────────────────────────────────────────────

export function useAdminEquipment(platformId) {
  return useQuery({
    queryKey: ['admin-equipment', platformId],
    queryFn: () => fetchJson(`${BASE}/admin/equipment?platform_id=${platformId}`),
    enabled: !!platformId,
  });
}

export function useEquipmentMutation() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-equipment'] });
    qc.invalidateQueries({ queryKey: ['equipment'] });
    qc.invalidateQueries({ queryKey: ['hierarchy'] });
    qc.invalidateQueries({ queryKey: ['register'] });
    qc.invalidateQueries({ queryKey: ['admin-platform-stats'] });
  };

  const createMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/equipment`, 'POST', data),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => mutateJson(`${BASE}/admin/equipment/${id}`, 'PUT', data),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id) => mutateJson(`${BASE}/admin/equipment/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });

  return {
    create: (data) => createMut.mutateAsync(data),
    update: (id, data) => updateMut.mutateAsync({ id, ...data }),
    remove: (id) => removeMut.mutateAsync(id),
    isLoading: createMut.isPending || updateMut.isPending || removeMut.isPending,
  };
}

// ─── Instruments ─────────────────────────────────────────────────────────────

export function useAdminInstruments(platformId) {
  return useQuery({
    queryKey: ['admin-instruments', platformId],
    queryFn: () => fetchJson(`${BASE}/admin/instruments?platform_id=${platformId}`),
    enabled: !!platformId,
  });
}

export function useInstrumentMutation() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-instruments'] });
    qc.invalidateQueries({ queryKey: ['instruments'] });
    qc.invalidateQueries({ queryKey: ['hierarchy'] });
    qc.invalidateQueries({ queryKey: ['register'] });
    qc.invalidateQueries({ queryKey: ['admin-platform-stats'] });
  };

  const createMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/instruments`, 'POST', data),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => mutateJson(`${BASE}/admin/instruments/${id}`, 'PUT', data),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id) => mutateJson(`${BASE}/admin/instruments/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });

  return {
    create: (data) => createMut.mutateAsync(data),
    update: (id, data) => updateMut.mutateAsync({ id, ...data }),
    remove: (id) => removeMut.mutateAsync(id),
    isLoading: createMut.isPending || updateMut.isPending || removeMut.isPending,
  };
}

// ─── Import / Export ─────────────────────────────────────────────────────────

export function useImport(type, platformId) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (csvText) => {
      const params = platformId ? `?platform_id=${platformId}` : '';
      return mutateCSV(`${BASE}/admin/import/${type}${params}`, 'POST', csvText);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`admin-${type}`] });
      qc.invalidateQueries({ queryKey: [type] });
    },
  });
}

export function useExportUrl(type, platformId) {
  if (!type || !platformId) return null;
  return `${BASE}/admin/export/${type}?platform_id=${platformId}`;
}

// ─── Linkage ─────────────────────────────────────────────────────────────────

export function useLinkage(platformId) {
  return useQuery({
    queryKey: ['admin-linkage', platformId],
    queryFn: () => fetchJson(`${BASE}/admin/linkage?platform_id=${platformId}`),
    enabled: !!platformId,
  });
}

// ─── Storage Config ──────────────────────────────────────────────────────────

export function useStorageConfig() {
  return useQuery({
    queryKey: ['admin-storage-config'],
    queryFn: () => fetchJson(`${BASE}/admin/storage/config`),
  });
}

export function useStorageConfigMutation() {
  const qc = useQueryClient();

  const saveMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/storage/config`, 'POST', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-storage-config'] }),
  });

  const testMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/storage/test-connection`, 'POST', data),
  });

  return {
    save: (data) => saveMut.mutateAsync(data),
    testConnection: (data) => testMut.mutateAsync(data),
    isLoading: saveMut.isPending || testMut.isPending,
  };
}

// ─── Storage Sync ───────────────────────────────────────────────────────────

export function useStorageSync() {
  const qc = useQueryClient();

  const scanMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/storage/sync/scan`, 'POST', data),
  });

  const importMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/storage/sync/import`, 'POST', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-pnids'] });
      qc.invalidateQueries({ queryKey: ['admin-platform-stats'] });
      // Also invalidate Miller column caches so imported P&IDs appear immediately
      qc.invalidateQueries({ queryKey: ['pnids'] });
      qc.invalidateQueries({ queryKey: ['pnids-platform'] });
      qc.invalidateQueries({ queryKey: ['systems'] });
      qc.invalidateQueries({ queryKey: ['register'] });
    },
  });

  const linkMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/storage/sync/link`, 'POST', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-pnids'] });
      qc.invalidateQueries({ queryKey: ['pnids'] });
      qc.invalidateQueries({ queryKey: ['pnids-platform'] });
    },
  });

  return {
    scan: (data) => scanMut.mutateAsync(data),
    importFiles: (data) => importMut.mutateAsync(data),
    linkFile: (data) => linkMut.mutateAsync(data),
    isScanning: scanMut.isPending,
    isImporting: importMut.isPending,
  };
}

// ─── P&ID Upload & Versioning ────────────────────────────────────────────────

export function usePnidUpload() {
  const qc = useQueryClient();

  const uploadMut = useMutation({
    mutationFn: ({ pnidId, file, filename, contentType, revision, changeSummary, changeType }) =>
      mutateJson(`${BASE}/admin/pnids/${pnidId}/upload`, 'POST', {
        file, filename, contentType, revision, changeSummary, changeType,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-pnids'] });
      qc.invalidateQueries({ queryKey: ['pnids'] });
    },
  });

  return {
    upload: (data) => uploadMut.mutateAsync(data),
    isLoading: uploadMut.isPending,
  };
}

export function usePnidVersions(pnidId) {
  return useQuery({
    queryKey: ['admin-pnid-versions', pnidId],
    queryFn: () => fetchJson(`${BASE}/admin/pnids/${pnidId}/versions`),
    enabled: !!pnidId,
  });
}

// ─── Version Management ──────────────────────────────────────────────────────

export function usePnidVersionActivate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pnidId, versionId }) =>
      mutateJson(`${BASE}/admin/pnids/${pnidId}/versions/${versionId}/activate`, 'POST', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-pnid-versions'] });
      qc.invalidateQueries({ queryKey: ['admin-pnids'] });
    },
  });
}

export function usePnidAnnotationVerify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pnidId, equipmentIds, instrumentIds, versionId }) =>
      mutateJson(`${BASE}/admin/pnids/${pnidId}/annotations/verify`, 'PUT', { equipmentIds, instrumentIds, versionId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-linkage'] }),
  });
}

export function usePnidUnverifiedAnnotations(pnidId) {
  return useQuery({
    queryKey: ['admin-unverified-annotations', pnidId],
    queryFn: () => fetchJson(`${BASE}/admin/pnids/${pnidId}/annotations/unverified`),
    enabled: !!pnidId,
  });
}

// ─── Import Preview/Apply ────────────────────────────────────────────────────

export function useImportPreview(type) {
  return useMutation({
    mutationFn: ({ csv, platform_id }) =>
      mutateJson(`${BASE}/admin/import/${type}/preview`, 'POST', { csv, platform_id }),
  });
}

export function useImportApply(type) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/import/${type}/apply`, 'POST', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`admin-${type}`] });
      qc.invalidateQueries({ queryKey: [type] });
    },
  });
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

export function useAuditLog(filters = {}) {
  const params = new URLSearchParams();
  if (filters.entity_type) params.set('entity_type', filters.entity_type);
  if (filters.action) params.set('action', filters.action);
  if (filters.page) params.set('page', filters.page);
  if (filters.limit) params.set('limit', filters.limit);

  return useQuery({
    queryKey: ['admin-audit-log', filters],
    queryFn: () => fetchJson(`${BASE}/admin/audit-log?${params.toString()}`),
  });
}

// ─── Platform Templates & Clone ──────────────────────────────────────────────

export function usePlatformTemplates() {
  return useQuery({
    queryKey: ['admin-platform-templates'],
    queryFn: () => fetchJson(`${BASE}/admin/platform-templates`),
  });
}

export function useApplyTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, templateKey }) =>
      mutateJson(`${BASE}/admin/platforms/${platformId}/apply-template`, 'POST', { templateKey }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-systems'] }),
  });
}

export function useClonePlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platformId, newCode, newName, complexId }) =>
      mutateJson(`${BASE}/admin/platforms/${platformId}/clone`, 'POST', { newCode, newName, complexId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-hierarchy'] }),
  });
}

// ─── Transmittals ────────────────────────────────────────────────────────────

export function useTransmittals(platformId) {
  return useQuery({
    queryKey: ['admin-transmittals', platformId],
    queryFn: () => fetchJson(`${BASE}/admin/transmittals?platform_id=${platformId}`),
    enabled: !!platformId,
  });
}

export function useTransmittalMutation() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-transmittals'] });

  const createMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/transmittals`, 'POST', data),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => mutateJson(`${BASE}/admin/transmittals/${id}`, 'PUT', data),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id) => mutateJson(`${BASE}/admin/transmittals/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });

  return {
    create: (data) => createMut.mutateAsync(data),
    update: (id, data) => updateMut.mutateAsync({ id, ...data }),
    remove: (id) => removeMut.mutateAsync(id),
    isLoading: createMut.isPending || updateMut.isPending || removeMut.isPending,
  };
}

export function useTransmittalUpload() {
  const qc = useQueryClient();

  const uploadMut = useMutation({
    mutationFn: ({ transmittalId, formData }) =>
      uploadFormData(`${BASE}/admin/transmittals/${transmittalId}/upload`, 'POST', formData),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-transmittals'] }),
  });

  return {
    upload: ({ transmittalId, formData }) => uploadMut.mutateAsync({ transmittalId, formData }),
    isLoading: uploadMut.isPending,
  };
}

export function useDocumentApproval() {
  const qc = useQueryClient();

  const approveMut = useMutation({
    mutationFn: ({ transmittalId, documentId, status }) =>
      mutateJson(`${BASE}/admin/transmittals/${transmittalId}/documents/${documentId}/approval`, 'PUT', { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-transmittals'] }),
  });

  const bulkApproveMut = useMutation({
    mutationFn: ({ transmittalId, documentIds, status }) =>
      mutateJson(`${BASE}/admin/transmittals/${transmittalId}/documents/bulk-approval`, 'PUT', { documentIds, status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-transmittals'] }),
  });

  return {
    approve: ({ transmittalId, documentId, status }) =>
      approveMut.mutateAsync({ transmittalId, documentId, status }),
    bulkApprove: ({ transmittalId, documentIds, status }) =>
      bulkApproveMut.mutateAsync({ transmittalId, documentIds, status }),
    isLoading: approveMut.isPending || bulkApproveMut.isPending,
  };
}

export function useTransmittalClose() {
  const qc = useQueryClient();

  const closeMut = useMutation({
    mutationFn: (transmittalId) =>
      mutateJson(`${BASE}/admin/transmittals/${transmittalId}/close`, 'POST', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-transmittals'] }),
  });

  return {
    close: (transmittalId) => closeMut.mutateAsync(transmittalId),
    isLoading: closeMut.isPending,
  };
}

// ─── Revision History ────────────────────────────────────────────────────────

export function useRevisionHistory(pnidId) {
  return useQuery({
    queryKey: ['admin-revision-history', pnidId],
    queryFn: () => fetchJson(`${BASE}/admin/pnids/${pnidId}/revision-history`),
    enabled: !!pnidId,
  });
}

export function useListRevisionHistory(platformId, listType) {
  return useQuery({
    queryKey: ['admin-list-revision-history', platformId, listType],
    queryFn: () => fetchJson(`${BASE}/admin/revision-history/${listType}?platform_id=${platformId}`),
    enabled: !!platformId && !!listType,
  });
}

// ─── File Manager ────────────────────────────────────────────────────────────

export function useFileBrowser(configId, prefix, options = {}) {
  const params = new URLSearchParams();
  if (prefix) params.set('prefix', prefix);
  if (options.maxKeys) params.set('maxKeys', String(options.maxKeys));
  if (options.continuationToken) params.set('continuationToken', options.continuationToken);

  return useQuery({
    queryKey: ['admin-file-browser', configId, prefix, options.continuationToken],
    queryFn: () => fetchJson(`${BASE}/admin/storage/${configId}/browse?${params}`),
    enabled: !!configId,
    staleTime: 10000, // 10s — file listings change infrequently during browsing
  });
}

export function useStorageUsage(configId, prefix = '') {
  return useQuery({
    queryKey: ['admin-storage-usage', configId, prefix],
    queryFn: () => fetchJson(`${BASE}/admin/storage/${configId}/usage?prefix=${encodeURIComponent(prefix)}`),
    enabled: !!configId,
    staleTime: 30000,
  });
}

export function useFileManagerMutations(configId) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-file-browser', configId] });

  // Presigned upload: get URL from backend, upload directly to bucket (no file through server)
  const presignedUploadMut = useMutation({
    mutationFn: async ({ key, file, contentType }) => {
      // 1. Get presigned upload URL from backend (small JSON request)
      const presigned = await mutateJson(`${BASE}/admin/storage/${configId}/presigned-upload`, 'POST', {
        key,
        contentType: contentType || file.type || 'application/octet-stream',
      });
      if (!presigned?.url) {
        throw new Error('Failed to get presigned upload URL. Provider may not support direct upload.');
      }
      // 2. Upload file directly to bucket (bypasses server entirely)
      const uploadRes = await fetch(presigned.url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType || file.type || 'application/octet-stream' },
        body: file,
      });
      if (!uploadRes.ok) {
        throw new Error(`Direct upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
      }
      return { key, size: file.size, contentType };
    },
    onSuccess: invalidate,
  });

  // Fallback: proxy upload through backend (for providers that don't support presigned URLs)
  const proxyUploadMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/storage/${configId}/upload`, 'POST', data),
    onSuccess: invalidate,
  });

  const createFolderMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/storage/${configId}/folder`, 'POST', data),
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: (key) => mutateJson(`${BASE}/admin/storage/${configId}/file?key=${encodeURIComponent(key)}`, 'DELETE'),
    onSuccess: invalidate,
  });

  const deleteFolderMut = useMutation({
    mutationFn: (path) => mutateJson(`${BASE}/admin/storage/${configId}/folder?path=${encodeURIComponent(path)}`, 'DELETE'),
    onSuccess: invalidate,
  });

  const copyMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/storage/${configId}/copy`, 'POST', data),
    onSuccess: invalidate,
  });

  const moveMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/storage/${configId}/move`, 'POST', data),
    onSuccess: invalidate,
  });

  // Smart upload: tries presigned first, falls back to proxy
  const upload = async ({ key, file, contentType, fileData }) => {
    // If file object is provided, try presigned upload first (direct to bucket)
    if (file instanceof File || file instanceof Blob) {
      try {
        return await presignedUploadMut.mutateAsync({ key, file, contentType });
      } catch (err) {
        // Fall back to proxy upload for: presigned not supported, CORS errors, network failures
        const msg = err.message || '';
        const shouldFallback = msg.includes('not support') || msg.includes('501')
          || msg.includes('Failed to fetch') || msg.includes('NetworkError')
          || msg.includes('CORS') || msg.includes('ERR_FAILED')
          || err.name === 'TypeError'; // fetch throws TypeError on CORS/network errors
        if (shouldFallback) {
          console.warn('Presigned upload failed, falling back to proxy upload:', msg);
          const reader = new FileReader();
          const base64 = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          return await proxyUploadMut.mutateAsync({ key, contentType: contentType || file.type, fileData: base64 });
        }
        throw err;
      }
    }
    // Legacy: base64 fileData passed directly
    return await proxyUploadMut.mutateAsync({ key, contentType, fileData });
  };

  return {
    upload,
    createFolder: (path) => createFolderMut.mutateAsync({ path }),
    deleteFile: (key) => deleteMut.mutateAsync(key),
    deleteFolder: (path) => deleteFolderMut.mutateAsync(path),
    copy: (sourceKey, destKey) => copyMut.mutateAsync({ sourceKey, destKey }),
    move: (sourceKey, destKey) => moveMut.mutateAsync({ sourceKey, destKey }),
    isUploading: presignedUploadMut.isPending || proxyUploadMut.isPending,
    isDeleting: deleteMut.isPending || deleteFolderMut.isPending,
    isCopying: copyMut.isPending,
    isMoving: moveMut.isPending,
  };
}

// Get a signed URL for viewing a file from storage
export function useFileViewUrl(configId, key) {
  return useQuery({
    queryKey: ['admin-file-view-url', configId, key],
    queryFn: () => fetchJson(`${BASE}/admin/storage/${configId}/url?key=${encodeURIComponent(key)}`),
    enabled: !!configId && !!key,
    staleTime: 55 * 60 * 1000, // Cache for 55 min (URLs expire in 1hr)
  });
}

// Link a storage file to a P&ID record
export function useLinkFileToPnid() {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: ({ pnidId, storageKey }) => mutateJson(`${BASE}/admin/storage/sync/link`, 'POST', {
      pnid_id: pnidId,
      storage_key: storageKey,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-pnids'] });
      qc.invalidateQueries({ queryKey: ['pnid-image'] });
    },
  });
  return { link: (pnidId, storageKey) => mut.mutateAsync({ pnidId, storageKey }), isLinking: mut.isPending };
}

export function useStorageConfigDelete() {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (id) => mutateJson(`${BASE}/admin/storage/config/${id}`, 'DELETE'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-storage-config'] }),
  });
  return { deleteConfig: (id) => mut.mutateAsync(id), isDeleting: mut.isPending };
}

export function getFileDownloadUrl(configId, key) {
  return `${BASE}/admin/storage/${configId}/download?key=${encodeURIComponent(key)}`;
}

export function getFileSignedUrl(configId, key) {
  return fetchJson(`${BASE}/admin/storage/${configId}/url?key=${encodeURIComponent(key)}`);
}

// ═══ AI & VISION SERVICE CREDENTIALS ═══════════════════════════════════════

export function useAdminAiConfig() {
  return useQuery({
    queryKey: ['admin-ai-config'],
    queryFn: () => fetchJson(`${BASE}/admin/ai-config`),
  });
}

export function useAdminAiConfigMutation() {
  const qc = useQueryClient();
  const saveMut = useMutation({
    mutationFn: ({ apiKey, model }) => mutateJson(`${BASE}/admin/ai-config`, 'PUT', { apiKey, model }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-ai-config'] }),
  });
  const testMut = useMutation({
    mutationFn: ({ apiKey } = {}) => mutateJson(`${BASE}/admin/ai-test`, 'POST', { apiKey }),
  });
  return {
    save: (data) => saveMut.mutateAsync(data),
    test: (data) => testMut.mutateAsync(data || {}),
    isSaving: saveMut.isPending,
    isTesting: testMut.isPending,
    saveError: saveMut.error,
    testError: testMut.error,
  };
}

export function useAdminVisionConfig() {
  return useQuery({
    queryKey: ['admin-vision-config'],
    queryFn: () => fetchJson(`${BASE}/admin/vision-config`),
  });
}

export function useAdminVisionConfigMutation() {
  const qc = useQueryClient();
  const saveMut = useMutation({
    mutationFn: ({ visionCredentialsJson }) => mutateJson(`${BASE}/admin/vision-config`, 'PUT', { visionCredentialsJson }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-vision-config'] }),
  });
  const testMut = useMutation({
    mutationFn: ({ credentialsJson } = {}) => mutateJson(`${BASE}/admin/vision-test`, 'POST', { credentialsJson }),
  });
  return {
    save: (data) => saveMut.mutateAsync(data),
    test: (data) => testMut.mutateAsync(data || {}),
    isSaving: saveMut.isPending,
    isTesting: testMut.isPending,
    saveError: saveMut.error,
    testError: testMut.error,
  };
}

// ─── P&ID Symbol Library ───────────────────────────────────────────────────────

export function useAdminSymbols() {
  return useQuery({
    queryKey: ['admin-symbols'],
    queryFn: () => fetchJson(`${BASE}/admin/symbols`),
    select: (data) => data.symbols || [],
  });
}

export function useAdminSymbolMutation() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-symbols'] });
    qc.invalidateQueries({ queryKey: ['custom-pid-symbols'] });
  };

  const createMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/symbols`, 'POST', data),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => mutateJson(`${BASE}/admin/symbols/${id}`, 'PUT', data),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id) => mutateJson(`${BASE}/admin/symbols/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });
  const uploadMut = useMutation({
    mutationFn: ({ id, file, filename, contentType }) =>
      mutateJson(`${BASE}/admin/symbols/${id}/upload`, 'POST', { file, filename, contentType }),
    onSuccess: invalidate,
  });

  return {
    create: (data) => createMut.mutateAsync(data),
    update: (id, data) => updateMut.mutateAsync({ id, ...data }),
    remove: (id) => removeMut.mutateAsync(id),
    upload: (id, payload) => uploadMut.mutateAsync({ id, ...payload }),
    isCreating: createMut.isPending,
    isUpdating: updateMut.isPending,
    isRemoving: removeMut.isPending,
    isUploading: uploadMut.isPending,
  };
}

// ─── Access Control (Users & Roles) ───────────────────────────────────────────

export function useAdminUsers(filters = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.active != null) params.set('active', String(filters.active));
  const qs = params.toString();
  return useQuery({
    queryKey: ['admin-users', filters],
    queryFn: () => fetchJson(`${BASE}/admin/users${qs ? `?${qs}` : ''}`),
  });
}

export function useAdminRoles() {
  return useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => fetchJson(`${BASE}/admin/roles`),
  });
}

export function useAdminPermissions() {
  return useQuery({
    queryKey: ['admin-permissions'],
    queryFn: () => fetchJson(`${BASE}/admin/permissions`),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAccessScopes() {
  return useQuery({
    queryKey: ['admin-access-scopes'],
    queryFn: () => fetchJson(`${BASE}/admin/access-scopes`),
    staleTime: 60 * 1000,
  });
}

export function useUserMutation() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] });
    qc.invalidateQueries({ queryKey: ['admin-roles'] });
  };

  const createMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/users`, 'POST', data),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => mutateJson(`${BASE}/admin/users/${id}`, 'PUT', data),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id) => mutateJson(`${BASE}/admin/users/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });

  return {
    create: (data) => createMut.mutateAsync(data),
    update: (id, data) => updateMut.mutateAsync({ id, ...data }),
    remove: (id) => removeMut.mutateAsync(id),
    isLoading: createMut.isPending || updateMut.isPending || removeMut.isPending,
  };
}

export function useRoleMutation() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-roles'] });
    qc.invalidateQueries({ queryKey: ['admin-users'] });
  };

  const createMut = useMutation({
    mutationFn: (data) => mutateJson(`${BASE}/admin/roles`, 'POST', data),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => mutateJson(`${BASE}/admin/roles/${id}`, 'PUT', data),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id) => mutateJson(`${BASE}/admin/roles/${id}`, 'DELETE'),
    onSuccess: invalidate,
  });

  return {
    create: (data) => createMut.mutateAsync(data),
    update: (id, data) => updateMut.mutateAsync({ id, ...data }),
    remove: (id) => removeMut.mutateAsync(id),
    isLoading: createMut.isPending || updateMut.isPending || removeMut.isPending,
  };
}
