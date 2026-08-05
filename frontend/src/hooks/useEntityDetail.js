import { useQuery } from '@tanstack/react-query';

const BASE = '/api/v1';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * useEntityDetail — fetch enriched detail for equipment or instrument.
 * Returns { entity, pnids, line, system, loading, error }
 */
export default function useEntityDetail(entityId, entityType) {
  const isEquipment = entityType === 'equipment';
  const isInstrument = entityType === 'instrument';
  const enabled = !!entityId && (isEquipment || isInstrument);

  const url = isEquipment
    ? `${BASE}/equipment/${entityId}`
    : `${BASE}/instruments/${entityId}/detail`;

  const { data, isLoading, error } = useQuery({
    queryKey: ['entity-detail', entityType, entityId],
    queryFn: () => fetchJson(url),
    enabled,
    staleTime: 30_000,
  });

  if (!enabled || !data) {
    return { entity: null, pnids: [], line: null, system: null, loading: isLoading, error };
  }

  const entity = isEquipment ? data.equipment : data.instrument;
  return {
    entity,
    pnids: data.pnids || [],
    line: data.line || null,
    system: data.system || null,
    loading: isLoading,
    error,
  };
}
