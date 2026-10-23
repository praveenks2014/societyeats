'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Card, Skeleton } from '@/components/ui';
import { formatINR } from '@/lib/money';

type Invoice = {
  model: 'home' | 'mall';
  invoiceNumber: string;
  invoiceDate: string;
  isTaxInvoice: boolean;
  platform: { name: string; legalName: string; gstin: string; address: string };
  buyer: { name: string; phone: string; address: string | null };
  fulfilledBy: { label: string; sub?: string | null; fssaiNumber: string | null };
  order: {
    id: number;
    type: 'home_delivery' | 'mall_pickup';
    fulfillmentType: string;
    createdAt: string;
    subtotalInPaise: number;
    deliveryFeeInPaise: number;
    foodTotalInPaise: number;
    foodPaymentMode: string | null;
    platformFeeBeforeCreditInPaise: number;
    platformFeeInPaise: number;
    feeBps: number;
    feeGstInPaise: number;
    feeCgstInPaise: number;
    feeSgstInPaise: number;
    feeGstBps: number;
    ecoGstInPaise: number;
    ecoCgstInPaise: number;
    ecoSgstInPaise: number;
    onlineChargeInPaise: number;
    referralCreditAppliedInPaise: number;
    totalInPaise: number;
    refundInPaise: number;
  };
  items: { title: string; qty: number; unitPriceInPaise: number; amountInPaise: number }[];
};

