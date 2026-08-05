import { useQuery } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_URL || '/api/v1';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function useAnnotationSearch(query, { platformId, pnidId, enabled = true } = {}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (platformId) params.set('platform_id', platformId);
  if (pnidId) params.set('pnid_id', pnidId);

  return useQuery({
    queryKey: ['annotation-search', query, platformId, pnidId],
    queryFn: () => fetchJson(`${API}/annotations/search?${params}`),
    enabled: enabled && !!query && query.length >= 1,
    select: (data) => data.results,
    staleTime: 5000,
  });
}

export function useAnnotationSummary(pnidId) {
  return useQuery({
    queryKey: ['annotation-summary', pnidId],
    queryFn: () => fetchJson(`${API}/pnids/${pnidId}/annotation-summary`),
    enabled: !!pnidId,
    refetchInterval: 30000, // Poll every 30s for live updates
  });
}
