'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Input, Skeleton, Textarea } from '@/components/ui';
import { OrderTimeline, STATUS_META, StatusPill } from '@/components/order-status';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Detail = {
  order: {
    id: number;
    type: 'home_delivery' | 'mall_pickup';
    status: string;
    subtotalInPaise: number;
    deliveryFeeInPaise: number;
    platformFeeInPaise: number;
    totalInPaise: number;
    otpCode: string | null;
    deliveryAddressJson: { flat: string; addressText: string; lat: number; lng: number } | null;
    createdAt: string;
  };
  items: { id: number; titleSnapshot: string; qty: number; unitPriceInPaise: number }[];
  events: { id: number; status: string; note: string | null; createdAt: string }[];
  delivery: {
    provider: string;
    status: string;
    riderName: string | null;
    riderPhone: string | null;
    attemptsJson: { provider: string; at: string; outcome: string; detail?: string }[] | null;
  } | null;
  tracking: { status: string; etaMins?: number; note?: string } | null;
  review: { rating: number; text: string | null } | null;
  vendor:
    | { kind: 'seller'; name: string | null; phone: string | null }
    | { kind: 'restaurant'; name: string; counterNumber: string; mallName?: string };
  viewerIsBuyer: boolean;
};

const ACTIVE = ['placed', 'paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivery_unassigned'];

