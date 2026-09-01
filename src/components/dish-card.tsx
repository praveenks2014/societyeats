'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Badge, Button, Modal, VegDot } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { useCart, useLocation, useToast, type CartVendor } from '@/components/providers';
import { formatINR } from '@/lib/money';
import { formatDistance } from '@/lib/geo';

export type DishCardData = {
  id: number;
  title: string;
  priceInPaise: number;
  isVeg: boolean;
  photoUrl: string | null;
  availableQty: number;
  prepTimeMins?: number;
  kitchenName: string;
  rating?: number;
  ratingCount?: number;
  fssaiStatus?: 'verified' | 'pending_application' | 'unverified';
  distanceKm?: number | null;
  societyName?: string | null;
  href?: string;
  /** DECISIONS.md #37+: seller has hit maxOrdersPerSlot for the current meal slot. */
  slotSoldOut?: boolean;
  /** DECISIONS.md #73+: kitchen has >= DEFAULTS.minKitchenPhotosRequired photos on file. */
  kitchenPhotosVerified?: boolean;
  /** DECISIONS.md #73+: distinct buyers with a completed order from this seller. */
  orderedByCount?: number;
};

export function DishCard({
  dish,
  vendor,
  requireLocation = true,
}: {
  dish: DishCardData;
  vendor: CartVendor;
  requireLocation?: boolean;
}) {
  const { add, replaceWith, vendor: cartVendor } = useCart();
  const { loc, openPicker } = useLocation();
  const toast = useToast();
  const [conflict, setConflict] = useState(false);
  const [pop, setPop] = useState(0);

  const item = {
    id: dish.id,
    title: dish.title,
    pricePaise: dish.priceInPaise,
    isVeg: dish.isVeg,
    photoUrl: dish.photoUrl,
    maxQty: dish.availableQty,
  };

  function onAdd() {
    if (dish.slotSoldOut) return;
    if (requireLocation && !loc) {
      openPicker();
      return;
    }
    const result = add(vendor, item);
    if (result === 'conflict') {
      setConflict(true);
    } else {
      setPop((p) => p + 1);
      toast(`Added ${dish.title}`);
    }
  }

  const inner = (
    <>
      <div className="relative">
        <FoodImage src={dish.photoUrl} alt={dish.title} className="aspect-[4/3] w-full" />
        {dish.fssaiStatus === 'pending_application' && (
          <Badge tone="amber" className="absolute left-2 top-2">
            FSSAI Pending
          </Badge>
        )}
        {dish.fssaiStatus === 'verified' && (
          <Badge tone="green" className="absolute left-2 top-2">
            FSSAI ✓
          </Badge>
        )}
        {dish.availableQty <= 3 && !dish.slotSoldOut && (
          <Badge tone="red" className="absolute right-2 top-2">
            Only {dish.availableQty} left
          </Badge>
        )}
        {dish.slotSoldOut && (
          <div className="absolute inset-x-0 bottom-0 bg-ink/80 py-1 text-center text-[11px] font-semibold text-white">
            Sold out for this slot
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start gap-2">
          <VegDot isVeg={dish.isVeg} className="mt-0.5" />
          <h3 className="flex-1 font-display text-[15px] font-bold leading-snug">{dish.title}</h3>
        </div>
        <div className="mt-1 text-xs text-ink-soft">{dish.kitchenName}</div>
        {(dish.distanceKm != null || dish.societyName) && (
          <div className="eyebrow mt-1.5">
            {dish.distanceKm != null ? `${formatDistance(dish.distanceKm)} away` : ''}
            {dish.distanceKm != null && dish.societyName ? ' · ' : ''}
            {dish.societyName ?? ''}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between pt-3">
          <div>
            <div className="text-base font-bold">{formatINR(dish.priceInPaise)}</div>
            {dish.rating !== undefined && dish.rating > 0 && (
              <div className="text-xs text-ink-faint">★ {dish.rating.toFixed(1)} ({dish.ratingCount})</div>
            )}
            {(dish.kitchenPhotosVerified || !!dish.orderedByCount) && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-faint">
                {dish.kitchenPhotosVerified && <span>📷 Verified kitchen</span>}
                {!!dish.orderedByCount && <span>Ordered by {dish.orderedByCount} neighbours</span>}
              </div>
            )}
          </div>
          <motion.div key={pop} animate={pop ? { scale: [1, 1.25, 1] } : undefined} transition={{ duration: 0.3 }}>
            <Button
              size="sm"
              disabled={dish.slotSoldOut}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAdd();
              }}
            >
              {dish.slotSoldOut ? 'Sold out' : 'ADD +'}
            </Button>
          </motion.div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <motion.article
        whileHover={{ y: -3 }}
        transition={{ duration: 0.18 }}
        className="flex flex-col overflow-hidden rounded-card border border-rice-line bg-white shadow-card"
      >
        {dish.href ? (
          <a href={dish.href} className="flex flex-1 flex-col">
            {inner}
          </a>
        ) : (
          inner
        )}
      </motion.article>

      <Modal open={conflict} onClose={() => setConflict(false)} title="Start a new basket?" sheet>
        <p className="text-sm text-ink-soft">
          Your basket has items from <strong>{cartVendor?.name}</strong>. One order can only be
          from one kitchen — replace the basket with items from{' '}
          <strong>{vendor.name}</strong>?
        </p>
        <div className="mt-5 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={() => setConflict(false)}>
            Keep basket
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              replaceWith(vendor, item);
              setConflict(false);
              toast(`Started a new basket from ${vendor.name}`);
            }}
          >
            Replace
          </Button>
        </div>
      </Modal>
    </>
  );
}
