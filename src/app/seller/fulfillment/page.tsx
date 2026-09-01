'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

type Fulfillment = {
  offersSelfPickup: boolean;
  offersSellerDelivery: boolean;
  sellerDeliveryFeeInPaise: number;
  sellerDeliveryRadiusKm: number;
  pickupInstructions: string | null;
  maxOrdersPerSlot: number;
};

export default function SellerFulfillment() {
  const [data, setData] = useState<Fulfillment | null>(null);
  const [selfPickup, setSelfPickup] = useState(true);
  const [sellerDelivery, setSellerDelivery] = useState(false);
  const [feeRupees, setFeeRupees] = useState('0');
  const [radiusKm, setRadiusKm] = useState('5');
  const [pickupInstructions, setPickupInstructions] = useState('');
  const [maxOrdersPerSlot, setMaxOrdersPerSlot] = useState('8');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetch('/api/seller/fulfillment')
      .then((r) => r.json())
      .then((d: Fulfillment) => {
        setData(d);
        setSelfPickup(d.offersSelfPickup);
        setSellerDelivery(d.offersSellerDelivery);
        setFeeRupees(String(d.sellerDeliveryFeeInPaise / 100));
        setRadiusKm(String(d.sellerDeliveryRadiusKm));
        setPickupInstructions(d.pickupInstructions ?? '');
        setMaxOrdersPerSlot(String(d.maxOrdersPerSlot));
      })
      .catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    const res = await fetch('/api/seller/fulfillment', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offersSelfPickup: selfPickup,
        offersSellerDelivery: sellerDelivery,
        sellerDeliveryFeeRupees: Number(feeRupees),
        sellerDeliveryRadiusKm: Number(radiusKm),
        pickupInstructions,
        maxOrdersPerSlot: Number(maxOrdersPerSlot),
      }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not save', 'err');
      return;
    }
    toast('Fulfillment settings saved ✅');
  }

  if (!data) return <Skeleton className="mx-auto h-96 w-full max-w-lg" />;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold">Fulfillment</h1>
      <p className="mt-1 text-sm text-ink-soft">
        GharSe never subsidizes delivery — pick how buyers can get your food. Self-pickup is
        always free for you and the buyer.
      </p>

      <Card className="mt-5 space-y-3 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={selfPickup}
            onChange={(e) => setSelfPickup(e.target.checked)}
            className="h-4 w-4 accent-leaf"
          />
          Offer self-pickup
        </label>
        <p className="text-xs text-ink-faint">Buyers collect from you — ₹0, no commission on delivery (there isn't any).</p>
        <Field label="Pickup instructions" hint="Shown to the buyer at checkout, e.g. building, flat and a collection window.">
          <Textarea
            rows={2}
            value={pickupInstructions}
            onChange={(e) => setPickupInstructions(e.target.value)}
            placeholder="e.g. Tower B, Flat 1204, collect between 12:30–1:30"
          />
        </Field>
      </Card>

      <Card className="mt-4 space-y-3 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={sellerDelivery}
            onChange={(e) => setSellerDelivery(e.target.checked)}
            className="h-4 w-4 accent-leaf"
          />
          Offer your own delivery
        </label>
        <p className="text-xs text-ink-faint">
          You deliver, you set the fee, you keep every rupee of it — GharSe only takes its
          commission on the food itself.
        </p>
        {sellerDelivery && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Your delivery fee (₹)">
              <Input inputMode="numeric" value={feeRupees} onChange={(e) => setFeeRupees(e.target.value)} />
            </Field>
            <Field label="Delivery radius (km)">
              <Input inputMode="numeric" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
            </Field>
          </div>
        )}
      </Card>

      <Card className="mt-4 space-y-2 p-4">
        <div className="text-sm font-semibold">Orders per meal slot</div>
        <p className="text-xs text-ink-faint">
          Cap on new orders per breakfast/lunch/dinner window, so you're never swamped even if
          several dishes still show portions left. Listings show "Sold out for this slot" once hit.
        </p>
        <Field label="Max orders per slot">
          <Input inputMode="numeric" value={maxOrdersPerSlot} onChange={(e) => setMaxOrdersPerSlot(e.target.value)} />
        </Field>
      </Card>

      <Button size="lg" className="mt-5 w-full" loading={busy} onClick={save}>
        Save fulfillment settings
      </Button>
    </div>
  );
}
