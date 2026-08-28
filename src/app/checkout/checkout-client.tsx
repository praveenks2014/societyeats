'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Field, Input, Skeleton } from '@/components/ui';
import { MockCheckoutSheet } from '@/components/mock-checkout';
import { useCart, useLocation, useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';
import { formatDistance } from '@/lib/geo';

type QuoteResp =
  | { withinRange: false; distanceKm: number; radiusKm: number }
  | {
      withinRange: true;
      distanceKm: number;
      deliveryFeeInPaise: number;
      etaMins: number;
      platformFeePaise: number;
    };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export function CheckoutClient({ mockMode }: { mockMode: boolean }) {
  const { vendor, items, subtotalPaise, clear } = useCart();
  const { loc, openPicker } = useLocation();
  const toast = useToast();
  const router = useRouter();

  const isDelivery = vendor?.kind === 'seller';
  const [flat, setFlat] = useState('');
  const [addressText, setAddressText] = useState('');
  const [quote, setQuote] = useState<QuoteResp | null>(null);
  const [placing, setPlacing] = useState(false);
  const [mockSheet, setMockSheet] = useState<{ orderId: number; amount: number } | null>(null);

  useEffect(() => {
    if (loc && !addressText) setAddressText(loc.label);
  }, [loc, addressText]);

  useEffect(() => {
    if (!isDelivery || !vendor || !loc) return;
    setQuote(null);
    fetch(`/api/quote?sellerId=${vendor.id}&lat=${loc.lat}&lng=${loc.lng}`)
      .then((r) => r.json())
      .then(setQuote)
      .catch(() => {});
  }, [isDelivery, vendor, loc]);

  if (items.length === 0 && !mockSheet) {
    return (
      <EmptyState
        emoji="🧺"
        title="Nothing to check out"
        action={
          <Link href="/">
            <Button>Browse food</Button>
          </Link>
        }
      />
    );
  }

  const deliveryFee = quote && quote.withinRange ? quote.deliveryFeeInPaise : 0;
  const platformFee = quote && quote.withinRange ? quote.platformFeePaise : 0;
  const total = subtotalPaise + (isDelivery ? deliveryFee + platformFee : 0);
  const outOfRange = isDelivery && quote != null && !quote.withinRange;

  async function placeOrder() {
    if (!vendor) return;
    if (isDelivery && (!loc || !flat.trim())) {
      toast(!loc ? 'Set your delivery location first' : 'Enter your flat / house number', 'err');
      if (!loc) openPicker();
      return;
    }
    setPlacing(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isDelivery
            ? {
                type: 'home_delivery',
                sellerId: vendor.id,
                items: items.map((i) => ({ id: i.id, qty: i.qty })),
                address: {
                  label: 'Home',
                  flat: flat.trim(),
                  societyName: loc!.label,
                  addressText: addressText.trim() || loc!.label,
                  lat: loc!.lat,
                  lng: loc!.lng,
                },
              }
            : {
                type: 'mall_pickup',
                restaurantId: vendor.id,
                items: items.map((i) => ({ id: i.id, qty: i.qty })),
              },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Could not place the order', 'err');
        setPlacing(false);
        return;
      }
      if (data.payment.mode === 'mock') {
        setMockSheet({ orderId: data.orderId, amount: data.totalInPaise });
      } else {
        openRazorpay(data.orderId, data.payment);
      }
    } catch {
      toast('Network error — try again', 'err');
      setPlacing(false);
    }
  }

  function openRazorpay(
    orderId: number,
    payment: { keyId: string; razorpayOrderId: string; amountInPaise: number },
  ) {
    const launch = () => {
      const rzp = new window.Razorpay!({
        key: payment.keyId,
        amount: payment.amountInPaise,
        currency: 'INR',
        name: 'GharSe',
        description: `Order #${orderId}`,
        order_id: payment.razorpayOrderId,
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          const v = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, ...resp }),
          });
          if (v.ok) {
            clear();
            router.push(`/orders/${orderId}`);
          } else {
            toast('Payment verification failed — contact support', 'err');
            setPlacing(false);
          }
        },
        modal: { ondismiss: () => setPlacing(false) },
        theme: { color: '#1E4D2B' },
      });
      rzp.open();
    };
    if (window.Razorpay) launch();
    else {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = launch;
      s.onerror = () => {
        toast('Could not load the payment gateway', 'err');
        setPlacing(false);
      };
      document.body.appendChild(s);
    }
  }

  async function onMockResult(outcome: 'success' | 'failure') {
    if (!mockSheet) return;
    const res = await fetch('/api/payments/mock-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: mockSheet.orderId, outcome }),
    });
    if (outcome === 'success' && res.ok) {
      clear();
      toast('Payment successful 🎉');
      router.push(`/orders/${mockSheet.orderId}`);
    } else {
      setMockSheet(null);
      setPlacing(false);
      toast('Payment failed (simulated) — you can try again', 'err');
    }
  }

  return (
    <div className="mx-auto max-w-lg pt-6">
      <h1 className="text-2xl font-bold">Checkout</h1>
      <p className="text-sm text-ink-soft">
        {isDelivery ? `Home delivery from ${vendor?.name}` : `Counter pickup · ${vendor?.name}`}
      </p>

      {isDelivery && (
        <Card className="mt-5 space-y-4 p-4">
          <div className="flex items-center justify-between">
            <div className="eyebrow">DELIVER TO</div>
            <button onClick={openPicker} className="text-xs font-semibold text-leaf underline">
              {loc ? 'Change' : 'Set location'}
            </button>
          </div>
          {loc ? (
            <div className="text-sm font-medium">📍 {loc.label}</div>
          ) : (
            <div className="text-sm text-chili">No delivery location set</div>
          )}
          <Field label="Flat / house no.">
            <Input value={flat} onChange={(e) => setFlat(e.target.value)} placeholder="e.g. B-1204" required />
          </Field>
          <Field label="Address details">
            <Input value={addressText} onChange={(e) => setAddressText(e.target.value)} placeholder="Society, street, landmark" />
          </Field>
          {quote?.withinRange && (
            <div className="text-xs text-ink-faint">
              Kitchen is {formatDistance(quote.distanceKm)} away · rider ETA ~{quote.etaMins} min after pickup
            </div>
          )}
        </Card>
      )}

      {outOfRange && quote && !quote.withinRange && (
        <div className="mt-4 rounded-2xl bg-chili-tint px-4 py-3 text-sm text-chili-dark">
          This kitchen is {formatDistance(quote.distanceKm)} from your location — outside the{' '}
          {quote.radiusKm} km radius. Change your location or pick a closer kitchen.
        </div>
      )}

      {/* bill breakup — transparent, invoice style */}
      <Card className="mt-5 p-4">
        <div className="eyebrow mb-3">BILL DETAILS</div>
        <div className="space-y-2 text-sm">
          {items.map((i) => (
            <div key={i.id} className="flex justify-between">
              <span className="text-ink-soft">
                {i.title} × {i.qty}
              </span>
              <span>{formatINR(i.qty * i.pricePaise)}</span>
            </div>
          ))}
          <div className="border-t border-dashed border-rice-line pt-2" />
          <div className="flex justify-between">
            <span>Item total</span>
            <span>{formatINR(subtotalPaise)}</span>
          </div>
          {isDelivery && (
            <div className="flex justify-between">
              <span>Delivery fee {quote?.withinRange ? '' : '(calculating…)'}</span>
              <span>{quote?.withinRange ? formatINR(deliveryFee) : <Skeleton className="inline-block h-4 w-10" />}</span>
            </div>
          )}
          {isDelivery && (
            <div className="flex justify-between">
              <span>Platform fee</span>
              <span>{platformFee === 0 ? 'FREE' : formatINR(platformFee)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-rice-line pt-2 text-base font-bold">
            <span>To pay</span>
            <span>{formatINR(total)}</span>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Delivery fee goes to the delivery partner at cost. GharSe charges the kitchen a
          transparent commission — shown on their earnings page, never hidden in your bill.
        </p>
      </Card>

      <Button
        size="lg"
        className="mt-5 w-full"
        loading={placing}
        disabled={outOfRange || (isDelivery && quote == null)}
        onClick={placeOrder}
      >
        {mockMode ? `Pay ${formatINR(total)} (test mode)` : `Pay ${formatINR(total)}`}
      </Button>

      <MockCheckoutSheet
        open={!!mockSheet}
        orderId={mockSheet?.orderId ?? null}
        amountInPaise={mockSheet?.amount ?? 0}
        onResult={onMockResult}
        onClose={() => {
          setMockSheet(null);
          setPlacing(false);
        }}
      />
    </div>
  );
}
