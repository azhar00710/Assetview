import { useQuery } from '@tanstack/react-query';

const API = import.meta.env.VITE_API_URL || '/api/v1';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Fetch admin-managed custom P&ID symbols for Smart Identification. */
export function useCustomPidSymbols() {
  return useQuery({
    queryKey: ['custom-pid-symbols'],
    queryFn: () => fetchJson(`${API}/symbols`),
    select: (data) => data.symbols || [],
    staleTime: 60_000,
  });
}
