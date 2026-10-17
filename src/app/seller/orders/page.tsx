'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '@/components/ui';
import { StatusPill } from '@/components/order-status';
import { OrderThread } from '@/components/order-extras';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type FulfillmentType = 'self_pickup' | 'seller_delivery' | 'platform_delivery';

const FULFILLMENT_META: Record<FulfillmentType, { emoji: string; label: string }> = {
  self_pickup: { emoji: '🏠', label: 'Self pickup' },
  seller_delivery: { emoji: '🛵', label: 'You deliver' },
  platform_delivery: { emoji: '📦', label: 'Delivery partner' },
};

type SellerOrder = {
  id: number;
  status: string;
  fulfillmentType: FulfillmentType;
  subtotalInPaise: number;
  foodTotalInPaise: number;
  foodPaymentMode: 'upi_now' | 'pay_at_pickup' | null;
  foodPaymentStatus: string | null;
  foodPaymentUtr: string | null;
  acceptBy: string | null;
  createdAt: string;
  buyerName: string;
  deliveryAddressJson: { flat: string; societyName: string } | null;
  items: { id: number; titleSnapshot: string; qty: number }[];
  delivery: { provider: string; riderName: string | null; status: string } | null;
};

const NEEDS_ACTION = ['fee_paid', 'awaiting_kitchen_payment_confirmation', 'paid'];
const IN_PROGRESS = ['accepted', 'preparing', 'ready', 'out_for_delivery', 'delivery_unassigned'];