export function InvoiceView({ orderId }: { orderId: number }) {
  const [data, setData] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/orders/${orderId}/invoice`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          setError(d.error || 'Could not load invoice');
          return;
        }
        setData(d);
      })
      .catch(() => setError('Network error'));
  }, [orderId]);

  if (error) {
    return (
      <div className="pt-16 text-center">
        <p className="text-lg font-semibold">{error}</p>
        <Link href={`/orders/${orderId}`} className="mt-3 inline-block text-sm text-leaf underline">
          ← Back to order
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-xl space-y-4 pt-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const { order } = data;

  return (
    <div className="mx-auto max-w-xl pt-6">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/orders/${orderId}`} className="text-sm font-semibold text-leaf underline">
          ← Back to order
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          🖨 Print / Save as PDF
        </Button>
      </div>

      <Card className="p-6 print:border-0 print:shadow-none">
        {/* letterhead */}
        <div className="flex items-start justify-between gap-4 border-b border-dashed border-rice-line pb-4">
          <div>
            <div className="font-display text-xl font-bold text-leaf">{data.platform.name}</div>
            <div className="mt-0.5 text-xs text-ink-faint">{data.platform.legalName}</div>
            <div className="mt-0.5 text-xs text-ink-faint">{data.platform.address}</div>
            <div className="mt-0.5 text-xs text-ink-faint">GSTIN: {data.platform.gstin}</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold uppercase tracking-wide">
              {data.isTaxInvoice ? 'Tax Invoice' : 'Bill'}
            </div>
            <div className="mt-0.5 text-xs text-ink-faint">{data.invoiceNumber}</div>
            <div className="text-xs text-ink-faint">
              {new Date(data.invoiceDate).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </div>
          </div>
        </div>

        {/* parties */}
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="eyebrow mb-1">BILLED TO</div>
            <div className="font-semibold">{data.buyer.name}</div>
            <div className="text-ink-soft">{data.buyer.phone}</div>
            {data.buyer.address && <div className="text-ink-soft">{data.buyer.address}</div>}
          </div>
          <div>
            <div className="eyebrow mb-1">FULFILLED BY</div>
            <div className="font-semibold">{data.fulfilledBy.label}</div>
            {data.fulfilledBy.sub && <div className="text-ink-soft">{data.fulfilledBy.sub}</div>}
            {data.fulfilledBy.fssaiNumber && (
              <div className="text-ink-soft">FSSAI: {data.fulfilledBy.fssaiNumber}</div>
            )}
          </div>
        </div>

        {data.model === 'home' ? (
          <>
            <p className="mt-3 rounded-xl bg-rice px-3 py-2 text-xs text-ink-faint">
              Order #{order.id}. This invoice is for {data.platform.name}&apos;s own service only — the platform fee. The food was
              sold by <strong>{data.fulfilledBy.label}</strong> and paid to them directly
              {order.foodPaymentMode === 'upi_now' ? ' by UPI' : order.foodPaymentMode === 'pay_at_pickup' ? ' at pickup' : ''}; it is not part of this invoice.
            </p>
            <div className="mt-4 ml-auto max-w-[320px] space-y-1 text-sm" data-testid="invoice-lines">
              <div className="flex justify-between">
                <span className="text-ink-soft">Platform fee ({order.feeBps / 100}% of food)</span>
                <span>{formatINR(order.platformFeeBeforeCreditInPaise)}</span>
              </div>
              {order.referralCreditAppliedInPaise > 0 && (
                <div className="flex justify-between">
                  <span className="text-ink-soft">Referral credit</span>
                  <span>−{formatINR(order.referralCreditAppliedInPaise)}</span>
                </div>
              )}
              {order.feeGstInPaise > 0 && (
                <>
                  <div className="flex justify-between"><span className="text-ink-soft">CGST @ {order.feeGstBps / 200}%</span><span>{formatINR(order.feeCgstInPaise)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">SGST @ {order.feeGstBps / 200}%</span><span>{formatINR(order.feeSgstInPaise)}</span></div>
                </>
              )}
              {order.ecoGstInPaise > 0 && (
                <>
                  <div className="flex justify-between"><span className="text-ink-soft">CGST on food (e-commerce operator)</span><span>{formatINR(order.ecoCgstInPaise)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">SGST on food (e-commerce operator)</span><span>{formatINR(order.ecoSgstInPaise)}</span></div>
                </>
              )}
              <div className="flex justify-between border-t border-rice-line pt-1.5 text-base font-bold">
                <span>Paid to {data.platform.name}</span>
                <span>{formatINR(order.onlineChargeInPaise)}</span>
              </div>
              {order.refundInPaise > 0 && (
                <div className="flex justify-between text-leaf"><span>Refunded</span><span>−{formatINR(order.refundInPaise)}</span></div>
              )}
            </div>
            <div className="mt-5 rounded-xl border border-dashed border-rice-line px-3 py-2 text-sm">
              <div className="eyebrow mb-1">FOOD — PAID DIRECTLY TO {data.fulfilledBy.label.toUpperCase()}</div>
              {data.items.map((i, idx) => (
                <div key={idx} className="flex justify-between text-ink-soft"><span>{i.title} × {i.qty}</span><span>{formatINR(i.amountInPaise)}</span></div>
              ))}
              {order.deliveryFeeInPaise > 0 && <div className="flex justify-between text-ink-soft"><span>Delivery (kept by the kitchen)</span><span>{formatINR(order.deliveryFeeInPaise)}</span></div>}
              <div className="mt-1 flex justify-between border-t border-rice-line pt-1 font-semibold"><span>Food total</span><span>{formatINR(order.foodTotalInPaise)}</span></div>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 rounded-xl bg-rice px-3 py-2 text-xs text-ink-faint">Order #{order.id} · counter pickup.</p>
            <div className="mt-4 ml-auto max-w-[280px] space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span>{formatINR(order.subtotalInPaise)}</span></div>
              <div className="flex justify-between border-t border-rice-line pt-1.5 text-base font-bold"><span>Total</span><span>{formatINR(order.totalInPaise)}</span></div>
            </div>
          </>
        )}

        {/* guidance footnote */}
        <p className="mt-6 border-t border-dashed border-rice-line pt-3 text-[11px] leading-relaxed text-ink-faint">
          {data.isTaxInvoice
            ? 'GST is shown as CGST/SGST assuming an intra-state supply — guidance for your records, not a filed tax determination.'
            : 'No GST was charged on this platform fee.'}{' '}
          {data.platform.gstin.includes('PENDING') && 'GSTIN not yet registered. '}Draft — to be reviewed by a CA before launch.
        </p>
      </Card>
    </div>
  );
}
