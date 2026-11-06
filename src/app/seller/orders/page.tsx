'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Skeleton, Textarea } from '@/components/ui';
import { FINISHED_STATUSES, StatusPill } from '@/components/order-status';
import { OrderThread } from '@/components/order-extras';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type FulfillmentType = 'self_pickup' | 'seller_delivery' | 'platform_delivery';

const FULFILLMENT_META: Record<FulfillmentType, { emoji: string; label: string }> = {
  self_pickup: { emoji: '🏠', label: 'Buyer collects' },
  seller_delivery: { emoji: '🛵', label: 'You deliver to the door' },
  platform_delivery: { emoji: '📦', label: 'Delivery partner' },
};

type SellerOrder = {
  id: number;
  status: string;
  fulfillmentType: FulfillmentType;
  subtotalInPaise: number;
  foodTotalInPaise: number;
  foodPaymentStatus: string | null;
  foodPaymentUtr: string | null;
  foodPaymentMethod: string | null;
  acceptBy: string | null;
  atDoorAt: string | null;
  createdAt: string;
  buyerName: string;
  buyerNote: string | null;
  deliveryAddressJson: { flat: string; societyName: string } | null;
  items: { id: number; titleSnapshot: string; qty: number }[];
  actions: string[];
};

const LABEL: Record<string, string> = {
  accept: 'Accept',
  preparing: 'Start cooking',
  ready: 'Mark ready',
  on_the_way: 'On the way',
  reached_door: 'Reached your door',
  buyer_arrived: 'Buyer has arrived',
  confirm_paid: 'Payment received',
  not_received: 'Not received',
  raise_dispute: 'Raise a payment dispute',
  buyer_couldnt_pay: 'Buyer couldn’t pay',
  no_show: 'Buyer not at the door',
  seller_cancel: 'Cancel order',
};
const PRIMARY = ['accept', 'preparing', 'ready', 'on_the_way', 'reached_door', 'buyer_arrived', 'confirm_paid'];
const NEEDS_REASON = ['seller_cancel', 'not_received', 'raise_dispute', 'no_show'];
const NEEDS_ACTION = ['booked', 'paid', 'payment_claimed', 'at_door', 'collected', 'payment_disputed'];

