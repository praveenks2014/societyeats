import { isMockMode } from '@/lib/config';
import type { GeoPoint } from '@/lib/geo';
import { mockCreateDelivery, mockQuote, mockTrack, simulateLatency } from '../mock-core';
import type { DeliveryProvider, OrderInfo, ProviderOrder, Quote, TrackingState } from '../types';

/**
 * Borzo (formerly WeFast) India API adapter.
 * Borzo has genuinely public docs: https://borzodelivery.com/in/business-api
 * // VERIFY against partner docs when keys arrive — payloads below follow the
 * // public v1.4 business API and should be re-checked on account approval.
 */

const BASE_URL = process.env.BORZO_BASE_URL || 'https://robotapitest-in.borzodelivery.com/api/business/1.6';

function useLive(): boolean {
  return !isMockMode() && !!process.env.BORZO_AUTH_TOKEN;
}

async function borzoFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-DV-Auth-Token': process.env.BORZO_AUTH_TOKEN || '',
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`borzo: HTTP ${res.status}`);
  return res.json();
}

function points(order: OrderInfo) {
  return [
    {
      address: order.pickupName,
      latitude: order.pickup.lat,
      longitude: order.pickup.lng,
      contact_person: { name: order.pickupName, phone: `91${order.pickupPhone}` },
    },
    {
      address: order.dropAddressText,
      latitude: order.drop.lat,
      longitude: order.drop.lng,
      contact_person: { name: order.dropName, phone: `91${order.dropPhone}` },
    },
  ];
}

export const BorzoAdapter: DeliveryProvider = {
  name: 'borzo',

  async getQuote(pickup: GeoPoint, drop: GeoPoint): Promise<Quote> {
    if (!useLive()) return mockQuote('borzo', pickup, drop);
    // VERIFY against partner docs when keys arrive
    const data = await borzoFetch('/calculate-order', {
      method: 'POST',
      body: JSON.stringify({
        matter: 'Food',
        points: [
          { address: 'pickup', latitude: pickup.lat, longitude: pickup.lng },
          { address: 'drop', latitude: drop.lat, longitude: drop.lng },
        ],
      }),
    });
    return {
      provider: 'borzo',
      amountInPaise: Math.round(parseFloat(data.order?.payment_amount ?? '50') * 100),
      etaMins: 30,
    };
  },

  async createDelivery(order: OrderInfo): Promise<ProviderOrder> {
    if (!useLive()) return mockCreateDelivery('borzo');
    // VERIFY against partner docs when keys arrive
    const data = await borzoFetch('/create-order', {
      method: 'POST',
      body: JSON.stringify({ matter: 'Food', points: points(order) }),
    });
    return {
      providerOrderId: String(data.order?.order_id),
      trackingUrl: data.order?.points?.[1]?.tracking_url,
    };
  },

  async track(providerOrderId: string): Promise<TrackingState> {
    if (!useLive()) return mockTrack(providerOrderId);
    // VERIFY against partner docs when keys arrive
    const data = await borzoFetch(`/orders?order_id=${providerOrderId}`);
    const o = data.orders?.[0];
    const map: Record<string, TrackingState['status']> = {
      new: 'rider_assigned',
      available: 'rider_assigned',
      active: 'in_transit',
      completed: 'delivered',
      canceled: 'failed',
    };
    return {
      status: map[o?.status] ?? 'in_transit',
      riderName: o?.courier?.name,
      riderPhone: o?.courier?.phone,
    };
  },

  async cancel(providerOrderId: string): Promise<void> {
    if (!useLive()) {
      await simulateLatency();
      return;
    }
    // VERIFY against partner docs when keys arrive
    await borzoFetch('/cancel-order', {
      method: 'POST',
      body: JSON.stringify({ order_id: providerOrderId }),
    });
  },
};
