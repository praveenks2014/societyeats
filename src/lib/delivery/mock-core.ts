import { haversineKm, type GeoPoint } from '@/lib/geo';
import type { ProviderName, ProviderOrder, Quote, TrackingState } from './types';

/**
 * Shared mock behaviour for all three provider adapters:
 * - realistic latency (200–900 ms)
 * - distance-based quotes ₹30–₹70 with per-provider pricing personalities
 * - ~15% random createDelivery failure to exercise the orchestrator's failover
 * - staged tracking: dispatch time is encoded in the providerOrderId, so
 *   status progresses on the clock with no background workers (Replit-safe)
 */

const RIDERS = [
  ['Srinivas K', '9888800011'],
  ['Mohammed A', '9888800022'],
  ['Venkat R', '9888800033'],
  ['Ravi Teja', '9888800044'],
  ['Anil Kumar', '9888800055'],
  ['Shiva P', '9888800066'],
] as const;

const PROVIDER_PREFIX: Record<ProviderName, string> = {
  porter: 'PRT',
  shadowfax: 'SFX',
  borzo: 'BRZ',
};

// per-km pricing personality (paise) so quotes differ believably per provider
const PRICING: Record<ProviderName, { base: number; perKm: number }> = {
  porter: { base: 3000, perKm: 420 },
  shadowfax: { base: 2800, perKm: 460 },
  borzo: { base: 3400, perKm: 380 },
};

export function simulateLatency(): Promise<void> {
  return new Promise((r) => setTimeout(r, 200 + Math.random() * 700));
}

export async function mockQuote(
  provider: ProviderName,
  pickup: GeoPoint,
  drop: GeoPoint,
): Promise<Quote> {
  await simulateLatency();
  const km = haversineKm(pickup, drop);
  const { base, perKm } = PRICING[provider];
  const raw = base + Math.round(km * perKm);
  const amountInPaise = Math.min(7000, Math.max(3000, raw));
  return { provider, amountInPaise, etaMins: Math.round(12 + km * 3) };
}

export async function mockCreateDelivery(provider: ProviderName): Promise<ProviderOrder> {
  await simulateLatency();
  // ~15% simulated failure so the failover path gets exercised in demos
  if (Math.random() < 0.15) {
    throw new Error(`${provider}: no riders available near pickup (simulated)`);
  }
  const rider = RIDERS[Math.floor(Math.random() * RIDERS.length)];
  const providerOrderId = `${PROVIDER_PREFIX[provider]}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return {
    providerOrderId,
    riderName: rider[0],
    riderPhone: rider[1],
    trackingUrl: `https://track.example/${providerOrderId}`,
  };
}

/** Progression: 0–60 s rider assigned → 60–180 s picked up → in transit → arrived (waits for OTP). */
export async function mockTrack(providerOrderId: string): Promise<TrackingState> {
  await simulateLatency();
  const parts = providerOrderId.split('-');
  const dispatchedAt = Number(parts[1]) || Date.now();
  const elapsedSec = (Date.now() - dispatchedAt) / 1000;

  if (elapsedSec < 60) {
    return { status: 'rider_assigned', etaMins: 18, note: 'Rider heading to the kitchen' };
  }
  if (elapsedSec < 180) {
    return { status: 'picked_up', etaMins: 14, note: 'Order picked up' };
  }
  const eta = Math.max(0, Math.round(14 - (elapsedSec - 180) / 60));
  if (eta > 0) {
    return { status: 'in_transit', etaMins: eta, note: 'On the way to you' };
  }
  return {
    status: 'in_transit',
    etaMins: 0,
    note: 'Rider has arrived — share your 4-digit OTP to receive the order',
  };
}
