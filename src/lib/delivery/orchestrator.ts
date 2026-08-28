import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  deliveries,
  orderEvents,
  orders,
  providerHealth,
  users,
  type DeliveryAttempt,
} from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';
import type { GeoPoint } from '@/lib/geo';
import { notify } from '@/lib/db/notify';
import { PorterAdapter } from './providers/porter';
import { ShadowfaxAdapter } from './providers/shadowfax';
import { BorzoAdapter } from './providers/borzo';
import type { DeliveryProvider, OrderInfo, ProviderName, Quote, TrackingState } from './types';

const REGISTRY: Record<ProviderName, DeliveryProvider> = {
  porter: PorterAdapter,
  shadowfax: ShadowfaxAdapter,
  borzo: BorzoAdapter,
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function enabledProviders() {
  const db = await getDb();
  const rows = await db
    .select()
    .from(providerHealth)
    .where(eq(providerHealth.isEnabled, true))
    .orderBy(asc(providerHealth.priority));
  return rows.filter((r) => r.provider in REGISTRY);
}

async function recordSuccess(provider: ProviderName) {
  const db = await getDb();
  await db
    .update(providerHealth)
    .set({ lastSuccessAt: new Date(), failureCount: 0 })
    .where(eq(providerHealth.provider, provider));
}

async function recordFailure(provider: ProviderName) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(providerHealth)
    .where(eq(providerHealth.provider, provider));
  const failureCount = (row?.failureCount ?? 0) + 1;
  const disable = failureCount >= DEFAULTS.providerAutoDisableAfterFailures;
  await db
    .update(providerHealth)
    .set({
      lastFailureAt: new Date(),
      failureCount,
      ...(disable ? { isEnabled: false } : {}),
    })
    .where(eq(providerHealth.provider, provider));
  if (disable) await notifyAdmins(
    `Provider ${provider} auto-disabled`,
    `${provider} failed ${failureCount} times in a row and was disabled. Re-enable it from Admin → Providers.`,
    '/admin/providers',
  );
}

async function notifyAdmins(title: string, body: string, href: string) {
  const db = await getDb();
  const admins = await db.select().from(users).where(eq(users.role, 'admin'));
  await Promise.all(admins.map((a) => notify(a.id, title, body, href)));
}

/** Best available quote, walking the priority list. Falls back to a flat ₹49. */
export async function getBestQuote(pickup: GeoPoint, drop: GeoPoint): Promise<Quote> {
  const providers = await enabledProviders();
  for (const row of providers) {
    const adapter = REGISTRY[row.provider as ProviderName];
    try {
      return await withTimeout(
        adapter.getQuote(pickup, drop),
        DEFAULTS.deliveryProviderTimeoutMs,
        adapter.name,
      );
    } catch {
      // quote failures are non-fatal — try the next provider
    }
  }
  return { provider: 'porter', amountInPaise: 4900, etaMins: 30 };
}

/**
 * The signature feature: try providers in priority order, log every attempt,
 * auto-disable flapping providers, and surface a fully-failed dispatch to the
 * admin as `delivery_unassigned`.
 */
