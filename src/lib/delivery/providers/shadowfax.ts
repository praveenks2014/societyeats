import { isMockMode } from '@/lib/config';
import type { GeoPoint } from '@/lib/geo';
import { mockCreateDelivery, mockQuote, mockTrack, simulateLatency } from '../mock-core';
import type { DeliveryProvider, OrderInfo, ProviderOrder, Quote, TrackingState } from '../types';

/**
 * Shadowfax Flash (hyperlocal) API adapter.
 * // VERIFY against partner docs when keys arrive — Shadowfax's Flash API is
 * // shared during business onboarding; shapes below follow their public
 * // integration guide and must be confirmed with the assigned SPOC.
 */

const BASE_URL = process.env.SHADOWFAX_BASE_URL || 'https://hlbackend.staging.shadowfax.in';

function useLive(): boolean {
  return !isMockMode() && !!process.env.SHADOWFAX_API_TOKEN;
}

async function sfxFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${process.env.SHADOWFAX_API_TOKEN || ''}`,
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`shadowfax: HTTP ${res.status}`);
  return res.json();
}

export const ShadowfaxAdapter: DeliveryProvider = {
  name: 'shadowfax',

  async getQuote(pickup: GeoPoint, drop: GeoPoint): Promise<Quote> {
    if (!useLive()) return mockQuote('shadowfax', pickup, drop);
    // VERIFY against partner docs when keys arrive
    const data = await sfxFetch('/api/v1/stores/serviceability/', {
      method: 'POST',
      body: JSON.stringify({
        pickup_details: { latitude: pickup.lat, longitude: pickup.lng },
        drop_details: { latitude: drop.lat, longitude: drop.lng },
      }),
    });
    return {
      provider: 'shadowfax',
      amountInPaise: Math.round((data.total_amount ?? 50) * 100),
      etaMins: data.sla_minutes ?? 30,
    };
  },

  async createDelivery(order: OrderInfo): Promise<ProviderOrder> {
    if (!useLive()) return mockCreateDelivery('shadowfax');
    // VERIFY against partner docs when keys arrive
    const data = await sfxFetch('/api/v1/orders/', {
      method: 'POST',
      body: JSON.stringify({
        order_details: { client_order_id: `gharse-${order.orderId}` },
        pickup_details: {
          name: order.pickupName,
          contact_number: order.pickupPhone,
          latitude: order.pickup.lat,
          longitude: order.pickup.lng,
        },
        drop_details: {
          name: order.dropName,
          contact_number: order.dropPhone,
          address: order.dropAddressText,
          latitude: order.drop.lat,
          longitude: order.drop.lng,
        },
      }),
    });
    return { providerOrderId: String(data.order_id ?? data.id) };
  },

  async track(providerOrderId: string): Promise<TrackingState> {
    if (!useLive()) return mockTrack(providerOrderId);
    // VERIFY against partner docs when keys arrive
    const data = await sfxFetch(`/api/v1/orders/${providerOrderId}/track/`);
    const map: Record<string, TrackingState['status']> = {
      ALLOTTED: 'rider_assigned',
      ARRIVED: 'rider_assigned',
      COLLECTED: 'picked_up',
      STARTED_FOR_DELIVERY: 'in_transit',
      DELIVERED: 'delivered',
      CANCELLED: 'failed',
      RTS_INITIATED: 'failed',
    };
    return {
      status: map[data.status] ?? 'in_transit',
      riderName: data.rider_name,
      riderPhone: data.rider_contact,
    };
  },

  async cancel(providerOrderId: string): Promise<void> {
    if (!useLive()) {
      await simulateLatency();
      return;
    }
    // VERIFY against partner docs when keys arrive
    await sfxFetch(`/api/v1/orders/${providerOrderId}/cancel/`, { method: 'POST' });
  },
};
