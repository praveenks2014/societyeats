/**
 * Seller settlements — Phase 2, kept as a stub through Phase 3 (Money).
 *
 * Live plan: Razorpay Route (linked accounts). Each approved seller gets a
 * linked account; on payment capture we create a transfer of
 * (subtotal - commission) to the seller's linked account, settled T+1.
 * https://razorpay.com/docs/route/
 *
 * The interface is stubbed now so earnings pages and the future worker can
 * code against it; MOCK_MODE keeps a ledger only.
 *
 * README — when to enable Route instead of the manual T+2 payout batch
 * (src/lib/payouts.ts, /admin/payouts):
 *   1. Razorpay Route/linked-accounts is approved for this business (KYC as
 *      a marketplace, not just a standard merchant account) — this typically
 *      needs a support ticket with Razorpay after initial volume.
 *   2. Seller count/order volume makes manual bank/UPI transfers (the
 *      pilot's actual mechanism) a real ops burden — one gated society is
 *      deliberately not that scale yet.
 *   3. TDS 194-O and GST accounting have been reconciled with a CA against
 *      automated per-transfer settlement, not just the batch-ledger model
 *      this phase ships (Route transfers happen per payment capture, not on
 *      a T+2 batch, which changes when/how TDS gets withheld).
 *   Until all three hold, ship every payout through the admin batch tool —
 *   do not wire ensureLinkedAccount/transferForOrder into the live order
 *   flow "just because the interface exists".
 */

export interface SettlementProvider {
  /** Create/fetch the seller's linked account (Razorpay Route `acc_` id). */
  ensureLinkedAccount(sellerUserId: number, vpaOrBank: string): Promise<string>;
  /** Transfer net payout for a captured order to the seller's linked account. */
  transferForOrder(orderId: number, linkedAccountId: string, amountInPaise: number): Promise<string>;
}

export const MockSettlements: SettlementProvider = {
  async ensureLinkedAccount(sellerUserId) {
    return `acc_MOCK${sellerUserId}`;
  },
  async transferForOrder(orderId) {
    // T+1 settlement via Razorpay Route — coming soon. Ledger only in MOCK_MODE.
    return `trf_MOCK${orderId}`;
  },
};
