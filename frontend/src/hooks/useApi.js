import { useQuery } from '@tanstack/react-query';
import { authFetch } from '../lib/authApi';

// Use Vite's built-in proxy (vite.config.js proxies /api -> localhost:3001).
// This works in all environments including Codespaces since the proxy runs server-side.
const BASE = '/api/v1';

async function fetchJson(url) {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function usePlatforms() {
  return useQuery({
    queryKey: ['platforms'],
    queryFn: () => fetchJson(`${BASE}/platforms`),
    select: d => d.platforms,
  });
}

export function useSystems(platformId) {
  return useQuery({
    queryKey: ['systems', platformId],
    queryFn: () => fetchJson(`${BASE}/platforms/${platformId}/systems`),
    select: d => d.systems,
    enabled: !!platformId,
  });
}

export function usePnids(systemId, includeXref = true) {
  return useQuery({
    queryKey: ['pnids', systemId, includeXref],
    queryFn: () => fetchJson(`${BASE}/pnids?system_id=${systemId}&include_xref=${includeXref}`),
    select: d => d.pnids,
    enabled: !!systemId,
  });
}

export function usePnidsByPlatform(platformId) {
  return useQuery({
    queryKey: ['pnids-platform', platformId],
    queryFn: () => fetchJson(`${BASE}/pnids?platform_id=${platformId}`),
    select: d => d.pnids,
    enabled: !!platformId,
  });
}

export function useLines({ systemId, pnidId, platformId, includeXref = true }) {
  const params = new URLSearchParams();
  if (pnidId) params.set('pnid_id', pnidId);
  else if (systemId) { params.set('system_id', systemId); params.set('include_xref', includeXref); }
  else if (platformId) params.set('platform_id', platformId);

  return useQuery({
    queryKey: ['lines', { systemId, pnidId, platformId, includeXref }],
    queryFn: () => fetchJson(`${BASE}/lines?${params}`),
    select: d => d.lines,
    enabled: !!(pnidId || systemId || platformId),
  });
}

export function useEquipment({ systemId, pnidId, lineId, platformId }) {
  const params = new URLSearchParams();
  if (lineId) params.set('line_id', lineId);
  else if (pnidId) params.set('pnid_id', pnidId);
  else if (systemId) params.set('system_id', systemId);
  else if (platformId) params.set('platform_id', platformId);

  return useQuery({
    queryKey: ['equipment', { systemId, pnidId, lineId, platformId }],
    queryFn: () => fetchJson(`${BASE}/equipment?${params}`),
    select: d => d.equipment,
    enabled: !!(lineId || pnidId || systemId || platformId),
  });
}

export function useInstruments({ systemId, pnidId, lineId, platformId }) {
  const params = new URLSearchParams();
  if (lineId) params.set('line_id', lineId);
  else if (pnidId) params.set('pnid_id', pnidId);
  else if (systemId) params.set('system_id', systemId);
  else if (platformId) params.set('platform_id', platformId);

  return useQuery({
    queryKey: ['instruments', { systemId, pnidId, lineId, platformId }],
    queryFn: () => fetchJson(`${BASE}/instruments?${params}`),
    select: d => d.instruments,
    enabled: !!(lineId || pnidId || systemId || platformId),
  });
}

export function useHierarchy(platformId) {
  return useQuery({
    queryKey: ['hierarchy', platformId],
    queryFn: () => fetchJson(`${BASE}/asset-tree/${platformId}/hierarchy`),
    enabled: !!platformId,
    staleTime: 60_000,
  });
}

export function useRegister(type, platformId) {
  return useQuery({
    queryKey: ['register', type, platformId],
    queryFn: () => fetchJson(`${BASE}/registers/${type}?platform_id=${platformId}`),
    enabled: !!type && !!platformId,
  });
}

export function usePnidDetail(pnidId) {
  return useQuery({
    queryKey: ['pnid-detail', pnidId],
    queryFn: () => fetchJson(`${BASE}/pnids/${pnidId}`),
    enabled: !!pnidId,
  });
}

export function useSearch(platformId, query) {
  return useQuery({
    queryKey: ['search', platformId, query],
    queryFn: () => fetchJson(`${BASE}/search?platform_id=${platformId}&q=${encodeURIComponent(query)}`),
    select: d => d.results,
    enabled: !!platformId && !!query && query.length >= 2,
  });
}

export function useTagDocuments(tag) {
  return useQuery({
    queryKey: ['tag-documents', tag],
    queryFn: () => fetchJson(`${BASE}/tags/${encodeURIComponent(tag)}/documents`),
    select: d => d.documents,
    enabled: !!tag,
  });
}

export function useTagSearch(query) {
  return useQuery({
    queryKey: ['tag-search', query],
    queryFn: () => fetchJson(`${BASE}/tags/search?q=${encodeURIComponent(query)}`),
    select: d => d.results,
    enabled: !!query && query.length >= 2,
    staleTime: 30_000,
  });
}
