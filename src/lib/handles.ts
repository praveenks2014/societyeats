import crypto from 'node:crypto';
import { BRAND } from '@/config/brand';

/**
 * Anonymous handle for a buyer within one order thread ("Buyer #A7"): a
 * stable, order-scoped hash — no name, phone or flat number ever appears.
 */
export function buyerHandle(orderId: number, buyerId: number): string {
  const h = crypto.createHash('sha256').update(`${BRAND.cryptoContext.buyerHandle}:${orderId}:${buyerId}`).digest();
  return `Buyer #${String.fromCharCode(65 + (h[0] % 26))}${h[1] % 10}`;
}
