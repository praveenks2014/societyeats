'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { OrderTimeline, STATUS_META, StatusPill } from '@/components/order-status';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';
import { COMPLAINT_CATEGORIES, COMPLAINT_OUTCOME_LABELS, type ComplaintCategory, type ComplaintOutcome } from '@/lib/complaints';

type FulfillmentType = 'self_pickup' | 'seller_delivery' | 'platform_delivery';

type Detail = {
  order: {
    id: number;
    type: 'home_delivery' | 'mall_pickup';
    fulfillmentType: FulfillmentType;
    status: string;
    subtotalInPaise: number;
    deliveryFeeInPaise: number;
    platformFeeInPaise: number;
    gstInPaise: number;
    totalInPaise: number;
    refundInPaise: number;
    referralCreditAppliedInPaise: number;
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
  review: { rating: number; text: string | null; sellerReplyText: string | null } | null;
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
            {order.type === 'mall_pickup'
              ? 'SHOW AT THE COUNTER'
              : order.fulfillmentType === 'platform_delivery'
                ? 'SHARE WITH YOUR RIDER'
                : order.fulfillmentType === 'seller_delivery'
                  ? 'SHARE WITH THE KITCHEN AT DELIVERY'
                  : 'SHOW TO THE KITCHEN'}
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
          {delivery && order.fulfillmentType === 'platform_delivery' && (
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-rice px-4 py-3">
              <div>
                <div className="text-sm font-semibold">🛵 {delivery.riderName ?? 'Assigning rider…'}</div>
                <div className="text-xs capitalize text-ink-faint">
                  via {delivery.provider} {delivery.riderPhone ? `· ${delivery.riderPhone}` : ''}
                </div>
              </div>
            </div>
          )}
          {mockMode && order.status === 'out_for_delivery' && order.fulfillmentType === 'platform_delivery' && (
            <MockRiderEntry orderId={order.id} onDone={load} />
          )}
          {mockMode && order.status === 'out_for_delivery' && order.fulfillmentType === 'seller_delivery' && (
            <p className="mt-3 text-center text-xs text-ink-faint">
              (Demo: the kitchen verifies this OTP from their orders page when they hand it over)
            </p>
          )}
          {mockMode && order.status === 'ready' && order.type === 'mall_pickup' && (
            <p className="mt-3 text-center text-xs text-ink-faint">
              (Demo: counter staff verifies this OTP from the restaurant console)
            </p>
          )}
          {mockMode && order.status === 'ready' && order.type === 'home_delivery' && order.fulfillmentType === 'self_pickup' && (
            <p className="mt-3 text-center text-xs text-ink-faint">
              (Demo: the kitchen verifies this OTP from their orders page when you collect)
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
          <div className="flex justify-between">
            <span>
              {order.fulfillmentType === 'self_pickup'
                ? 'Delivery (self pickup)'
                : order.fulfillmentType === 'seller_delivery'
                  ? 'Delivery fee (kept by the kitchen)'
                  : 'Delivery fee (via delivery partner)'}
            </span>
            <span>{order.deliveryFeeInPaise > 0 ? formatINR(order.deliveryFeeInPaise) : 'FREE'}</span>
          </div>
          {order.platformFeeInPaise > 0 && (
            <div className="flex justify-between">
              <span>Platform fee</span>
              <span>{formatINR(order.platformFeeInPaise)}</span>
            </div>
          )}
          {order.gstInPaise > 0 && (
            <div className="flex justify-between">
              <span>GST on food</span>
              <span>{formatINR(order.gstInPaise)}</span>
            </div>
          )}
          {order.referralCreditAppliedInPaise > 0 && (
            <div className="flex justify-between text-leaf">
              <span>Referral credit applied</span>
              <span>−{formatINR(order.referralCreditAppliedInPaise)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1 text-base font-bold">
            <span>Total paid</span>
            <span>{formatINR(order.totalInPaise)}</span>
          </div>
          {order.refundInPaise > 0 && (
            <div className="flex justify-between text-leaf">
              <span>Refunded</span>
              <span>−{formatINR(order.refundInPaise)}</span>
            </div>
          )}
        </div>
        {order.status !== 'placed' && (
          <Link
            href={`/orders/${order.id}/invoice`}
            className="mt-3 block text-center text-sm font-semibold text-leaf underline"
          >
            🧾 View invoice
          </Link>
        )}
      </Card>

      {/* review */}
      {data.viewerIsBuyer && ['delivered', 'picked_up'].includes(order.status) && (
        <ReviewBlock orderId={order.id} review={data.review} onDone={load} />
      )}

      {/* complaint (DECISIONS.md #73+) */}
      {data.viewerIsBuyer && ['delivered', 'picked_up'].includes(order.status) && (
        <ComplaintBlock orderId={order.id} />
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
  review: { rating: number; text: string | null; sellerReplyText: string | null } | null;
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
        {review.sellerReplyText && (
          <div className="mt-2 rounded-xl bg-rice-deep px-3 py-2 text-sm">
            <span className="font-semibold">Kitchen&apos;s reply: </span>
            {review.sellerReplyText}
          </div>
        )}
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

type ComplaintData = {
  complaint: {
    id: number;
    category: ComplaintCategory;
    description: string;
    status: 'open' | 'resolved';
    outcome: ComplaintOutcome | null;
    refundInPaise: number;
  } | null;
  eligible: boolean;
  windowHours: number;
};

/** "Report an issue" — buyer-raised complaint within DEFAULTS.complaintWindowHours (DECISIONS.md #73+). */
function ComplaintBlock({ orderId }: { orderId: number }) {
  const [data, setData] = useState<ComplaintData | null>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ComplaintCategory>('quality');
  const [description, setDescription] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    fetch(`/api/orders/${orderId}/complaint`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [orderId]);
  useEffect(load, [load]);

  async function upload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json();
    setUploading(false);
    if (!res.ok) {
      toast(d.error || 'Upload failed', 'err');
      return;
    }
    setPhotoUrl(d.url);
  }

  async function submit() {
    setBusy(true);
    const res = await fetch(`/api/orders/${orderId}/complaint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, description, photoUrl: photoUrl || undefined }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not report the issue', 'err');
      return;
    }
    toast('Issue reported — our team will review it');
    setOpen(false);
    setDescription('');
    setPhotoUrl('');
    load();
  }

  if (!data) return null;

  if (data.complaint) {
    const c = data.complaint;
    return (
      <Card className="mt-4 p-4">
        <div className="eyebrow mb-1.5">YOUR REPORTED ISSUE</div>
        <p className="text-sm text-ink-soft">{c.description}</p>
        <div className="mt-2">
          {c.status === 'open' ? (
            <Badge tone="amber">Under review</Badge>
          ) : (
            <Badge tone={c.outcome === 'rejected' ? 'neutral' : 'green'}>
              {c.outcome ? COMPLAINT_OUTCOME_LABELS[c.outcome] : 'Resolved'}
            </Badge>
          )}
        </div>
      </Card>
    );
  }

  if (!data.eligible) return null;

  return (
    <Card className="mt-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow mb-0.5">SOMETHING WRONG?</div>
          <p className="text-xs text-ink-faint">Report within {data.windowHours}h of delivery/pickup</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Report an issue
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Report an issue" sheet>
        <div className="space-y-4">
          <Field label="What went wrong?">
            <Select value={category} onChange={(e) => setCategory(e.target.value as ComplaintCategory)}>
              {COMPLAINT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tell us more">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened with your order?"
            />
          </Field>
          <Field label="Photo (optional)">
            <div className="flex items-center gap-3">
              {photoUrl && <FoodImage src={photoUrl} alt="" className="h-14 w-14 rounded-xl" />}
              <input
                type="file"
                accept="image/*"
                id="complaint-photo-input"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={uploading}
                onClick={() => document.getElementById('complaint-photo-input')?.click()}
              >
                {photoUrl ? 'Change photo' : 'Add photo'}
              </Button>
            </div>
          </Field>
          <Button className="w-full" onClick={submit} loading={busy} disabled={!description.trim()}>
            Submit
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
