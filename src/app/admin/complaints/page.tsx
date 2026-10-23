'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type ComplaintRow = {
  id: number;
  orderId: number;
  category: 'quality' | 'wrong_item' | 'hygiene' | 'not_received';
  description: string;
  photoUrl: string | null;
  status: 'open' | 'resolved';
  outcome: 'full_refund' | 'partial_refund' | 'warning' | 'seller_paused' | 'rejected' | null;
  refundInPaise: number;
  resolutionNote: string | null;
  buyerName: string;
  buyerPhone: string;
  kitchenName: string | null;
  orderTotalInPaise: number;
  foodTotalInPaise: number;
  foodPaymentMode: string | null;
  foodPaymentStatus: string | null;
  feeRefundableInPaise: number;
  platformFeeRefundInPaise: number;
  foodRefundDueInPaise: number;
  raisedBy: string;
  createdAt: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  quality: 'Food quality',
  wrong_item: 'Wrong item',
  hygiene: 'Hygiene',
  not_received: 'Never received',
};

const OUTCOME_BADGE: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  full_refund: { label: 'Full refund', tone: 'green' },
  partial_refund: { label: 'Partial refund', tone: 'amber' },
  warning: { label: 'Warning issued', tone: 'amber' },
  seller_paused: { label: 'Seller paused', tone: 'red' },
  rejected: { label: 'Rejected', tone: 'neutral' },
};

export default function AdminComplaints() {
  const [rows, setRows] = useState<ComplaintRow[] | null>(null);
  const [feeInputs, setFeeInputs] = useState<Record<number, string>>({});
  const [foodInputs, setFoodInputs] = useState<Record<number, string>>({});
  const [noteInputs, setNoteInputs] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useToast();

  function load() {
    fetch('/api/admin/complaints')
      .then((r) => r.json())
      .then((d) => setRows(d.complaints))
      .catch(() => {});
  }
  useEffect(load, []);

  async function resolve(id: number, outcome: string, platformFeeRefundInPaise?: number, foodRefundDueInPaise?: number) {
    setBusyId(id);
    const res = await fetch(`/api/admin/complaints/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome, platformFeeRefundInPaise, foodRefundDueInPaise, note: noteInputs[id] }),
    });
    const d = await res.json();
    setBusyId(null);
    if (!res.ok) {
      toast(d.error || 'Could not resolve', 'err');
      return;
    }
    toast(`Resolved: ${d.outcomeLabel} ✅`);
    load();
  }

  if (!rows) return <Skeleton className="h-64 w-full" />;
  const open = rows.filter((r) => r.status === 'open');
  const resolved = rows.filter((r) => r.status === 'resolved');

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Complaints</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Buyers can report an issue within 24h of delivery/pickup. The <strong>platform fee</strong> is refunded by
        PadosiPlate through Razorpay. The <strong>food amount</strong> was paid straight to the kitchen, so the kitchen
        owes it — it becomes a “kitchen refund due” (see Refunds). Three upheld hygiene complaints auto-delist the kitchen.
      </p>

      {open.length === 0 ? (
        <EmptyState emoji="✅" title="No open complaints" />
      ) : (
        <div className="mt-5 space-y-4">
          {open.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">
                    {c.kitchenName ?? 'Kitchen'} <span className="text-xs font-normal text-ink-faint">Order #{c.orderId}</span>
                  </div>
                  <div className="text-xs text-ink-faint">
                    {c.buyerName} · {c.buyerPhone} · {new Date(c.createdAt).toLocaleString('en-IN')}
                  </div>
                </div>
                <Badge tone={c.category === 'hygiene' ? 'red' : 'amber'}>{CATEGORY_LABEL[c.category]}</Badge>
              </div>
              <p className="mt-2 text-sm text-ink-soft">{c.description}</p>
              {c.photoUrl && (
                <a href={c.photoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                  <FoodImage src={c.photoUrl} alt="Complaint evidence" className="h-24 w-24 rounded-xl" />
                </a>
              )}
              <Link href={`/orders/${c.orderId}`} className="mt-2 block text-xs font-semibold text-leaf underline">
                View order (food {formatINR(c.foodTotalInPaise)} paid to kitchen · {formatINR(c.feeRefundableInPaise)} platform fee refundable) →
              </Link>

              <Input
                className="mt-3"
                placeholder="Resolution note (optional, shown internally)"
                value={noteInputs[c.id] ?? ''}
                onChange={(e) => setNoteInputs((p) => ({ ...p, [c.id]: e.target.value }))}
              />

              {c.raisedBy === 'seller' && <p className="mt-2 text-xs text-turmeric-deep">Raised by the kitchen: UPI payment not received (food {c.foodPaymentStatus}).</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" loading={busyId === c.id} onClick={() => resolve(c.id, 'full_refund')}>
                  Full refund (fee + food due)
                </Button>
                <Input className="w-24" inputMode="numeric" placeholder="₹ fee" aria-label="Platform fee refund in rupees" value={feeInputs[c.id] ?? ''} onChange={(e) => setFeeInputs((p) => ({ ...p, [c.id]: e.target.value.replace(/\D/g, '') }))} />
                <Input className="w-24" inputMode="numeric" placeholder="₹ food" aria-label="Kitchen food refund in rupees" value={foodInputs[c.id] ?? ''} onChange={(e) => setFoodInputs((p) => ({ ...p, [c.id]: e.target.value.replace(/\D/g, '') }))} />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!(feeInputs[c.id] ?? '').trim() && !(foodInputs[c.id] ?? '').trim()}
                  loading={busyId === c.id}
                  onClick={() => resolve(c.id, 'partial_refund', Number(feeInputs[c.id] || 0) * 100, Number(foodInputs[c.id] || 0) * 100)}
                >
                  Partial refund
                </Button>
                <Button size="sm" variant="secondary" loading={busyId === c.id} onClick={() => resolve(c.id, 'warning')}>
                  Warn kitchen
                </Button>
                <Button size="sm" variant="danger" loading={busyId === c.id} onClick={() => resolve(c.id, 'seller_paused')}>
                  Delist kitchen
                </Button>
                <Button size="sm" variant="ghost" loading={busyId === c.id} onClick={() => resolve(c.id, 'rejected')}>
                  Reject
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-bold">Resolved</h2>
          <div className="mt-3 space-y-2">
            {resolved.map((c) => {
              const badge = c.outcome ? OUTCOME_BADGE[c.outcome] : { label: c.outcome ?? '—', tone: 'neutral' as const };
              return (
                <Card key={c.id} className="p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {c.kitchenName ?? 'Kitchen'} · Order #{c.orderId} · {CATEGORY_LABEL[c.category]}
                    </span>
                    <div className="flex items-center gap-2">
                      {c.platformFeeRefundInPaise > 0 && <span className="text-xs text-ink-faint">{formatINR(c.platformFeeRefundInPaise)} fee refunded</span>}
                      {c.foodRefundDueInPaise > 0 && <span className="text-xs text-ink-faint">{formatINR(c.foodRefundDueInPaise)} due from kitchen</span>}
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
