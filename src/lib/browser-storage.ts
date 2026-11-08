import { BRAND } from '@/config/brand';

/**
 * Browser-storage keys are `<slug>_<name>` (e.g. `kootu_cart`). The first time the app loads after a rename, keys written under an earlier
 * prefix (see `legacyStoragePrefixes` in brand.ts) are copied to the new name once and the old keys are deleted, so nobody loses their cart or location.
 * Safe to call on every page load: after the first run it only reads one flag.
 */
export function migrateLegacyStorage(): void {
  const flag = BRAND.storageKey('storage_migrated');
  try {
    if (localStorage.getItem(flag) === '1') return;
    for (const store of [localStorage, sessionStorage]) {
      const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => k !== null);
      for (const key of keys) {
        const old = BRAND.legacyStoragePrefixes.find((p) => key.startsWith(`${p}_`));
        if (!old) continue;
        const next = BRAND.storageKey(key.slice(old.length + 1));
        if (store.getItem(next) === null) store.setItem(next, store.getItem(key) ?? '');
        store.removeItem(key);
      }
    }
    localStorage.setItem(flag, '1');
  } catch {
    /* storage unavailable (private window): nothing to migrate */
  }
}
