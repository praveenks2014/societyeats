/**
 * Seller settlements — Phase 2.
 *
 * Live plan: Razorpay Route (linked accounts). Each approved seller gets a
 * linked account; on payment capture we create a transfer of
 * (subtotal - commission) to the seller's linked account, settled T+1.
 * https://razorpay.com/docs/route/
 *
 * The interface is stubbed now so earnings pages and the future worker can
 * code against it; MOCK_MODE keeps a ledger only.
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
