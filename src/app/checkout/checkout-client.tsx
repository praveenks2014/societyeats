'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Field, Input, Skeleton } from '@/components/ui';
import { MockCheckoutSheet } from '@/components/mock-checkout';
import '@/components/razorpay';
import { useCart, useLocation, useToast } from '@/components/providers';
import { formatINR, quoteOrder, type FeeConfig } from '@/lib/money';
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
  feeConfig: FeeConfig;
  acceptsUpiNow: boolean;
  acceptsPayAtPickup: boolean;
  availableCreditPaise: number;
  radiusKm: number;
  distanceKm: number | null;
  withinRange: boolean | null;
  sellerDeliveryAvailable: boolean | null;
};

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
  // Referral credit only ever reduces the platform fee. Default on.
  const [useCredit, setUseCredit] = useState(true);
  // How the buyer pays the KITCHEN for the food.
  const [foodMode, setFoodMode] = useState<'upi_now' | 'pay_at_pickup'>('upi_now');

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

  // keep the selections valid as the kitchen's offer loads
  useEffect(() => {
    if (!quote) return;
    setFulfillment((prev) => {
      if (prev === 'self_pickup' && quote.offersSelfPickup) return prev;
      if (prev === 'seller_delivery' && quote.offersSellerDelivery) return prev;
      return quote.offersSelfPickup ? 'self_pickup' : quote.offersSellerDelivery ? 'seller_delivery' : prev;
    });
    setFoodMode((prev) => (prev === 'upi_now' && !quote.acceptsUpiNow ? 'pay_at_pickup' : prev === 'pay_at_pickup' && !quote.acceptsPayAtPickup ? 'upi_now' : prev));
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

  const needsAddress = isDelivery && fulfillment === 'seller_delivery';
  const outOfRange = needsAddress && quote?.withinRange === false;

  const deliveryFee = !isDelivery || fulfillment === 'self_pickup' ? 0 : (quote?.sellerDeliveryFeeInPaise ?? 0);
  // The SAME function the server uses (src/lib/money/fees.ts) — display and charge cannot drift apart.
  const bill = quote
    ? quoteOrder({ foodSubtotalPaise: subtotalPaise, sellerDeliveryFeePaise: deliveryFee, availableCreditPaise: useCredit ? quote.availableCreditPaise : 0 }, quote.feeConfig)
    : null;
  const feePct = quote ? quote.feeConfig.feeBps / 100 : 10;
  const total = isDelivery ? (bill?.onlineChargePaise ?? 0) : subtotalPaise;

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
                foodPaymentMode: foodMode,
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
      if (data.payment.mode === 'none') {
        clear();
        router.push(`/orders/${data.orderId}`);
      } else if (data.payment.mode === 'mock') {
        setMockSheet({ orderId: data.orderId, amount: data.onlineChargeInPaise ?? data.totalInPaise });
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
        name: 'PadosiPlate',
        description: `Platform fee · order #${orderId}`,
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
      toast(isDelivery ? 'Platform fee paid 🎉 — now pay the kitchen' : 'Payment successful 🎉');
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

      {isDelivery && quote && (quote.acceptsUpiNow || quote.acceptsPayAtPickup) && (
        <Card className="mt-4 space-y-2.5 p-4">
          <div className="eyebrow">HOW WILL YOU PAY {quote.kitchenName.toUpperCase()}?</div>
          {quote.acceptsUpiNow && (
            <FulfillmentOption active={foodMode === 'upi_now'} onClick={() => setFoodMode('upi_now')} title="Pay by UPI now" sub="Right after the platform fee you’ll get a UPI button / QR for the kitchen" feeLabel={formatINR(bill?.foodTotalPaise ?? 0)} />
          )}
          {quote.acceptsPayAtPickup && (
            <FulfillmentOption active={foodMode === 'pay_at_pickup'} onClick={() => setFoodMode('pay_at_pickup')} title="Pay at pickup" sub="UPI or cash to the kitchen when you collect" feeLabel={formatINR(bill?.foodTotalPaise ?? 0)} />
          )}
        </Card>
      )}

      {/* bill — two clearly separate parts */}
      {isDelivery ? (
        <div className="mt-5 space-y-3" data-testid="bill">
          <Card className="p-4">
            <div className="flex items-baseline justify-between">
              <div className="eyebrow">FOOD · PAID TO {(vendor?.name ?? 'KITCHEN').toUpperCase()}</div>
              <span className="text-[11px] text-ink-faint">not collected by PadosiPlate</span>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              {items.map((i) => (
                <div key={i.id} className="flex justify-between">
                  <span className="text-ink-soft">{i.title} × {i.qty}</span>
                  <span>{formatINR(i.qty * i.pricePaise)}</span>
                </div>
              ))}
              {fulfillment === 'seller_delivery' && (
                <div className="flex justify-between">
                  <span className="text-ink-soft">Delivery (kept by the kitchen)</span>
                  <span>{formatINR(deliveryFee)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-rice-line pt-2 font-bold" data-testid="food-total">
                <span>Food, paid to {vendor?.name}</span>
                <span>{formatINR(bill?.foodTotalPaise ?? subtotalPaise)}</span>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="eyebrow">PLATFORM FEE · PAID NOW VIA RAZORPAY</div>
            {!bill ? (
              <Skeleton className="mt-3 h-16 w-full" />
            ) : (
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Platform fee ({feePct}% of food)</span>
                  <span>{formatINR(bill.feeBeforeCreditPaise)}</span>
                </div>
                {bill.creditAppliedPaise > 0 && (
                  <div className="flex justify-between text-leaf">
                    <span>Referral credit</span>
                    <span>−{formatINR(bill.creditAppliedPaise)}</span>
                  </div>
                )}
                {bill.feeGstPaise > 0 && (
                  <div className="flex justify-between">
                    <span>GST on platform fee</span>
                    <span>{formatINR(bill.feeGstPaise)}</span>
                  </div>
                )}
                {bill.ecoGstPaise > 0 && (
                  <div className="flex justify-between">
                    <span>GST on food (collected as e-commerce operator)</span>
                    <span>{formatINR(bill.ecoGstPaise)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-rice-line pt-2 text-base font-bold" data-testid="platform-fee-total">
                  <span>Platform fee to pay now</span>
                  <span>{formatINR(bill.onlineChargePaise)}</span>
                </div>
              </div>
            )}
            {quote && quote.availableCreditPaise > 0 && (
              <label className="mt-3 flex min-h-[44px] items-center gap-2 rounded-xl bg-leaf-tint px-3 py-2 text-sm text-leaf">
                <input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} className="h-4 w-4 accent-leaf" />
                Use my {formatINR(quote.availableCreditPaise)} referral credit (platform fee only)
              </label>
            )}
          </Card>
          <p className="px-1 text-[11px] leading-relaxed text-ink-faint">
            You pay <strong>{vendor?.name}</strong> directly for the food — by UPI or at pickup. PadosiPlate never holds your food money; the platform fee is its only charge. If the kitchen declines, the platform fee is refunded automatically.
          </p>
        </div>
      ) : (
        <Card className="mt-5 p-4">
          <div className="eyebrow mb-3">BILL DETAILS</div>
          <div className="space-y-2 text-sm">
            {items.map((i) => (
              <div key={i.id} className="flex justify-between">
                <span className="text-ink-soft">{i.title} × {i.qty}</span>
                <span>{formatINR(i.qty * i.pricePaise)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-rice-line pt-2 text-base font-bold">
              <span>Item total</span>
              <span>{formatINR(subtotalPaise)}</span>
            </div>
          </div>
        </Card>
      )}

      <Button
        size="lg"
        className="mt-5 w-full"
        loading={placing}
        disabled={outOfRange || (isDelivery && quote == null)}
        onClick={placeOrder}
      >
        {isDelivery
          ? total === 0
            ? 'Place order'
            : `Pay platform fee ${formatINR(total)}${mockMode ? ' (test mode)' : ''}`
          : `Pay ${formatINR(total)}${mockMode ? ' (test mode)' : ''}`}
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
