import { useCallback, useRef } from 'react';

const DB_NAME = 'assetview-3d-cache';
const STORE_NAME = 'tiles';
const DB_VERSION = 1;

/**
 * IndexedDB cache for 3D model tiles / glTF chunks.
 * Critical for offshore environments with satellite bandwidth (~2 Mbps).
 *
 * Usage:
 *   const { getCached, setCached, clearCache } = useTileCache();
 *   const cached = await getCached(url, versionHash);
 */
export default function useTileCache() {
  const dbRef = useRef(null);

  const openDB = useCallback(() => {
    if (dbRef.current) return Promise.resolve(dbRef.current);

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        dbRef.current = req.result;
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  }, []);

  const getCached = useCallback(
    async (url, versionHash) => {
      try {
        const db = await openDB();
        const key = `${url}:${versionHash || 'latest'}`;
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result?.data || null);
          req.onerror = () => resolve(null);
        });
      } catch {
        return null;
      }
    },
    [openDB],
  );

  const setCached = useCallback(
    async (url, versionHash, data) => {
      try {
        const db = await openDB();
        const key = `${url}:${versionHash || 'latest'}`;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ key, data, cachedAt: Date.now() });
      } catch {
        // Silently fail — cache is best-effort
      }
    },
    [openDB],
  );

  const clearCache = useCallback(async () => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
    } catch {
      // ignore
    }
  }, [openDB]);

  return { getCached, setCached, clearCache };
}
