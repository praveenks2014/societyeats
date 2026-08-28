import type { GeoPoint } from '@/lib/geo';

export type Quote = {
  provider: ProviderName;
  amountInPaise: number;
  etaMins: number;
};

export type OrderInfo = {
  orderId: number;
  pickup: GeoPoint;
  drop: GeoPoint;
  pickupName: string;
  pickupPhone: string;
  dropName: string;
  dropPhone: string;
  dropAddressText: string;
};

export type ProviderOrder = {
  providerOrderId: string;
  riderName?: string;
  riderPhone?: string;
  trackingUrl?: string;
};

export type TrackingState = {
  status: 'rider_assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'failed';
  riderName?: string;
  riderPhone?: string;
  etaMins?: number;
  note?: string;
};

export type ProviderName = 'porter' | 'shadowfax' | 'borzo';

export interface DeliveryProvider {
  name: ProviderName;
  getQuote(pickup: GeoPoint, drop: GeoPoint): Promise<Quote>;
  createDelivery(order: OrderInfo): Promise<ProviderOrder>;
  track(providerOrderId: string): Promise<TrackingState>;
  cancel(providerOrderId: string): Promise<void>;
}
