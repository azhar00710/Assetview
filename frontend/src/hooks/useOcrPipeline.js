import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_URL || '/api/v1';

async function fetchJson(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

/** OCR Dashboard — all P&IDs with OCR status */
export function useOcrDashboard(platformId) {
  return useQuery({
    queryKey: ['ocr-dashboard', platformId],
    queryFn: () => fetchJson(`${API}/ocr/dashboard?platformId=${platformId}`),
    enabled: !!platformId,
    refetchInterval: 10000, // Poll every 10s for processing jobs
  });
}

/** Batch extract — run OCR on multiple P&IDs */
export function useOcrBatchExtract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pnidIds }) =>
      fetchJson(`${API}/ocr/batch-extract`, {
        method: 'POST',
        body: JSON.stringify({ pnidIds }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ocr-dashboard'] });
    },
  });
}

/** OCR Notifications — platform-wide or per-pnid */
export function useOcrNotifications({ platformId, pnidId } = {}) {
  const key = pnidId
    ? ['ocr-notifications', 'pnid', pnidId]
    : ['ocr-notifications', 'platform', platformId];
  const params = pnidId
    ? `pnidId=${pnidId}`
    : `platformId=${platformId}`;

  return useQuery({
    queryKey: key,
    queryFn: () => fetchJson(`${API}/ocr/notifications?${params}`),
    enabled: !!(platformId || pnidId),
    refetchInterval: 30000, // Poll every 30s
  });
}
