const cache = new Map();
const pending = new Map();

/** Preload and cache a legend symbol PNG for Konva / canvas use. */
export function loadPidSymbolImage(src) {
  if (!src) return Promise.resolve(null);
  if (cache.has(src)) return Promise.resolve(cache.get(src));
  if (pending.has(src)) return pending.get(src);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      cache.set(src, img);
      pending.delete(src);
      resolve(img);
    };
    img.onerror = () => {
      pending.delete(src);
      resolve(null);
    };
    img.src = src;
  });

  pending.set(src, promise);
  return promise;
}

export function getPidSymbolImage(src) {
  return cache.get(src) || null;
}

/** Eagerly warm the cache for toolbox symbols. */
export function preloadPidSymbolImages(symbols = []) {
  for (const sym of symbols) {
    if (sym?.image) loadPidSymbolImage(sym.image);
  }
}