export async function dispatchDelivery(orderId: number): Promise<void> {
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.type !== 'home_delivery' || !order.deliveryAddressJson) return;

  const existing = await db.select().from(deliveries).where(eq(deliveries.orderId, orderId));
  if (existing.length > 0) return; // idempotent

  const [seller] = order.sellerId
    ? await db.select().from(users).where(eq(users.id, order.sellerId))
    : [];
  const [buyer] = await db.select().from(users).where(eq(users.id, order.buyerId));
  if (!seller || !buyer) return;

  const info: OrderInfo = {
    orderId,
    pickup: { lat: seller.lat ?? 17.44, lng: seller.lng ?? 78.35 },
    drop: { lat: order.deliveryAddressJson.lat, lng: order.deliveryAddressJson.lng },
    pickupName: seller.name,
    pickupPhone: seller.phone,
    dropName: buyer.name,
    dropPhone: buyer.phone,
    dropAddressText: `${order.deliveryAddressJson.flat}, ${order.deliveryAddressJson.addressText}`,
  };

  const attempts: DeliveryAttempt[] = [];
  const providers = await enabledProviders();

  for (const row of providers) {
    const adapter = REGISTRY[row.provider as ProviderName];

    // chaos toggle: force this provider down to demo failover live
    if (row.chaosForceFail) {
      attempts.push({
        provider: adapter.name,
        at: new Date().toISOString(),
        outcome: 'failed',
        detail: 'Chaos toggle: provider forced down by admin',
      });
      await recordFailure(adapter.name);
      continue;
    }

    try {
      const created = await withTimeout(
        adapter.createDelivery(info),
        DEFAULTS.deliveryProviderTimeoutMs,
        adapter.name,
      );
      attempts.push({ provider: adapter.name, at: new Date().toISOString(), outcome: 'success' });
      await recordSuccess(adapter.name);
      await db.insert(deliveries).values({
        orderId,
        provider: adapter.name,
        providerOrderId: created.providerOrderId,
        status: 'rider_assigned',
        riderName: created.riderName,
        riderPhone: created.riderPhone,
        trackingUrl: created.trackingUrl,
        quoteInPaise: order.deliveryFeeInPaise,
        attemptsJson: attempts,
        dispatchedAt: new Date(),
      });
      await db.insert(orderEvents).values({
        orderId,
        status: 'rider_assigned',
        note: `${created.riderName ?? 'Rider'} assigned via ${adapter.name}${
          attempts.length > 1 ? ` (after ${attempts.length - 1} failed attempt(s))` : ''
        }`,
      });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      attempts.push({
        provider: adapter.name,
        at: new Date().toISOString(),
        outcome: message.includes('timed out') ? 'timeout' : 'failed',
        detail: message,
      });
      await recordFailure(adapter.name);
    }
  }

  // every provider failed
  await db
    .update(orders)
    .set({ status: 'delivery_unassigned', updatedAt: new Date() })
    .where(eq(orders.id, orderId));
  await db.insert(orderEvents).values({
    orderId,
    status: 'delivery_unassigned',
    note: `All delivery providers failed (${attempts.length} attempts)`,
  });
  await db.insert(deliveries).values({
    orderId,
    provider: providers[0]?.provider ?? 'porter',
    status: 'failed',
    attemptsJson: attempts,
  });
  await notifyAdmins(
    `Order #${orderId} has no rider`,
    'All delivery providers failed. Re-enable a provider or retry dispatch from the order page.',
    '/admin/orders',
  );
}

/** Retry a failed dispatch (admin action) — clears the failed row and re-runs. */
export async function retryDispatch(orderId: number): Promise<void> {
  const db = await getDb();
  await db.delete(deliveries).where(eq(deliveries.orderId, orderId));
  await db
    .update(orders)
    .set({ status: 'ready', updatedAt: new Date() })
    .where(eq(orders.id, orderId));
  await dispatchDelivery(orderId);
}

/**
 * Lazily sync provider tracking into our tables (no background workers):
 * called whenever someone views an order with an active delivery.
 */
export async function syncDeliveryTracking(orderId: number): Promise<TrackingState | null> {
  const db = await getDb();
  const [delivery] = await db.select().from(deliveries).where(eq(deliveries.orderId, orderId));
  if (!delivery || !delivery.providerOrderId) return null;
  if (['delivered', 'cancelled', 'failed'].includes(delivery.status)) {
    return { status: delivery.status as TrackingState['status'] };
  }

  const adapter = REGISTRY[delivery.provider as ProviderName];
  if (!adapter) return null;

  let tracking: TrackingState;
  try {
    tracking = await withTimeout(
      adapter.track(delivery.providerOrderId),
      DEFAULTS.deliveryProviderTimeoutMs,
      adapter.name,
    );
  } catch {
    return { status: delivery.status as TrackingState['status'] };
  }

  if (tracking.status !== delivery.status && tracking.status !== 'delivered') {
    await db
      .update(deliveries)
      .set({
        status: tracking.status,
        riderName: tracking.riderName ?? delivery.riderName,
        riderPhone: tracking.riderPhone ?? delivery.riderPhone,
      })
      .where(eq(deliveries.id, delivery.id));
  }

  // when the rider picks up, move the order to out_for_delivery
  if (
    ['picked_up', 'in_transit'].includes(tracking.status) &&
    !['out_for_delivery', 'delivered'].includes(
      (await db.select().from(orders).where(eq(orders.id, orderId)))[0]?.status ?? '',
    )
  ) {
    await db
      .update(orders)
      .set({ status: 'out_for_delivery', updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    await db.insert(orderEvents).values({
      orderId,
      status: 'out_for_delivery',
      note: `${delivery.riderName ?? 'Rider'} picked up your order`,
    });
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (order) {
      await notify(
        order.buyerId,
        'Your order is on the way 🛵',
        `${delivery.riderName ?? 'Your rider'} has picked up order #${orderId}.`,
        `/orders/${orderId}`,
      );
    }
  }

  return { ...tracking, riderName: tracking.riderName ?? delivery.riderName ?? undefined, riderPhone: tracking.riderPhone ?? delivery.riderPhone ?? undefined };
}