export function OrderDetail({ orderId, mockMode }: { orderId: number; mockMode: boolean }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || 'Could not load order');
        return;
      }
      setData(d);
    } catch {
      /* keep last data on transient network errors */
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  // poll while the order is active
  useEffect(() => {
    if (!data || !ACTIVE.includes(data.order.status)) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [data, load]);

  if (error) {
    return (
      <div className="pt-16 text-center">
        <p className="text-lg font-semibold">{error}</p>
        <Link href="/orders" className="mt-3 inline-block text-sm text-leaf underline">
          ← My orders
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-lg space-y-4 pt-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const { order, vendor, delivery, tracking } = data;
  const meta = STATUS_META[order.status];

  return (
    <div className="mx-auto max-w-lg pt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">ORDER #{order.id}</div>
          <h1 className="mt-0.5 text-xl font-bold">{vendor.name}</h1>
          {vendor.kind === 'restaurant' && (
            <p className="text-sm text-ink-soft">
              {vendor.mallName} · Counter {vendor.counterNumber}
            </p>
          )}
        </div>
        <StatusPill status={order.status} />
      </div>

      {/* status hero */}
      <Card className="mt-4 p-5 text-center">
        <div className="text-4xl">{meta?.emoji}</div>
        <div className="mt-1 text-lg font-bold">{meta?.label}</div>
        {tracking?.note && <p className="mt-1 text-sm text-ink-soft">{tracking.note}</p>}
        {tracking?.etaMins != null && tracking.etaMins > 0 && (
          <p className="mt-1 text-sm font-semibold text-leaf">~{tracking.etaMins} min away</p>
        )}
        {order.status === 'delivery_unassigned' && (
          <p className="mt-1 text-sm text-ink-soft">
            All delivery partners are busy — our team has been alerted and is assigning a rider.
          </p>
        )}
      </Card>

      {/* OTP + rider panel */}
      {order.otpCode && ['out_for_delivery', 'ready'].includes(order.status) && data.viewerIsBuyer && (
        <Card className="mt-4 p-5">
          <div className="eyebrow">
            {order.type === 'home_delivery' ? 'SHARE WITH YOUR RIDER' : 'SHOW AT THE COUNTER'}
          </div>
          <div className="mt-2 flex justify-center gap-2">
            {order.otpCode.split('').map((d, i) => (
              <span
                key={i}
                className="flex h-12 w-10 items-center justify-center rounded-xl bg-leaf font-display text-xl font-bold text-white"
              >
                {d}
              </span>
            ))}
          </div>
          {delivery && order.type === 'home_delivery' && (
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-rice px-4 py-3">
              <div>
                <div className="text-sm font-semibold">🛵 {delivery.riderName ?? 'Assigning rider…'}</div>
                <div className="text-xs capitalize text-ink-faint">
                  via {delivery.provider} {delivery.riderPhone ? `· ${delivery.riderPhone}` : ''}
                </div>
              </div>
            </div>
          )}
          {mockMode && order.status === 'out_for_delivery' && (
            <MockRiderEntry orderId={order.id} onDone={load} />
          )}
          {mockMode && order.status === 'ready' && order.type === 'mall_pickup' && (
            <p className="mt-3 text-center text-xs text-ink-faint">
              (Demo: counter staff verifies this OTP from the restaurant console)
            </p>
          )}
        </Card>
      )}

      {/* failover attempts log */}
      {delivery?.attemptsJson && delivery.attemptsJson.length > 1 && (
        <Card className="mt-4 p-4">
          <div className="eyebrow mb-2">DELIVERY DISPATCH LOG</div>
          <div className="space-y-1.5">
            {delivery.attemptsJson.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span>{a.outcome === 'success' ? '✅' : '❌'}</span>
                <span className="font-semibold capitalize">{a.provider}</span>
                <span className="text-ink-faint">{a.detail ?? a.outcome}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* map for home delivery */}
      {order.deliveryAddressJson && (
        <Card className="mt-4 overflow-hidden">
          <iframe
            title="Delivery location"
            className="h-40 w-full border-0"
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${order.deliveryAddressJson.lng - 0.01}%2C${order.deliveryAddressJson.lat - 0.006}%2C${order.deliveryAddressJson.lng + 0.01}%2C${order.deliveryAddressJson.lat + 0.006}&layer=mapnik&marker=${order.deliveryAddressJson.lat}%2C${order.deliveryAddressJson.lng}`}
          />
          <div className="px-4 py-3 text-sm">
            <span className="font-semibold">{order.deliveryAddressJson.flat}</span>,{' '}
            {order.deliveryAddressJson.addressText}
          </div>
        </Card>
      )}

      {/* timeline */}
      <Card className="mt-4 p-5">
        <div className="eyebrow mb-4">ORDER TIMELINE</div>
        <OrderTimeline events={data.events} />
      </Card>

      {/* bill */}
      <Card className="mt-4 p-4">
        <div className="eyebrow mb-3">BILL</div>
        <div className="space-y-1.5 text-sm">
          {data.items.map((i) => (
            <div key={i.id} className="flex justify-between">
              <span className="text-ink-soft">
                {i.titleSnapshot} × {i.qty}
              </span>
              <span>{formatINR(i.qty * i.unitPriceInPaise)}</span>
            </div>
          ))}
          <div className="border-t border-dashed border-rice-line pt-1.5" />
          {order.deliveryFeeInPaise > 0 && (
            <div className="flex justify-between">
              <span>Delivery fee</span>
              <span>{formatINR(order.deliveryFeeInPaise)}</span>
            </div>
          )}
          {order.platformFeeInPaise > 0 && (
            <div className="flex justify-between">
              <span>Platform fee</span>
              <span>{formatINR(order.platformFeeInPaise)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1 text-base font-bold">
            <span>Total paid</span>
            <span>{formatINR(order.totalInPaise)}</span>
          </div>
        </div>
      </Card>

      {/* review */}
      {data.viewerIsBuyer && ['delivered', 'picked_up'].includes(order.status) && (
        <ReviewBlock orderId={order.id} review={data.review} onDone={load} />
      )}

      <div className="mt-8 text-center">
        <Link href="/orders" className="text-sm font-semibold text-leaf underline">
          ← All orders
        </Link>
      </div>
    </div>
  );
}

/** MOCK_MODE: simulate the rider's OTP entry from the buyer's tracking screen. */
function MockRiderEntry({ orderId, onDone }: { orderId: number; onDone: () => void }) {
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    setBusy(true);
    const res = await fetch(`/api/orders/${orderId}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Wrong OTP', 'err');
      return;
    }
    toast('Delivered! 🎉');
    onDone();
  }

  return (
    <div className="mt-4 rounded-2xl border border-dashed border-turmeric bg-turmeric-tint/60 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-turmeric-deep">
        <Badge tone="amber">MOCK</Badge> Rider&apos;s handset — enter buyer&apos;s OTP
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          inputMode="numeric"
          maxLength={4}
          placeholder="4-digit OTP"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
        />
        <Button onClick={submit} loading={busy} disabled={otp.length !== 4}>
          Deliver
        </Button>
      </div>
    </div>
  );
}

function ReviewBlock({
  orderId,
  review,
  onDone,
}: {
  orderId: number;
  review: { rating: number; text: string | null } | null;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (review) {
    return (
      <Card className="mt-4 p-4">
        <div className="eyebrow mb-1.5">YOUR RATING</div>
        <div className="text-lg">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</div>
        {review.text && <p className="mt-1 text-sm text-ink-soft">{review.text}</p>}
      </Card>
    );
  }

  async function submit() {
    setBusy(true);
    const res = await fetch(`/api/orders/${orderId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, text }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not save rating', 'err');
      return;
    }
    toast('Thanks for rating! ⭐');
    onDone();
  }

  return (
    <Card className="mt-4 p-4">
      <div className="eyebrow mb-2">HOW WAS IT?</div>
      <div className="flex gap-1 text-3xl">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setRating(n)}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className={n <= rating ? 'text-turmeric' : 'text-rice-line'}
          >
            ★
          </button>
        ))}
      </div>
      <Textarea
        rows={2}
        className="mt-3"
        placeholder="Tell the kitchen what you loved (optional)"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button className="mt-3" onClick={submit} loading={busy} disabled={rating === 0}>
        Submit rating
      </Button>
    </Card>
  );
}
