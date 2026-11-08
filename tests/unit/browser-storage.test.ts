import { beforeEach, describe, expect, test } from 'vitest';
import { BRAND } from '@/config/brand';
import { migrateLegacyStorage } from '@/lib/browser-storage';

/** A minimal in-memory Storage (the unit tests run in Node, not a browser). */
class MemStore {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  keys() { return [...this.m.keys()]; }
}
const g = globalThis as unknown as { localStorage: MemStore; sessionStorage: MemStore };
const legacy = BRAND.legacyStoragePrefixes[0];

describe('B2: browser-storage keys move to the new prefix once', () => {
  beforeEach(() => {
    g.localStorage = new MemStore();
    g.sessionStorage = new MemStore();
  });

  test('old keys are copied to the new name and deleted, once', () => {
    g.localStorage.setItem(`${legacy}_cart`, '{"items":[1]}');
    g.localStorage.setItem(`${legacy}_loc`, '{"lat":1}');
    g.localStorage.setItem(`${legacy}_push_dismissed`, '1');
    g.localStorage.setItem('unrelated', 'x');
    g.sessionStorage.setItem(`${legacy}_visit_site`, '1');
    migrateLegacyStorage();
    expect(g.localStorage.getItem(BRAND.storageKey('cart'))).toBe('{"items":[1]}');
    expect(g.localStorage.getItem(BRAND.storageKey('loc'))).toBe('{"lat":1}');
    expect(g.localStorage.getItem(BRAND.storageKey('push_dismissed'))).toBe('1');
    expect(g.sessionStorage.getItem(BRAND.storageKey('visit_site'))).toBe('1');
    expect(g.localStorage.keys().some((k) => k.startsWith(`${legacy}_`))).toBe(false);
    expect(g.localStorage.getItem('unrelated')).toBe('x');
    // it ran once: an old key that appears later (another tab on an old build) is left alone by the flag
    g.localStorage.setItem(`${legacy}_cart`, 'late');
    migrateLegacyStorage();
    expect(g.localStorage.getItem(BRAND.storageKey('cart'))).toBe('{"items":[1]}');
    expect(g.localStorage.getItem(`${legacy}_cart`)).toBe('late');
  });

  test('a value already under the new key is never overwritten by an old one', () => {
    g.localStorage.setItem(BRAND.storageKey('cart'), 'new');
    g.localStorage.setItem(`${legacy}_cart`, 'old');
    migrateLegacyStorage();
    expect(g.localStorage.getItem(BRAND.storageKey('cart'))).toBe('new');
    expect(g.localStorage.getItem(`${legacy}_cart`)).toBeNull();
  });

  test('unavailable storage does not throw', () => {
    g.localStorage = { getItem() { throw new Error('denied'); } } as unknown as MemStore;
    expect(() => migrateLegacyStorage()).not.toThrow();
  });
});
