'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Card, Skeleton } from '@/components/ui';
import { formatINR } from '@/lib/money';

type Invoice = {
  invoiceNumber: string;
  invoiceDate: string;
  isTaxInvoice: boolean;
  platform: { name: string; gstin: string; address: string };
  buyer: { name: string; phone: string; address: string | null };
  fulfilledBy: { label: string; sub?: string | null; fssaiNumber: string | null };
  order: {
    id: number;
    type: 'home_delivery' | 'mall_pickup';
    fulfillmentType: string;
    createdAt: string;
    subtotalInPaise: number;
    deliveryFeeInPaise: number;
    platformFeeInPaise: number;
    gstInPaise: number;
    cgstInPaise: number;
    sgstInPaise: number;
    totalInPaise: number;
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

        <p className="mt-3 rounded-xl bg-rice px-3 py-2 text-xs text-ink-faint">
          Order #{order.id} · placed{' '}
          {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.{' '}
          {data.isTaxInvoice
            ? `${data.platform.name} is the deemed supplier of this order under Sec 9(5) CGST — this invoice is issued by the platform, not the kitchen.`
            : "This order carries no platform-collected GST — see the guidance note below."}
        </p>

        {/* line items */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rice-line text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="py-1.5">Item</th>
                <th className="py-1.5 text-right">Qty</th>
                <th className="py-1.5 text-right">Rate</th>
                <th className="py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i, idx) => (
                <tr key={idx} className="border-b border-rice-line last:border-0">
                  <td className="py-1.5">{i.title}</td>
                  <td className="py-1.5 text-right">{i.qty}</td>
                  <td className="py-1.5 text-right">{formatINR(i.unitPriceInPaise)}</td>
                  <td className="py-1.5 text-right">{formatINR(i.amountInPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* totals */}
        <div className="mt-4 ml-auto max-w-[280px] space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-soft">Subtotal</span>
            <span>{formatINR(order.subtotalInPaise)}</span>
          </div>
          {order.deliveryFeeInPaise > 0 && (
            <div className="flex justify-between">
              <span className="text-ink-soft">Delivery fee</span>
              <span>{formatINR(order.deliveryFeeInPaise)}</span>
            </div>
          )}
          {order.platformFeeInPaise > 0 && (
            <div className="flex justify-between">
              <span className="text-ink-soft">Platform fee</span>
              <span>{formatINR(order.platformFeeInPaise)}</span>
            </div>
          )}
          {data.isTaxInvoice && (
            <>
              <div className="flex justify-between">
                <span className="text-ink-soft">CGST @ 2.5%</span>
                <span>{formatINR(order.cgstInPaise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-soft">SGST @ 2.5%</span>
                <span>{formatINR(order.sgstInPaise)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between border-t border-rice-line pt-1.5 text-base font-bold">
            <span>Total</span>
            <span>{formatINR(order.totalInPaise)}</span>
          </div>
        </div>

        {/* guidance footnote */}
        <p className="mt-6 border-t border-dashed border-rice-line pt-3 text-[11px] leading-relaxed text-ink-faint">
          {data.isTaxInvoice
            ? 'GST is charged at 5% on the food value and split evenly as CGST/SGST assuming an intra-state supply within this pilot society — this is guidance for your records, not a filed tax determination. Verify treatment (including any inter-state scenario) with your CA.'
            : 'This order did not attract platform-collected GST. Verify your own tax position with your CA — this document is guidance only.'}{' '}
          {data.platform.gstin.includes('PENDING') &&
            'The GSTIN shown above is a placeholder pending registration and must not be treated as final.'}
        </p>
      </Card>
    </div>
  );
}
