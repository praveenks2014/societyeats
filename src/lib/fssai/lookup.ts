/**
 * FssaiLookupAdapter: FoSCoS has no public API, so a live adapter (a verification provider) plugs in behind
 * FSSAI_LOOKUP_API_KEY later. The mock is deterministic and offline: it only *advises* the admin — the admin
 * always compares the certificate by eye and decides.
 *   14 digits starting 1 → found, active      14 digits starting 2 → found, expired
 *   anything else        → not found
 */
export type FssaiLookupResult = { source: 'mock' | 'live'; found: boolean; status: 'active' | 'expired' | 'unknown'; businessName?: string; validTill?: string };

export async function lookupFssai(number: string | null | undefined, opts: { kitchenName?: string } = {}): Promise<FssaiLookupResult> {
  const n = (number ?? '').replace(/\s/g, '');
  if (!/^\d{14}$/.test(n)) return { source: 'mock', found: false, status: 'unknown' };
  if (process.env.FSSAI_LOOKUP_API_KEY && process.env.MOCK_MODE === 'false') return { source: 'live', found: false, status: 'unknown' }; // live adapter not configured yet
  if (n.startsWith('1')) return { source: 'mock', found: true, status: 'active', businessName: opts.kitchenName ?? 'Mock Kitchen', validTill: '2031-12-31' };
  if (n.startsWith('2')) return { source: 'mock', found: true, status: 'expired', businessName: opts.kitchenName ?? 'Mock Kitchen', validTill: '2024-06-30' };
  return { source: 'mock', found: false, status: 'unknown' };
}
