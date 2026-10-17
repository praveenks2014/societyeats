import { isMockMode } from '@/lib/config';
import type { GeoPoint } from '@/lib/geo';
import { mockCreateDelivery, mockQuote, mockTrack, simulateLatency } from '../mock-core';
import type { DeliveryProvider, OrderInfo, ProviderOrder, Quote, TrackingState } from '../types';

/**
 * Porter "Porter for Enterprise" API adapter.
 * Live request shapes follow Porter's public partner docs (v1).
 * // VERIFY against partner docs when keys arrive — endpoints & payloads below
 * // were written from public documentation and must be confirmed during
 * // Porter business onboarding (https://porter.in — API partner program).
 */

const BASE_URL = process.env.PORTER_BASE_URL || 'https://pfe-apigw-uat.porter.in';

function shouldUseLive(): boolean {
  return !isMockMode() && !!process.env.PORTER_API_KEY;
}

async function porterFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': process.env.PORTER_API_KEY || '',
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`porter: HTTP ${res.status}`);
  return res.json();
}

export const PorterAdapter: DeliveryProvider = {
  name: 'porter',

  async getQuote(pickup: GeoPoint, drop: GeoPoint): Promise<Quote> {
    if (!shouldUseLive()) return mockQuote('porter', pickup, drop);
    // VERIFY against partner docs when keys arrive
    const data = await porterFetch(
      `/v1/get_quote?pickup_details[lat]=${pickup.lat}&pickup_details[lng]=${pickup.lng}&drop_details[lat]=${drop.lat}&drop_details[lng]=${drop.lng}&customer[name]=GharSe&customer[mobile][number]=9999999999&customer[mobile][country_code]=+91`,
    );
    const twoWheeler = data.vehicles?.find((v: { type: string }) => v.type === '2 Wheeler');
    return {
      provider: 'porter',
      amountInPaise: twoWheeler?.fare?.minor_amount ?? 5000,
      etaMins: Math.round((twoWheeler?.eta?.value ?? 1200) / 60),
    };
  },

  async createDelivery(order: OrderInfo): Promise<ProviderOrder> {
    if (!shouldUseLive()) return mockCreateDelivery('porter');
    // VERIFY against partner docs when keys arrive
    const data = await porterFetch('/v1/orders/create', {
      method: 'POST',
      body: JSON.stringify({
        request_id: `gharse-${order.orderId}-${Date.now()}`,
        pickup_details: {
          address: {
            apartment_address: order.pickupName,
            street_address1: order.pickupName,
            city: 'Hyderabad',
            country: 'India',
            lat: order.pickup.lat,
            lng: order.pickup.lng,
            contact_details: { name: order.pickupName, phone_number: `+91${order.pickupPhone}` },
          },
        },
        drop_details: {
          address: {
            apartment_address: order.dropAddressText,
            street_address1: order.dropAddressText,
            city: 'Hyderabad',
            country: 'India',
            lat: order.drop.lat,
            lng: order.drop.lng,
            contact_details: { name: order.dropName, phone_number: `+91${order.dropPhone}` },
          },
        },
      }),
    });
    return {
      providerOrderId: data.order_id,
      trackingUrl: data.tracking_url,
    };
  },

  async track(providerOrderId: string): Promise<TrackingState> {
    if (!shouldUseLive()) return mockTrack(providerOrderId);
    // VERIFY against partner docs when keys arrive
    const data = await porterFetch(`/v1/orders/${providerOrderId}`);
    const map: Record<string, TrackingState['status']> = {
      open: 'rider_assigned',
      accepted: 'rider_assigned',
      live: 'in_transit',
      ended: 'delivered',
      cancelled: 'failed',
    };
    return {
      status: map[data.status] ?? 'in_transit',
      riderName: data.partner_info?.name,
      riderPhone: data.partner_info?.mobile?.number,
    };
  },

  async cancel(providerOrderId: string): Promise<void> {
    if (!shouldUseLive()) {
      await simulateLatency();
      return;
    }
    // VERIFY against partner docs when keys arrive
    await porterFetch(`/v1/orders/${providerOrderId}/cancel`, { method: 'POST' });
  },
};
