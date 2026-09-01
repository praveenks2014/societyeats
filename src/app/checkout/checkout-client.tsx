'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Field, Input, Skeleton } from '@/components/ui';
import { MockCheckoutSheet } from '@/components/mock-checkout';
import { useCart, useLocation, useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';
import { formatDistance } from '@/lib/geo';

type FulfillmentType = 'self_pickup' | 'seller_delivery' | 'platform_delivery';

type QuoteResp = {
  sellerId: number;
  kitchenName: string;
  pickupInstructions: string | null;
  offersSelfPickup: boolean;
  offersSellerDelivery: boolean;
  sellerDeliveryFeeInPaise: number;
  sellerDeliveryRadiusKm: number;
  platformDeliveryEnabled: boolean;
  platformDeliveryMinOrderPaise: number;
  buyerPlatformFeePaise: number;
  commissionHomePct: number;
  gstPct: number;
  radiusKm: number;
  distanceKm: number | null;
  withinRange: boolean | null;
  sellerDeliveryAvailable: boolean | null;
  platformDeliveryFeeInPaise: number | null;
  platformDeliveryEtaMins: number | null;
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
  const [fulfillment, setFulfillment] = useState<FulfillmentType>('self_pickup');
  const [placing, setPlacing] = useState(false);
  const [mockSheet, setMockSheet] = useState<{ orderId: number; amount: number } | null>(null);
  // Pilot Hardening v2 — Phase 6 (DECISIONS.md #87+): referral credit,
  // opt-out toggle — default to applying it, matching how most wallet/credit
  // balances behave elsewhere (Amazon Pay, Swiggy Money).
  const [availableCreditPaise, setAvailableCreditPaise] = useState(0);
  const [useCredit, setUseCredit] = useState(true);

  useEffect(() => {
    fetch('/api/referrals')
      .then((r) => r.json())
      .then((d) => setAvailableCreditPaise(d.availablePaise ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (loc && !addressText) setAddressText(loc.label);
  }, [loc, addressText]);

  // reset the choice whenever the checkout target changes
  useEffect(() => {
    setFulfillment('self_pickup');
  }, [vendor?.id]);

  useEffect(() => {
    if (!isDelivery || !vendor) return;
    setQuote(null);
    const params = new URLSearchParams({ sellerId: String(vendor.id) });
    if (loc) {
      params.set('lat', String(loc.lat));
      params.set('lng', String(loc.lng));
    }
    fetch(`/api/quote?${params}`)
      .then((r) => r.json())
      .then(setQuote)
      .catch(() => {});
  }, [isDelivery, vendor, loc]);

  // keep the selection valid as the offer loads/changes — only force a
  // switch when the current pick isn't OFFERED at all, never just because
  // it's temporarily out of range (that's shown inline, not auto-corrected)
  useEffect(() => {
    if (!quote) return;
    const isOffered = (t: FulfillmentType) =>
      t === 'self_pickup'
        ? quote.offersSelfPickup
        : t === 'seller_delivery'
          ? quote.offersSellerDelivery
          : quote.platformDeliveryEnabled;
    setFulfillment((prev) => {
      if (isOffered(prev)) return prev;
      if (quote.offersSelfPickup) return 'self_pickup';
      if (quote.offersSellerDelivery) return 'seller_delivery';
      if (quote.platformDeliveryEnabled) return 'platform_delivery';
      return prev;
    });
  }, [quote]);

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

  const needsAddress = isDelivery && fulfillment !== 'self_pickup';
  const platformEligibleBySubtotal = quote ? subtotalPaise >= quote.platformDeliveryMinOrderPaise : false;
  const outOfRange = needsAddress && quote?.withinRange === false;

  const deliveryFee =
    !isDelivery || fulfillment === 'self_pickup'
      ? 0
      : fulfillment === 'seller_delivery'
        ? (quote?.sellerDeliveryFeeInPaise ?? 0)
        : (quote?.platformDeliveryFeeInPaise ?? 0);
  const buyerPlatformFee = quote?.buyerPlatformFeePaise ?? 0;
  const gstPct = quote?.gstPct ?? 5;
  const gstInPaise = isDelivery ? Math.round((subtotalPaise * gstPct) / 100) : 0;
  const totalBeforeCredit = subtotalPaise + (isDelivery ? deliveryFee + buyerPlatformFee + gstInPaise : 0);
  // Mirrors the server's own cap (POST /api/orders) so the displayed total
  // matches what will actually be charged — the server recomputes and
  // enforces this independently, this is display-only.
  const creditApplied = useCredit ? Math.min(availableCreditPaise, Math.max(0, totalBeforeCredit - 100)) : 0;
  const total = totalBeforeCredit - creditApplied;

  async function placeOrder() {
    if (!vendor) return;
    if (needsAddress && (!loc || !flat.trim())) {
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
                fulfillmentType: fulfillment,
                items: items.map((i) => ({ id: i.id, qty: i.qty })),
                useCredit,
                ...(needsAddress
                  ? {
                      address: {
                        label: 'Home',
                        flat: flat.trim(),
                        societyName: loc!.label,
                        addressText: addressText.trim() || loc!.label,
                        lat: loc!.lat,
                        lng: loc!.lng,
                      },
                    }
                  : {}),
              }
            : {
                type: 'mall_pickup',
                restaurantId: vendor.id,
                items: items.map((i) => ({ id: i.id, qty: i.qty })),
                useCredit,
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
        {isDelivery ? `Order from ${vendor?.name}` : `Counter pickup · ${vendor?.name}`}
      </p>

      {isDelivery && (
        <Card className="mt-5 space-y-2.5 p-4">
          <div className="eyebrow">HOW WOULD YOU LIKE THIS?</div>
          {!quote ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="space-y-2">
              {quote.offersSelfPickup && (
                <FulfillmentOption
                  active={fulfillment === 'self_pickup'}
                  onClick={() => setFulfillment('self_pickup')}
                  title="Self pickup"
                  sub={quote.pickupInstructions ? `Collect · ${quote.pickupInstructions}` : `Collect from ${quote.kitchenName}`}
                  feeLabel="₹0"
                />
              )}
              {quote.offersSellerDelivery && (
                <FulfillmentOption
                  active={fulfillment === 'seller_delivery'}
                  onClick={() => setFulfillment('seller_delivery')}
                  disabled={quote.sellerDeliveryAvailable === false}
                  title="Seller delivery"
                  sub={
                    quote.sellerDeliveryAvailable === false
                      ? `Outside ${quote.kitchenName}'s ${quote.sellerDeliveryRadiusKm} km delivery range`
                      : `${quote.kitchenName} delivers it themselves`
                  }
                  feeLabel={formatINR(quote.sellerDeliveryFeeInPaise)}
                />
              )}
              {quote.platformDeliveryEnabled && (
                <FulfillmentOption
                  active={fulfillment === 'platform_delivery'}
                  onClick={() => setFulfillment('platform_delivery')}
                  disabled={quote.withinRange === false || !platformEligibleBySubtotal}
                  title="Delivery partner"
                  sub={
                    quote.withinRange === false
                      ? `Outside the ${quote.radiusKm} km delivery radius`
                      : !platformEligibleBySubtotal
                        ? `Needs an order of ${formatINR(quote.platformDeliveryMinOrderPaise)}+`
                        : `Porter/Shadowfax/Borzo · ~${quote.platformDeliveryEtaMins ?? 30} min after pickup`
                  }
                  feeLabel={quote.platformDeliveryFeeInPaise != null ? formatINR(quote.platformDeliveryFeeInPaise) : '—'}
                />
              )}
            </div>
          )}
        </Card>
      )}

      {needsAddress && (
        <Card className="mt-4 space-y-4 p-4">
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
          {quote?.withinRange && quote.distanceKm != null && (
            <div className="text-xs text-ink-faint">Kitchen is {formatDistance(quote.distanceKm)} away</div>
          )}
        </Card>
      )}

      {outOfRange && quote && (
        <div className="mt-4 rounded-2xl bg-chili-tint px-4 py-3 text-sm text-chili-dark">
          This kitchen is {quote.distanceKm != null ? formatDistance(quote.distanceKm) : 'too far'} from your
          location for delivery. Change your location, pick self-pickup, or choose a closer kitchen.
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
              <span>
                {fulfillment === 'self_pickup'
                  ? 'Delivery (self pickup)'
                  : fulfillment === 'seller_delivery'
                    ? 'Delivery fee (kept by the kitchen)'
                    : 'Delivery fee (via delivery partner)'}
              </span>
              <span>{fulfillment === 'self_pickup' ? 'FREE' : quote ? formatINR(deliveryFee) : <Skeleton className="inline-block h-4 w-10" />}</span>
            </div>
          )}
          {isDelivery && (
            <div className="flex justify-between">
              <span>Platform fee</span>
              <span>{buyerPlatformFee === 0 ? 'FREE' : formatINR(buyerPlatformFee)}</span>
            </div>
          )}
          {isDelivery && (
            <div className="flex justify-between">
              <span>GST {gstPct}% on food</span>
              <span>{formatINR(gstInPaise)}</span>
            </div>
          )}
          {creditApplied > 0 && (
            <div className="flex justify-between text-leaf">
              <span>Referral credit applied</span>
              <span>−{formatINR(creditApplied)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-rice-line pt-2 text-base font-bold">
            <span>To pay</span>
            <span>{formatINR(total)}</span>
          </div>
        </div>
        {availableCreditPaise > 0 && (
          <label className="mt-3 flex items-center gap-2 rounded-xl bg-leaf-tint px-3 py-2 text-sm text-leaf">
            <input
              type="checkbox"
              checked={useCredit}
              onChange={(e) => setUseCredit(e.target.checked)}
              className="h-4 w-4 accent-leaf"
            />
            Apply your {formatINR(availableCreditPaise)} referral credit
          </label>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          {isDelivery
            ? "GST is collected by GharSe, the platform of record for home-food orders (deemed supplier under Sec 9(5) CGST) — the kitchen doesn't need its own GST registration for this. A seller-delivery fee goes entirely to the kitchen; a delivery-partner fee is passed through at cost. GharSe charges the kitchen a transparent commission on the food only — shown on their earnings page, never hidden in your bill."
            : 'GharSe charges the counter a transparent commission — shown on their earnings page, never hidden in your bill.'}
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

function FulfillmentOption({
  active,
  disabled,
  onClick,
  title,
  sub,
  feeLabel,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  feeLabel: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-2xl border-2 p-3 text-left transition-colors ${
        active ? 'border-leaf bg-leaf/5' : 'border-rice-line'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold">{title}</span>
        <span className="shrink-0 text-sm font-bold text-leaf">{feeLabel}</span>
      </div>
      <div className="mt-0.5 text-xs text-ink-faint">{sub}</div>
    </button>
  );
}
