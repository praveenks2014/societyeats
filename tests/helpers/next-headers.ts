/** In-memory replacement for `next/headers` so route handlers can be called directly in unit tests. */
const jar = new Map<string, string>();
let requestHeaders: Record<string, string> = {};

export function resetRequestContext(h: Record<string, string> = {}) {
  jar.clear();
  requestHeaders = h;
}
export function getCookie(name: string) {
  return jar.get(name);
}
export function setCookieJar(name: string, value: string) {
  jar.set(name, value);
}

export function cookies() {
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      if (opts?.maxAge === 0 || value === '') jar.delete(name);
      else jar.set(name, value);
    },
    delete: (name: string) => void jar.delete(name),
  };
}

export function headers() {
  return { get: (n: string) => requestHeaders[n.toLowerCase()] ?? null };
}