export default function SellerOrders() {
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [unread, setUnread] = useState<Record<number, number>>({});
  const toast = useToast();

  const load = useCallback(() => {
    fetch('/api/seller/orders')
      .then((r) => r.json())
      .then((d) => setOrders(d.orders))
      .catch(() => {});
    fetch('/api/chat/unread')
      .then((r) => (r.ok ? r.json() : { byOrder: {} }))
      .then((d) => setUnread(d.byOrder ?? {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  if (!orders) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const needsAction = orders.filter((o) => NEEDS_ACTION.includes(o.status));
  const inProgress = orders.filter((o) => !NEEDS_ACTION.includes(o.status) && !FINISHED_STATUSES.includes(o.status));
  const past = orders.filter((o) => FINISHED_STATUSES.includes(o.status));

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-bold">
          Needs action {needsAction.length > 0 && <Badge tone="red">{needsAction.length}</Badge>}
        </h2>
        {needsAction.length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing waiting — new booked orders appear here.</p>
        ) : (
          <div className="space-y-3">
            {needsAction.map((o) => (
              <OrderCard key={o.id} order={o} onReload={load} toast={toast} unread={unread[o.id] ?? 0} />
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
              <OrderCard key={o.id} order={o} onReload={load} toast={toast} unread={unread[o.id] ?? 0} />
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
              <OrderCard key={o.id} order={o} onReload={load} toast={toast} unread={unread[o.id] ?? 0} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OrderCard({ order, onReload, toast, unread = 0 }: { order: SellerOrder; onReload: () => void; toast: (t: string, k?: 'ok' | 'err') => void; unread?: number }) {
  const fMeta = FULFILLMENT_META[order.fulfillmentType];
  const [chat, setChat] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function act(action: string, why?: string) {
    setBusy(action);
    const res = await fetch(`/api/orders/${order.id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason: why }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return toast(d.error || 'Could not update', 'err');
    setReasonFor(null);
    setReason('');
    if (action === 'seller_cancel') toast(d.refundedFeePaise ? 'Order cancelled — the buyer’s fee was refunded and they got credit' : 'Order cancelled');
    else if (action === 'confirm_paid') toast('Payment confirmed ✅');
    else toast(`${LABEL[action] ?? 'Updated'} ✅`);
    onReload();
  }

  const finished = FINISHED_STATUSES.includes(order.status);
  const primary = order.actions.filter((a) => PRIMARY.includes(a));
  const secondary = order.actions.filter((a) => !PRIMARY.includes(a) && a !== 'seller_cancel');
  const canCancel = order.actions.includes('seller_cancel');

  return (
    <Card className="p-4" data-testid={`seller-order-${order.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">#{order.id} · {order.buyerName}</span>
        <StatusPill status={order.status} />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-leaf">
        <span>{fMeta.emoji}</span>
        <span>{fMeta.label}</span>
      </div>
      <div className="mt-1.5 text-sm text-ink-soft">{order.items.map((i) => `${i.titleSnapshot} ×${i.qty}`).join(', ')}</div>
      {order.deliveryAddressJson && <div className="mt-1 text-xs text-ink-faint" data-testid="order-address">📍 {order.deliveryAddressJson.flat}, {order.deliveryAddressJson.societyName}</div>}
      {order.buyerNote && <div className="mt-1 text-xs text-ink-soft">“{order.buyerNote}”</div>}
      <div className="mt-2 text-sm">
        Collect <strong>{formatINR(order.foodTotalInPaise || order.subtotalInPaise)}</strong>{' '}
        <span className="text-xs text-ink-faint">· paid to you at the door, by UPI to your verified ID</span>
      </div>

      {order.status === 'booked' && order.acceptBy && (
        <div className="mt-2 text-xs text-ink-faint">Accept by {new Date(order.acceptBy).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} or it auto-cancels, the buyer’s fee is refunded and you get a strike.</div>
      )}
      {order.status === 'at_door' && <div className="mt-2 rounded-xl bg-rice px-3 py-2 text-sm">Waiting at the door. The buyer sees your QR now and pays after collecting the food.</div>}
      {order.status === 'collected' && <div className="mt-2 rounded-xl bg-rice px-3 py-2 text-sm">Buyer has the food and is paying you.</div>}
      {order.status === 'payment_claimed' && (
        <div className="mt-2 rounded-xl bg-rice px-3 py-2 text-sm" data-testid="seller-food-payment">
          Buyer says they paid {order.foodPaymentMethod === 'cash' ? 'in cash' : 'by UPI'}{order.foodPaymentUtr ? <> (UTR <strong>{order.foodPaymentUtr}</strong>)</> : ''}. Check your UPI app.
        </div>
      )}
      {order.status === 'payment_disputed' && <div className="mt-2 rounded-xl bg-chili-tint px-3 py-2 text-sm text-chili-dark">Payment dispute open — PadosiPlate is reviewing.</div>}

      {!finished && order.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {primary.map((a) => (
            <Button key={a} size="sm" loading={busy === a} disabled={!!busy} onClick={() => act(a)} data-testid={`act-${a}`}>
              {LABEL[a]}
            </Button>
          ))}
          {secondary.map((a) => (
            <Button key={a} size="sm" variant="secondary" disabled={!!busy} onClick={() => (NEEDS_REASON.includes(a) ? setReasonFor(a) : act(a))} data-testid={`act-${a}`}>
              {LABEL[a]}
            </Button>
          ))}
          {canCancel && (
            <Button size="sm" variant="danger" disabled={!!busy} onClick={() => setReasonFor('seller_cancel')} data-testid="act-seller_cancel">
              {order.status === 'booked' ? 'Decline & refund fee' : 'Cancel order'}
            </Button>
          )}
        </div>
      )}

      {!finished && (
        <div className="mt-2">
          <button className="min-h-[44px] text-xs font-semibold text-leaf underline" onClick={() => setChat((c) => !c)}>
            {chat ? 'Hide messages' : `💬 Message buyer${unread > 0 ? ` (${unread} new)` : ''}`}
          </button>
          {chat && <OrderThread orderId={order.id} />}
        </div>
      )}

      <Modal open={!!reasonFor} onClose={() => setReasonFor(null)} title={reasonFor ? LABEL[reasonFor] : ''} sheet>
        <div className="space-y-3">
          {reasonFor === 'seller_cancel' && (
            <p className="text-sm text-ink-soft" data-testid="seller-cancel-policy">
              {order.status === 'booked'
                ? 'The buyer’s platform fee is refunded in full and they get the same amount as credit.'
                : 'The buyer’s platform fee is refunded in full, they get the same amount as credit, and you get a strike. Three strikes in 30 days pause your kitchen.'}
            </p>
          )}
          <Field label="Reason (the buyer will see it)">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reason-input" />
          </Field>
          <Button className="w-full" loading={!!busy} disabled={reason.trim().length < 3} onClick={() => reasonFor && act(reasonFor, reason.trim())} data-testid="confirm-reason">
            Confirm
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
