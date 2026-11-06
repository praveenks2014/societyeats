'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { AtDoorPaymentCard, FeeRetryCard, OrderThread } from '@/components/order-extras';
import { COMPLETED_STATUSES, FINISHED_STATUSES, OrderTimeline, STATUS_META, StatusPill } from '@/components/order-status';
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
    foodTotalInPaise: number;
    onlineChargeInPaise: number;
    platformFeeInPaise: number;
    platformFeeGstInPaise: number;
    feeBeforeCreditInPaise: number;
    feeBpsSnapshot: number;
    gstInPaise: number;
    totalInPaise: number;
    expiresAt: string | null;
    cancelReason: string | null;
    refundInPaise: number;
    feeRefundedInPaise: number;
    creditIssuedInPaise: number;
    referralCreditAppliedInPaise: number;
    otpCode: string | null;
    deliveryAddressJson: { flat: string; addressText: string; lat: number; lng: number } | null;
    createdAt: string;
  };
  items: { id: number; titleSnapshot: string; qty: number; unitPriceInPaise: number }[];
  events: { id: number; status: string; note: string | null; createdAt: string }[];
  review: { rating: number; text: string | null; sellerReplyText: string | null } | null;
  vendor:
    | { kind: 'seller'; name: string | null; acceptsCash?: boolean }
    | { kind: 'restaurant'; name: string; counterNumber: string; mallName?: string };
  pickup: { tower: string | null; instructions: string | null } | null;
  upi: { vpa: string; registeredName: string; payeeName: string; uri: string; qrSvg: string; amountInPaise: number } | null;
  foodPayment: { mode: string | null; status: string | null; utr: string | null; method: string | null };
  fssai: { tier: string; number: string | null } | null;
  actions: string[];
  statusLabel: string;
  timers: { acceptBy: string | null; noShowAfter: string | null; confirmBy: string | null };
  viewerIsBuyer: boolean;
};


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
    if (!data || FINISHED_STATUSES.includes(data.order.status)) return;
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

  const { order, vendor } = data;
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
        {order.status === 'booked' && data.timers.acceptBy && <Countdown to={data.timers.acceptBy} label="The kitchen has until" />}
        {data.fssai?.tier === 'provisional' && <p className="mt-2 text-xs text-turmeric-deep">FSSAI applied: provisional</p>}
        {data.fssai?.tier === 'verified' && data.fssai.number && <p className="mt-2 text-xs text-leaf">FSSAI registered · {data.fssai.number}</p>}
      </Card>

      {order.cancelReason && !COMPLETED_STATUSES.includes(order.status) && FINISHED_STATUSES.includes(order.status) && (
        <p className="mt-3 rounded-xl bg-chili-tint px-4 py-3 text-sm text-chili-dark" role="status" data-testid="cancel-banner">
          {order.cancelReason}.
          {order.feeRefundedInPaise > 0 ? ` Your platform fee of ${formatINR(order.feeRefundedInPaise)} has been refunded.` : ''}
          {order.creditIssuedInPaise > 0 ? ` We added ${formatINR(order.creditIssuedInPaise)} PadosiPlate credit for your next order.` : ''}
        </p>
      )}

      {data.viewerIsBuyer && order.type === 'home_delivery' && order.status === 'fee_pending' && (
        <FeeRetryCard orderId={order.id} amountInPaise={order.onlineChargeInPaise} expiresAt={order.expiresAt} mockMode={mockMode} onPaid={load} />
      )}

      {data.viewerIsBuyer && order.type === 'home_delivery' && vendor.kind === 'seller' && (
        <AtDoorPaymentCard
          orderId={order.id}
          status={order.status}
          paymentStatus={data.foodPayment.status}
          utr={data.foodPayment.utr}
          foodTotalInPaise={order.foodTotalInPaise}
          kitchenName={vendor.name ?? 'the kitchen'}
          acceptsCash={!!vendor.acceptsCash}
          upi={data.upi}
          onChanged={load}
        />
      )}

      {data.viewerIsBuyer && data.actions.includes('buyer_cancel') && <BuyerCancel orderId={order.id} status={order.status} onDone={load} />}

      {data.pickup && data.viewerIsBuyer && (
        <Card className="mt-4 p-4">
          <div className="eyebrow">{order.fulfillmentType === 'self_pickup' ? 'COLLECT FROM' : 'KITCHEN LOCATION'}</div>
          <p className="mt-1 text-sm">{[data.pickup.tower, data.pickup.instructions].filter(Boolean).join(' · ') || 'Details shared by the kitchen at pickup.'}</p>
        </Card>
      )}

      {/* Mall (legacy) pickup OTP */}
      {order.otpCode && order.type === 'mall_pickup' && order.status === 'ready' && data.viewerIsBuyer && (
        <Card className="mt-4 p-5">
          <div className="eyebrow">SHOW AT THE COUNTER</div>
          <div className="mt-2 flex justify-center gap-2">
            {order.otpCode.split('').map((d, i) => (
              <span key={i} className="flex h-12 w-10 items-center justify-center rounded-xl bg-leaf font-display text-xl font-bold text-white">{d}</span>
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
      {order.type === 'home_delivery' ? (
        <Card className="mt-4 p-4" data-testid="order-bill">
          <div className="eyebrow mb-3">BILL</div>
          <div className="space-y-1.5 text-sm">
            {data.items.map((i) => (
              <div key={i.id} className="flex justify-between">
                <span className="text-ink-soft">{i.titleSnapshot} × {i.qty}</span>
                <span>{formatINR(i.qty * i.unitPriceInPaise)}</span>
              </div>
            ))}
            {order.deliveryFeeInPaise > 0 && (
              <div className="flex justify-between"><span className="text-ink-soft">Delivery (kept by the kitchen)</span><span>{formatINR(order.deliveryFeeInPaise)}</span></div>
            )}
            <div className="flex justify-between border-t border-dashed border-rice-line pt-1.5 font-bold">
              <span>Food, paid to {vendor.name}</span>
              <span>{formatINR(order.foodTotalInPaise)}</span>
            </div>
            <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Platform fee · paid via Razorpay</div>
            <div className="flex justify-between"><span>Platform fee ({order.feeBpsSnapshot / 100}%)</span><span>{formatINR(order.feeBeforeCreditInPaise)}</span></div>
            {order.referralCreditAppliedInPaise > 0 && (
              <div className="flex justify-between text-leaf"><span>Referral credit</span><span>−{formatINR(order.referralCreditAppliedInPaise)}</span></div>
            )}
            {order.platformFeeGstInPaise > 0 && <div className="flex justify-between"><span>GST on platform fee</span><span>{formatINR(order.platformFeeGstInPaise)}</span></div>}
            {order.gstInPaise > 0 && <div className="flex justify-between"><span>GST on food (e-commerce operator)</span><span>{formatINR(order.gstInPaise)}</span></div>}
            <div className="flex justify-between pt-1 text-base font-bold">
              <span>Platform fee {order.status === 'fee_pending' ? 'to pay' : 'paid'}</span>
              <span>{formatINR(order.onlineChargeInPaise)}</span>
            </div>
            {order.refundInPaise > 0 && (
              <div className="flex justify-between text-leaf"><span>Platform fee refunded</span><span>−{formatINR(order.refundInPaise)}</span></div>
            )}
          </div>
          {!['fee_pending', 'expired'].includes(order.status) && (
            <Link href={`/orders/${order.id}/invoice`} className="mt-3 block text-center text-sm font-semibold text-leaf underline">
              🧾 View invoice
            </Link>
          )}
        </Card>
      ) : (
        <Card className="mt-4 p-4">
          <div className="eyebrow mb-3">BILL</div>
          <div className="space-y-1.5 text-sm">
            {data.items.map((i) => (
              <div key={i.id} className="flex justify-between"><span className="text-ink-soft">{i.titleSnapshot} × {i.qty}</span><span>{formatINR(i.qty * i.unitPriceInPaise)}</span></div>
            ))}
            <div className="flex justify-between pt-1 text-base font-bold"><span>Total paid</span><span>{formatINR(order.totalInPaise)}</span></div>
          </div>
        </Card>
      )}

      {/* anonymous messages with the kitchen */}
      {data.viewerIsBuyer && order.type === 'home_delivery' && order.status !== 'fee_pending' && (
        <OrderThread
          orderId={order.id}
          onRefund={() => document.getElementById('complaint-block')?.scrollIntoView({ behavior: 'smooth' })}
        />
      )}

      {/* review */}
      {data.viewerIsBuyer && COMPLETED_STATUSES.includes(order.status) && (
        <ReviewBlock orderId={order.id} review={data.review} onDone={load} />
      )}

      {/* complaint (DECISIONS.md #73+) */}
      {data.viewerIsBuyer && COMPLETED_STATUSES.includes(order.status) && (
        <div id="complaint-block">
          <ComplaintBlock orderId={order.id} />
        </div>
      )}

      <div className="mt-8 text-center">
        <Link href="/orders" className="text-sm font-semibold text-leaf underline">
          ← All orders
        </Link>
      </div>
    </div>
  );
}

function Countdown({ to, label }: { to: string; label: string }) {
  const [left, setLeft] = useState('');
  useEffect(() => {
    const tick = () => {
      const ms = new Date(to).getTime() - Date.now();
      setLeft(ms <= 0 ? 'any moment' : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [to]);
  return <p className="mt-2 text-xs text-ink-soft">{label} {left} to accept — otherwise your platform fee is refunded automatically.</p>;
}

function BuyerCancel({ orderId, status, onDone }: { orderId: number; status: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function cancel() {
    setBusy(true);
    const res = await fetch(`/api/orders/${orderId}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'buyer_cancel' }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not cancel', 'err');
    setOpen(false);
    toast(d.refundedFeePaise ? 'Order cancelled — platform fee refunded' : 'Order cancelled');
    onDone();
  }
  return (
    <>
      <button className="mt-4 min-h-[44px] w-full rounded-xl border border-rice-line text-sm font-semibold text-ink-soft" onClick={() => setOpen(true)} data-testid="buyer-cancel">
        Cancel order
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Cancel this order?" sheet>
        <p className="text-sm text-ink-soft" data-testid="cancel-policy">
          {status === 'booked'
            ? 'The kitchen has not accepted yet, so your platform fee will be refunded in full.'
            : 'The kitchen has already accepted your order, so the platform fee is not refunded. Frequent late cancellations can pause your ordering.'}
        </p>
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Keep order</Button>
          <Button className="flex-1" loading={busy} onClick={cancel} data-testid="confirm-buyer-cancel">Cancel order</Button>
        </div>
      </Modal>
    </>
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
    fd.append('purpose', 'complaint');
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
