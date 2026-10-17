/**
 * The ONE place platform money is computed — buyer platform fee, GST on the
 * fee, optional e-commerce-operator (Sec 9(5)) food GST and subscription GST.
 * Used by quotes, order creation, the checkout UI, invoices, the seller
 * dashboard and admin metrics. Pure integer-paise maths: no floats leak out.
 *
 * The food amount (subtotal + seller-delivery fee) is the KITCHEN's money,
 * paid by the buyer directly (UPI / at pickup). Only `onlineChargePaise` ever
 * passes through the platform's Razorpay account.
 */

export type FeeConfig = {
  /** Platform fee in basis points of the food subtotal (1000 = 10%). */
  feeBps: number;
  /** Floor per order in paise (0 = none). */
  feeMinPaise: number;
  /** Cap per order in paise (0 = no cap). */
  feeMaxPaise: number;
  /** GST on the platform fee in bps — pass 0 when the platform has no GSTIN. */
  feeGstBps: number;
  /** 'collect_with_platform_fee' adds ECO food GST to the Razorpay charge. */
  ecoMode: 'off' | 'collect_with_platform_fee';
  ecoBps: number;
};

/** Razorpay will not create an order below ₹1. */
export const RAZORPAY_MIN_CHARGE_PAISE = 100;

/** round(amount × bps / 10000), half-up, integer-safe. */
export function bpsOf(amountPaise: number, bps: number): number {
  return Math.floor((amountPaise * bps + 5000) / 10000);
}

/** GST only applies when the platform has a GSTIN on file. */
export function effectiveGstBps(gstBps: number, gstin: string | null | undefined): number {
  return gstin && gstin.trim() ? gstBps : 0;
}

/** Platform fee before GST/credit: pct of food, then floor, then cap. */
export function platformFeeBase(foodSubtotalPaise: number, cfg: Pick<FeeConfig, 'feeBps' | 'feeMinPaise' | 'feeMaxPaise'>): number {
  let fee = bpsOf(foodSubtotalPaise, cfg.feeBps);
  if (cfg.feeMinPaise > 0) fee = Math.max(fee, cfg.feeMinPaise);
  if (cfg.feeMaxPaise > 0) fee = Math.min(fee, cfg.feeMaxPaise);
  return fee;
}

export type OrderQuote = {
  foodSubtotalPaise: number;
  sellerDeliveryFeePaise: number;
  /** "Food (paid to <Kitchen>)" — goes straight to the kitchen. */
  foodTotalPaise: number;
  /** Fee before any referral credit. */
  feeBeforeCreditPaise: number;
  /** Referral credit actually used (≤ the fee, never touches GST). */
  creditAppliedPaise: number;
  /** Fee after credit, before GST. */
  platformFeePaise: number;
  feeGstPaise: number;
  ecoGstPaise: number;
  /** "Platform fee" line: fee + GST on fee + ECO GST. This is what Razorpay collects. */
  onlineChargePaise: number;
  /** Paise added to reach Razorpay's ₹1 minimum (0 almost always). */
  gatewayTopUpPaise: number;
  /** foodTotal + onlineCharge — the whole bill the buyer sees. */
  grandTotalPaise: number;
  snapshot: { feeBps: number; feeMinPaise: number; feeMaxPaise: number; feeGstBps: number; ecoMode: FeeConfig['ecoMode']; ecoBps: number };
};

export function quoteOrder(
  input: { foodSubtotalPaise: number; sellerDeliveryFeePaise?: number; availableCreditPaise?: number },
  cfg: FeeConfig,
): OrderQuote {
  const food = Math.max(0, Math.trunc(input.foodSubtotalPaise));
  const delivery = Math.max(0, Math.trunc(input.sellerDeliveryFeePaise ?? 0));
  const feeBefore = platformFeeBase(food, cfg);
  // Credit reduces the platform fee itself (a discount, so GST is on the discounted fee)
  // and can never push it below ₹0.
  const credit = Math.min(Math.max(0, Math.trunc(input.availableCreditPaise ?? 0)), feeBefore);
  let fee = feeBefore - credit;
  const eco = cfg.ecoMode === 'collect_with_platform_fee' ? bpsOf(food, cfg.ecoBps) : 0;
  let gst = bpsOf(fee, cfg.feeGstBps);
  let charge = fee + gst + eco;
  let topUp = 0;
  // Razorpay minimum: top up the fee (not GST) until the charge reaches ₹1.
  for (let i = 0; i < 3 && charge > 0 && charge < RAZORPAY_MIN_CHARGE_PAISE; i++) {
    const delta = RAZORPAY_MIN_CHARGE_PAISE - charge;
    fee += delta;
    topUp += delta;
    gst = bpsOf(fee, cfg.feeGstBps);
    charge = fee + gst + eco;
  }
  return {
    foodSubtotalPaise: food,
    sellerDeliveryFeePaise: delivery,
    foodTotalPaise: food + delivery,
    feeBeforeCreditPaise: feeBefore,
    creditAppliedPaise: credit,
    platformFeePaise: fee,
    feeGstPaise: gst,
    ecoGstPaise: eco,
    onlineChargePaise: charge,
    gatewayTopUpPaise: topUp,
    grandTotalPaise: food + delivery + charge,
    snapshot: { feeBps: cfg.feeBps, feeMinPaise: cfg.feeMinPaise, feeMaxPaise: cfg.feeMaxPaise, feeGstBps: cfg.feeGstBps, ecoMode: cfg.ecoMode, ecoBps: cfg.ecoBps },
  };
}

/** Build the fee config from platform settings (GST dropped to 0 without a GSTIN). */
export function feeConfigFromSettings(s: {
  buyerPlatformFeeBps: number;
  buyerPlatformFeeMinPaise: number;
  buyerPlatformFeeMaxPaise: number;
  platformFeeGstBps: number;
  platformGstin: string;
  ecoFoodGstMode: string;
  ecoFoodGstBps: number;
}): FeeConfig {
  return {
    feeBps: s.buyerPlatformFeeBps,
    feeMinPaise: s.buyerPlatformFeeMinPaise,
    feeMaxPaise: s.buyerPlatformFeeMaxPaise,
    feeGstBps: effectiveGstBps(s.platformFeeGstBps, s.platformGstin),
    ecoMode: s.ecoFoodGstMode === 'collect_with_platform_fee' ? 'collect_with_platform_fee' : 'off',
    ecoBps: s.ecoFoodGstBps,
  };
}

/** GST split for an invoice: intra-state supply → CGST + SGST halves (odd paisa goes to CGST). */
export function splitGst(gstPaise: number): { cgst: number; sgst: number } {
  const sgst = Math.floor(gstPaise / 2);
  return { cgst: gstPaise - sgst, sgst };
}

export type SubscriptionCharge = { basePaise: number; gstPaise: number; totalPaise: number; gstBps: number };

/** Subscription price is the base; GST (when the platform has a GSTIN) is added on top. */
export function subscriptionCharge(planPricePaise: number, gstBps: number): SubscriptionCharge {
  const gst = bpsOf(planPricePaise, gstBps);
  return { basePaise: planPricePaise, gstPaise: gst, totalPaise: planPricePaise + gst, gstBps };
}
