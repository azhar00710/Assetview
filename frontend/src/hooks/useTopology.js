import { useQuery } from '@tanstack/react-query';

const BASE = '/api/v1';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/** Fetch system topology (nodes + edges) for React Flow canvas */
export function useTopology(systemId) {
  return useQuery({
    queryKey: ['topology', systemId],
    queryFn: () => fetchJson(`${BASE}/systems/${systemId}/topology`),
    enabled: !!systemId,
  });
}

/** BFS upstream from a node */
export function useUpstream(systemId, nodeId) {
  return useQuery({
    queryKey: ['topology-upstream', systemId, nodeId],
    queryFn: () => fetchJson(`${BASE}/systems/${systemId}/topology/upstream/${nodeId}`),
    enabled: !!systemId && !!nodeId,
  });
}

/** BFS downstream from a node */
export function useDownstream(systemId, nodeId) {
  return useQuery({
    queryKey: ['topology-downstream', systemId, nodeId],
    queryFn: () => fetchJson(`${BASE}/systems/${systemId}/topology/downstream/${nodeId}`),
    enabled: !!systemId && !!nodeId,
  });
}
