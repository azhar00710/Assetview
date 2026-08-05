import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_URL || '/api/v1';

async function fetchJson(url, options) {
  const headers = { ...options?.headers };
  // Only set Content-Type: application/json when there's a body to send
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
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

/** Get active dictionary entries for a platform */
export function useTagDictionary(platformId) {
  return useQuery({
    queryKey: ['tag-dictionary', platformId],
    queryFn: () => fetchJson(`${API}/tag-dictionary/${platformId}?all=true`),
    enabled: !!platformId,
  });
}

/** Get dictionary stats */
export function useTagDictionaryStats(platformId) {
  return useQuery({
    queryKey: ['tag-dictionary-stats', platformId],
    queryFn: () => fetchJson(`${API}/tag-dictionary/${platformId}/stats`),
    enabled: !!platformId,
  });
}

/** Get standard templates */
export function useTagDictionaryTemplates() {
  return useQuery({
    queryKey: ['tag-dictionary-templates'],
    queryFn: () => fetchJson(`${API}/tag-dictionary/templates`),
  });
}

/** Add single entry */
export function useAddDictionaryEntry(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry) => fetchJson(`${API}/tag-dictionary/${platformId}`, {
      method: 'POST',
      body: JSON.stringify(entry),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-dictionary', platformId] });
      qc.invalidateQueries({ queryKey: ['tag-dictionary-stats', platformId] });
    },
  });
}

/** Update entry */
export function useUpdateDictionaryEntry(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, ...updates }) => fetchJson(`${API}/tag-dictionary/entries/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-dictionary', platformId] });
      qc.invalidateQueries({ queryKey: ['tag-dictionary-stats', platformId] });
    },
  });
}

/** Delete entry */
export function useDeleteDictionaryEntry(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId) => fetchJson(`${API}/tag-dictionary/entries/${entryId}`, {
      method: 'DELETE',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-dictionary', platformId] });
      qc.invalidateQueries({ queryKey: ['tag-dictionary-stats', platformId] });
    },
  });
}

/** Import CSV */
export function useImportCsv(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (csvText) => fetchJson(`${API}/tag-dictionary/${platformId}/import-csv`, {
      method: 'POST',
      body: JSON.stringify({ csvText }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-dictionary', platformId] });
      qc.invalidateQueries({ queryKey: ['tag-dictionary-stats', platformId] });
    },
  });
}

/** Import JSON entries */
export function useImportJson(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries) => fetchJson(`${API}/tag-dictionary/${platformId}/import-json`, {
      method: 'POST',
      body: JSON.stringify({ entries }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-dictionary', platformId] });
      qc.invalidateQueries({ queryKey: ['tag-dictionary-stats', platformId] });
    },
  });
}

/** AI auto-detect from OCR batch and/or data files (CSV/Excel — all sheets, all columns) */
export function useAiDetect(platformId) {
  return useMutation({
    mutationFn: ({ batchId, apiKey, dataFiles }) =>
      fetchJson(`${API}/tag-dictionary/${platformId}/ai-detect`, {
        method: 'POST',
        body: JSON.stringify({
          batchId: batchId || undefined,
          apiKey,
          dataFiles: dataFiles || undefined,
        }),
      }),
  });
}

/** Get saved tag analyses for a platform */
export function useTagAnalyses(platformId) {
  return useQuery({
    queryKey: ['tag-analyses', platformId],
    queryFn: async () => {
      const data = await fetchJson(`${API}/tag-dictionary/${platformId}/analyses`);
      return data.analyses || [];
    },
    enabled: !!platformId,
  });
}

/** Save AI-detected entries */
export function useApplyAiDetected(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries) => fetchJson(`${API}/tag-dictionary/${platformId}/ai-detect/apply`, {
      method: 'POST',
      body: JSON.stringify({ entries }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-dictionary', platformId] });
      qc.invalidateQueries({ queryKey: ['tag-dictionary-stats', platformId] });
    },
  });
}

/** Apply global template to platform */
export function useApplyTemplate(platformId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson(`${API}/tag-dictionary/${platformId}/apply-template`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-dictionary', platformId] });
      qc.invalidateQueries({ queryKey: ['tag-dictionary-stats', platformId] });
    },
  });
}
