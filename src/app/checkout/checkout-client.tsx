'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { MockCheckoutSheet } from '@/components/mock-checkout';
import { launchRazorpay } from '@/components/razorpay';
import { useCart, useLocation, useToast } from '@/components/providers';
import { formatINR, quoteOrder, type FeeConfig } from '@/lib/money';
import { formatDistance } from '@/lib/geo';
import { FssaiLabel } from '@/components/fssai-label';
import { DisclaimerClient } from '@/components/disclaimer-client';
import { BRAND } from '@/config/brand';

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
  preOrders?: { enabled: boolean; maxDays: number };
  acceptsCash: boolean;
  minOrderPaise: number;
  gstMode: string;
  availableCreditPaise: number;
  radiusKm: number;
  distanceKm: number | null;
  withinRange: boolean | null;
  sellerDeliveryAvailable: boolean | null;
};

const SLOT_HOUR = { breakfast: 9, lunch: 13, dinner: 20 } as const;
/** The delivery time (as an ISO instant) for “N days from today, at this meal”, using IST wall-clock hours. */
function scheduledIso(day: number, slot: keyof typeof SLOT_HOUR): string {
  const now = new Date(Date.now() + 330 * 60_000); // IST wall clock, read through the UTC fields
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, SLOT_HOUR[slot], 0, 0));
  return new Date(d.getTime() - 330 * 60_000).toISOString();
}
function dayLabel(day: number): string {
  const now = new Date(Date.now() + 330 * 60_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day));
  return `${day === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })} · ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
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
  // Referral credit only ever reduces the platform fee. Default on.
  const [useCredit, setUseCredit] = useState(true);
  const [schedule, setSchedule] = useState<{ on: boolean; day: number; slot: 'breakfast' | 'lunch' | 'dinner' }>({ on: false, day: 1, slot: 'lunch' });

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
                items: items.map((i) => ({ id: i.id, qty: i.qty })),
                useCredit,
                ...(schedule.on ? { scheduledFor: scheduledIso(schedule.day, schedule.slot) } : {}),
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
    launchRazorpay({
      keyId: payment.keyId,
      razorpayOrderId: payment.razorpayOrderId,
      amountInPaise: payment.amountInPaise,
      description: `Platform fee · order #${orderId}`,
      onSuccess: async (resp) => {
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
      onDismiss: () => setPlacing(false),
      onLoadError: () => {
        toast('Could not load the payment gateway', 'err');
        setPlacing(false);
      },
    });
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
      toast(isDelivery ? 'Booked 🎉 — the kitchen will confirm shortly' : 'Payment successful 🎉');
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
      {vendor?.kind === 'seller' && <FssaiLabel sellerId={vendor.id} className="mt-1" />}
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

      {isDelivery && quote?.preOrders?.enabled && (
        <Card className="mt-4 space-y-3 p-4" data-testid="schedule-card">
          <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-leaf" checked={schedule.on} onChange={(e) => setSchedule((x) => ({ ...x, on: e.target.checked }))} data-testid="schedule-toggle" />
            Order for later
          </label>
          {schedule.on && (
            <div className="grid grid-cols-2 gap-3">
              <Select value={String(schedule.day)} onChange={(e) => setSchedule((x) => ({ ...x, day: Number(e.target.value) }))} aria-label="Day" data-testid="schedule-day">
                {Array.from({ length: quote.preOrders.maxDays }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{dayLabel(d)}</option>
                ))}
              </Select>
              <Select value={schedule.slot} onChange={(e) => setSchedule((x) => ({ ...x, slot: e.target.value as typeof x.slot }))} aria-label="Meal" data-testid="schedule-slot">
                <option value="breakfast">Breakfast (around 9)</option>
                <option value="lunch">Lunch (around 1)</option>
                <option value="dinner">Dinner (around 8)</option>
              </Select>
              <p className="col-span-2 text-xs text-ink-faint">You pay the platform fee now to book it. The kitchen confirms before the slot; if it cannot, your fee is refunded in full.</p>
            </div>
          )}
        </Card>
      )}

      {isDelivery && quote && (
        <Card className="mt-4 space-y-1.5 p-4" data-testid="pay-at-door-card">
          <div className="eyebrow">HOW PAYMENT WORKS</div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
            <li>Pay the <strong>platform fee</strong> now to confirm your booking.</li>
            <li>The kitchen cooks and brings your food to your door (or you collect it).</li>
            <li>Only then do you pay <strong>{quote.kitchenName}</strong> the food amount by UPI{quote.acceptsCash ? ' or cash' : ''}. You&apos;ll see their QR at the door.</li>
          </ol>
          <DisclaimerClient id="pay-at-door" className="mt-2" />
        </Card>
      )}
      <div className="mt-3 space-y-2" data-testid="checkout-disclaimers">
        <DisclaimerClient id="pricing" />
        <DisclaimerClient id="cancellation" />
        <p className="text-xs text-ink-faint"><Link href="/legal/terms#liability" className="inline-flex min-h-[44px] items-center underline">Limit of liability</Link></p>
      </div>

      {/* bill — two clearly separate parts */}
      {isDelivery ? (
        <div className="mt-5 space-y-3" data-testid="bill">
          <Card className="p-4">
            <div className="flex items-baseline justify-between">
              <div className="eyebrow">FOOD · PAID TO {(vendor?.name ?? 'KITCHEN').toUpperCase()}</div>
              <span className="text-[11px] text-ink-faint">not collected by {BRAND.name}</span>
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
            You pay <strong>{vendor?.name}</strong> directly for the food, at your door, after it arrives. {BRAND.name} never holds your food money; the platform fee is its only charge. Free cancellation until the kitchen accepts. If the kitchen cancels, you get the full platform fee back plus the same amount as {BRAND.name} credit.
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
