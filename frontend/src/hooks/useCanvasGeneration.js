import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_URL || '/api/v1';

async function fetchJson(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Check generation readiness for a system.
 * Returns per-sheet coverage, OCR availability, connection counts.
 */
export function useGenerationReadiness(systemId) {
  return useQuery({
    queryKey: ['generation-readiness', systemId],
    queryFn: () => fetchJson(`${API}/topology/generation-readiness/${systemId}`),
    enabled: !!systemId,
    refetchInterval: 30000, // refresh every 30s while panel is open
  });
}

/**
 * Generate canvas from annotations.
 * Invalidates topology + layout queries on success so the canvas reloads.
 */
export function useGenerateCanvas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ systemId, dryRun = false }) =>
      fetchJson(`${API}/topology/generate/${systemId}`, {
        method: 'POST',
        body: JSON.stringify({ dryRun }),
      }),
    onSuccess: (_data, { systemId }) => {
      qc.invalidateQueries({ queryKey: ['topology', systemId] });
      qc.invalidateQueries({ queryKey: ['layout', systemId] });
      qc.invalidateQueries({ queryKey: ['generation-readiness', systemId] });
    },
  });
}

/**
 * Get OCR-based position suggestions for a P&ID sheet.
 * Returns suggested positions for unplaced entities.
 */
export function useOcrSuggestions(pnidId) {
  return useQuery({
    queryKey: ['ocr-suggestions', pnidId],
    queryFn: () => fetchJson(`${API}/topology/ocr-suggestions/${pnidId}`),
    enabled: !!pnidId,
    select: (data) => data.suggestions,
  });
}
