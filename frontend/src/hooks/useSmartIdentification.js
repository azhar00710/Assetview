import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '../lib/authApi';

const API = import.meta.env.VITE_API_URL || '/api/v1';
const MUTATION_TIMEOUT_MS = 20000;

async function fetchJson(url, options = {}, { timeoutMs } = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const res = await authFetch(url, {
      ...options,
      headers,
      signal: controller?.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return { success: true };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out — backend may be busy. Try again or disable snap guides.');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function useSmartIdentSessions(pnidId, enabled = true, { mode = 'manual_draw' } = {}) {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : '';
  return useQuery({
    queryKey: ['smart-ident-sessions', pnidId, mode],
    queryFn: () => fetchJson(`${API}/pnids/${pnidId}/smart-ident/sessions${query}`),
    enabled: !!pnidId && enabled,
    select: (data) => data.sessions || [],
  });
}

export function useSmartIdentSession(pnidId, sessionId) {
  return useQuery({
    queryKey: ['smart-ident-session', pnidId, sessionId],
    queryFn: () => fetchJson(`${API}/pnids/${pnidId}/smart-ident/sessions/${sessionId}`),
    enabled: !!pnidId && !!sessionId,
  });
}

export function useSmartIdentDetect(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boundary, pageNumber = 1, enableSnap = true }) =>
      fetchJson(`${API}/pnids/${pnidId}/smart-ident/detect`, {
        method: 'POST',
        body: JSON.stringify({ boundary, pageNumber, enableSnap }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['smart-ident-sessions', pnidId] });
      if (data?.session?.id) {
        qc.setQueryData(['smart-ident-session', pnidId, data.session.id], data);
      }
    },
  });
}

export function useCreateDrawSession(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pageNumber = 1 } = {}) =>
      fetchJson(`${API}/pnids/${pnidId}/smart-ident/draw-session`, {
        method: 'POST',
        body: JSON.stringify({ pageNumber }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['smart-ident-sessions', pnidId] });
      if (data?.session?.id) {
        qc.setQueryData(['smart-ident-session', pnidId, data.session.id], data);
      }
    },
  });
}

export function useGuideLines(pnidId, pageNumber, enabled) {
  return useQuery({
    queryKey: ['smart-ident-guide-lines', pnidId, pageNumber],
    queryFn: () => fetchJson(`${API}/pnids/${pnidId}/smart-ident/guide-lines?pageNumber=${pageNumber}`),
    enabled: !!pnidId && enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    select: (data) => data.guideLines || [],
  });
}

export function useAddSmartSegment(pnidId) {
  return useMutation({
    mutationFn: ({ sessionId, ...body }) => {
      if (!sessionId) throw new Error('No smart identification session');
      return fetchJson(
        `${API}/pnids/${pnidId}/smart-ident/sessions/${sessionId}/segments`,
        { method: 'POST', body: JSON.stringify(body) },
        { timeoutMs: MUTATION_TIMEOUT_MS },
      );
    },
  });
}

export function useAssignSegment(pnidId, sessionId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ segmentId, ...body }) =>
      fetchJson(
        `${API}/pnids/${pnidId}/smart-ident/segments/${segmentId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        { timeoutMs: MUTATION_TIMEOUT_MS },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['smart-ident-session', pnidId, sessionId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
      qc.invalidateQueries({ queryKey: ['linkable-entities', pnidId] });
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
    },
  });
}

export function useCreateSmartIdentEntity(pnidId, sessionId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      fetchJson(
        `${API}/pnids/${pnidId}/smart-ident/entities`,
        { method: 'POST', body: JSON.stringify(body) },
        { timeoutMs: MUTATION_TIMEOUT_MS },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['linkable-entities', pnidId] });
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
      if (sessionId) {
        qc.invalidateQueries({ queryKey: ['smart-ident-session', pnidId, sessionId] });
      }
    },
  });
}

/** Batch-update flowSequence values after parent-child assignment. */
export function useBatchFlowSequences(pnidId, sessionId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ segmentId, flowSequences }) =>
      fetchJson(
        `${API}/pnids/${pnidId}/smart-ident/segments/${segmentId}`,
        { method: 'PATCH', body: JSON.stringify({ flowSequences }) },
        { timeoutMs: MUTATION_TIMEOUT_MS },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['smart-ident-session', pnidId, sessionId] });
    },
  });
}

export function useUpdateSegmentGeometry(pnidId, sessionId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ segmentId, geometry }) =>
      fetchJson(
        `${API}/pnids/${pnidId}/smart-ident/segments/${segmentId}`,
        { method: 'PATCH', body: JSON.stringify({ geometry }) },
        { timeoutMs: MUTATION_TIMEOUT_MS },
      ),
    onSuccess: () => {
      if (sessionId) {
        qc.invalidateQueries({ queryKey: ['smart-ident-session', pnidId, sessionId] });
      }
      qc.invalidateQueries({ queryKey: ['overlay', pnidId] });
      qc.invalidateQueries({ queryKey: ['annotations', pnidId] });
    },
  });
}

export function useDeleteSmartSegment(pnidId, sessionId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (segmentId) =>
      fetchJson(
        `${API}/pnids/${pnidId}/smart-ident/segments/${segmentId}`,
        { method: 'DELETE' },
        { timeoutMs: MUTATION_TIMEOUT_MS },
      ),
    onSuccess: () => {
      if (sessionId) {
        qc.invalidateQueries({ queryKey: ['smart-ident-session', pnidId, sessionId] });
      }
    },
  });
}

export function useDeleteSmartIdentSession(pnidId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId) =>
      fetchJson(`${API}/pnids/${pnidId}/smart-ident/sessions/${sessionId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['smart-ident-sessions', pnidId] });
    },
  });
}

export const SMART_IDENT_COLORS = {
  unassigned: '#94A3B8',
  line: '#2D33E0',
  equipment: '#3BE494',
  instrument: '#F39C12',
  valve: '#E74C3C',
  selected: '#FFD700',
  boundary: '#3BE494',
};

export function segmentStrokeColor(segment, selected = false) {
  if (selected) return SMART_IDENT_COLORS.selected;
  if (segment.displayColor) return segment.displayColor;
  if (segment.linkedEntityType) return SMART_IDENT_COLORS[segment.linkedEntityType] || SMART_IDENT_COLORS.unassigned;
  return SMART_IDENT_COLORS.unassigned;
}