export default function SellerOrders() {
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    fetch('/api/seller/orders')
      .then((r) => r.json())
      .then((d) => setOrders(d.orders))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: number, action: string) {
    setBusyId(id);
    const res = await fetch(`/api/orders/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const d = await res.json();
    setBusyId(null);
    if (!res.ok) {
      toast(d.error || 'Could not update', 'err');
      return;
    }
    if (action === 'reject') {
      toast(d.refunded ? 'Order declined — the buyer’s platform fee was refunded' : 'Order declined — refund is being processed');
    } else if (action === 'ready' && d.order.status === 'delivery_unassigned') {
      toast('All riders busy — admin alerted, will retry', 'err');
    } else if (action === 'ready' && d.order.fulfillmentType === 'platform_delivery') {
      toast('Rider assigned! 🛵');
    } else if (action === 'ready') {
      toast('Marked ready ✅');
    } else if (action === 'out_for_delivery') {
      toast("Buyer notified you're on the way 🛵");
    }
    load();
  }

  if (!orders) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const needsAction = orders.filter((o) => NEEDS_ACTION.includes(o.status));
  const inProgress = orders.filter((o) => IN_PROGRESS.includes(o.status));
  const past = orders.filter((o) => !NEEDS_ACTION.includes(o.status) && !IN_PROGRESS.includes(o.status) && o.status !== 'placed');

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-bold">
          Needs action{' '}
          {needsAction.length > 0 && <Badge tone="red">{needsAction.length}</Badge>}
        </h2>
        {needsAction.length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing waiting — new paid orders appear here.</p>
        ) : (
          <div className="space-y-3">
            {needsAction.map((o) => (
              <OrderCard key={o.id} order={o} busy={busyId === o.id} onReload={load}>
                <Button size="sm" loading={busyId === o.id} onClick={() => act(o.id, 'accept')}>
                  Accept
                </Button>
                <Button size="sm" variant="danger" disabled={busyId === o.id} onClick={() => act(o.id, 'reject')}>
                  Reject &amp; refund fee
                </Button>
              </OrderCard>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">In progress</h2>
        {inProgress.length === 0 ? (
          <p className="text-sm text-ink-faint">No orders being cooked right now.</p>
        ) : (
          <div className="space-y-3">
            {inProgress.map((o) => (
              <OrderCard key={o.id} order={o} busy={busyId === o.id} onReload={load}>
                {o.status === 'accepted' && (
                  <Button size="sm" loading={busyId === o.id} onClick={() => act(o.id, 'preparing')}>
                    Start cooking
                  </Button>
                )}
                {o.status === 'preparing' && (
                  <Button size="sm" loading={busyId === o.id} onClick={() => act(o.id, 'ready')}>
                    {o.fulfillmentType === 'platform_delivery' ? 'Mark ready → find rider' : 'Mark ready'}
                  </Button>
                )}
                {o.status === 'ready' && o.fulfillmentType === 'self_pickup' && (
                  <HandoverEntry order={o} label="Collected" onDone={load} />
                )}
                {o.status === 'ready' && o.fulfillmentType === 'seller_delivery' && (
                  <Button size="sm" loading={busyId === o.id} onClick={() => act(o.id, 'out_for_delivery')}>
                    Out for delivery
                  </Button>
                )}
                {o.status === 'out_for_delivery' && o.fulfillmentType === 'seller_delivery' && (
                  <HandoverEntry order={o} label="Delivered" onDone={load} />
                )}
                {o.delivery && o.fulfillmentType === 'platform_delivery' && ['ready', 'out_for_delivery'].includes(o.status) && (
                  <span className="text-xs text-ink-soft">
                    🛵 {o.delivery.riderName ?? 'Assigning…'} · <span className="capitalize">{o.delivery.provider}</span>
                  </span>
                )}
              </OrderCard>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Past orders</h2>
        {past.length === 0 ? (
          <EmptyState emoji="📦" title="No past orders yet" />
        ) : (
          <div className="space-y-3">
            {past.slice(0, 10).map((o) => (
              <OrderCard key={o.id} order={o} busy={false} onReload={load} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OrderCard({
  order,
  busy,
  children,
  onReload,
}: {
  order: SellerOrder;
  busy: boolean;
  children?: React.ReactNode;
  onReload: () => void;
}) {
  const fMeta = FULFILLMENT_META[order.fulfillmentType];
  const [chat, setChat] = useState(false);
  const toast = useToast();
  const [payBusy, setPayBusy] = useState(false);

  async function food(action: 'confirm' | 'not_received' | 'paid_at_handover') {
    setPayBusy(true);
    const res = await fetch(`/api/orders/${order.id}/food-payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    const d = await res.json().catch(() => ({}));
    setPayBusy(false);
    if (!res.ok) return toast(d.error || 'Could not update', 'err');
    toast(action === 'confirm' ? 'Payment confirmed ✅' : action === 'not_received' ? 'Reported — admin will look into it' : 'Recorded ✅');
    onReload();
  }

  const open = !['cancelled', 'expired'].includes(order.status);
  return (
    <Card className={`p-4 ${busy ? 'opacity-70' : ''}`} data-testid={`seller-order-${order.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">#{order.id} · {order.buyerName}</span>
        <StatusPill status={order.status} />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-leaf">
        <span>{fMeta.emoji}</span>
        <span>{fMeta.label}</span>
      </div>
      <div className="mt-1.5 text-sm text-ink-soft">{order.items.map((i) => `${i.titleSnapshot} ×${i.qty}`).join(', ')}</div>
      {order.deliveryAddressJson && (
        <div className="mt-1 text-xs text-ink-faint">📍 {order.deliveryAddressJson.flat}, {order.deliveryAddressJson.societyName}</div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          Collect <strong>{formatINR(order.foodTotalInPaise || order.subtotalInPaise)}</strong>{' '}
          <span className="text-xs text-ink-faint">
            {order.foodPaymentMode === 'upi_now' ? '· by UPI to your ID' : order.foodPaymentMode === 'pay_at_pickup' ? '· at handover (UPI/cash)' : ''}
          </span>
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
      </div>

      {order.foodPaymentMode === 'upi_now' && order.foodPaymentStatus && open && (
        <div className="mt-3 rounded-xl bg-rice px-3 py-2 text-sm" data-testid="seller-food-payment">
          {order.foodPaymentStatus === 'pending' && <span className="text-ink-soft">Waiting for the buyer to pay you by UPI…</span>}
          {order.foodPaymentStatus === 'buyer_claimed' && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Buyer says they paid{order.foodPaymentUtr ? <> (UTR <strong>{order.foodPaymentUtr}</strong>)</> : ''}. Check your UPI app.</span>
              <span className="flex gap-2">
                <Button size="sm" loading={payBusy} onClick={() => food('confirm')} data-testid="payment-received">Payment received</Button>
                <Button size="sm" variant="secondary" disabled={payBusy} onClick={() => food('not_received')}>Not received</Button>
              </span>
            </div>
          )}
          {order.foodPaymentStatus === 'confirmed' && <span className="text-leaf">✅ UPI payment confirmed</span>}
          {order.foodPaymentStatus === 'not_received' && <span className="text-chili-dark">Reported as not received — admin is reviewing</span>}
        </div>
      )}
      {order.acceptBy && ['fee_paid', 'awaiting_kitchen_payment_confirmation'].includes(order.status) && (
        <div className="mt-2 text-xs text-ink-faint">Accept by {new Date(order.acceptBy).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} or it auto-cancels and the buyer’s fee is refunded.</div>
      )}
      {order.foodPaymentMode === 'pay_at_pickup' && ['ready', 'out_for_delivery'].includes(order.status) && order.foodPaymentStatus !== 'at_handover' && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-rice px-3 py-2 text-sm">
          <span>Collect {formatINR(order.foodTotalInPaise)} at handover, then record it:</span>
          <Button size="sm" loading={payBusy} onClick={() => food('paid_at_handover')} data-testid="paid-at-handover">Paid at handover</Button>
        </div>
      )}
      {open && (
        <div className="mt-2">
          <button className="min-h-[36px] text-xs font-semibold text-leaf underline" onClick={() => setChat((c) => !c)}>
            {chat ? 'Hide messages' : '💬 Message buyer'}
          </button>
          {chat && <OrderThread orderId={order.id} />}
        </div>
      )}
    </Card>
  );
}

/** Pay-at-pickup orders need "paid at handover" recorded before the OTP; UPI orders need the payment confirmed. */
function HandoverEntry({ order, label, onDone }: { order: SellerOrder; label: string; onDone: () => void }) {
  const blocked =
    (order.foodPaymentMode === 'pay_at_pickup' && order.foodPaymentStatus !== 'at_handover') ||
    (order.foodPaymentMode === 'upi_now' && order.foodPaymentStatus !== 'confirmed');
  if (blocked) {
    return <span className="text-xs text-ink-faint">{order.foodPaymentMode === 'upi_now' ? 'Confirm the UPI payment first' : 'Record payment at handover first'}</span>;
  }
  return <SellerOtpEntry orderId={order.id} label={label} onDone={onDone} />;
}

/** Seller enters the buyer's 4-digit OTP at pickup/handover — same endpoint the buyer's mock rider screen uses. */
function SellerOtpEntry({
  orderId,
  label,
  onDone,
}: {
  orderId: number;
  label: string;
  onDone: () => void;
}) {
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
    toast(`${label} ✅`);
    onDone();
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        inputMode="numeric"
        maxLength={4}
        placeholder="Buyer's OTP"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
        className="!h-9 w-24 !py-1 text-sm"
      />
      <Button size="sm" onClick={submit} loading={busy} disabled={otp.length !== 4}>
        {label}
      </Button>
    </div>
  );
}
