import { formatINR } from '@/lib/money';
import { quoteOrder, type FeeConfig } from '@/lib/money/fees';
import { BRAND } from '@/config/brand';

export type PriceLine = { key: 'food' | 'fee' | 'fee_gst' | 'food_gst' | 'credit' | 'pay_now' | 'pay_at_door'; label: string; amountPaise: number };

/**
 * The one place upfront prices are worded, shared by dish cards, the dish page,
 * cart and checkout. Food is paid to the kitchen at the door; only the platform
 * fee (and any GST the platform collects) is paid now.
 */
export function priceBreakdown(foodPaise: number, cfg: FeeConfig, creditPaise = 0) {
  const q = quoteOrder({ foodSubtotalPaise: foodPaise, availableCreditPaise: creditPaise }, cfg);
  const lines: PriceLine[] = [{ key: 'food', label: 'Food (pay the kitchen at your door)', amountPaise: q.foodTotalPaise }];
  lines.push({ key: 'fee', label: 'Platform fee (pay now)', amountPaise: q.platformFeePaise });
  if (q.creditAppliedPaise > 0) lines.push({ key: 'credit', label: 'Credit applied to the fee', amountPaise: -q.creditAppliedPaise });
  if (q.feeGstPaise > 0) lines.push({ key: 'fee_gst', label: 'GST on platform fee (pay now)', amountPaise: q.feeGstPaise });
  if (q.ecoGstPaise > 0) lines.push({ key: 'food_gst', label: `GST on food collected by ${BRAND.name} under Sec 9(5) (pay now)`, amountPaise: q.ecoGstPaise });
  const summary = `${formatINR(q.foodTotalPaise)} food (pay the kitchen at your door) + ${formatINR(q.onlineChargePaise)} platform fee${q.feeGstPaise + q.ecoGstPaise > 0 ? ' incl. GST' : ''} (pay now)`;
  return { quote: q, lines, summary, payNowPaise: q.onlineChargePaise, payAtDoorPaise: q.foodTotalPaise };
}
