import { and, desc, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { isMockMode } from '@/lib/config';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { getPlatformSettings } from '@/lib/db/platform';
import { sellerProfiles, upiVerifications } from '@/lib/db/schema';
import { VPA_RE } from '@/lib/kitchen/gate';
import { log } from '@/lib/log';
import { ensureCaptured } from '@/lib/payments/capture';
import { createRazorpayOrder, createRazorpayRefund, fetchRazorpayPayment, receiptFor } from '@/lib/payments/razorpay';
import { verifyCheckoutSignature } from '@/lib/payments/signature';
import { notifyAdmins } from '@/lib/orders/strikes';
import { upiQrSvg } from '@/lib/upi';
import { nameMatchScore } from './name-match';
import { createUpiIntentValidation, fetchValidation, parseValidation, type RpdValidation } from './razorpayx';

/**
 * Reverse penny drop: the seller pays ₹1 FROM the UPI ID they will receive food payments on, so the platform
 * knows that ID is theirs (and, with RazorpayX, the bank-registered name). The verified VPA must equal the
 * payout VPA; changing the VPA later pauses the kitchen until it is verified again. The ₹1 is refunded
 * automatically (setting). Never stores a full bank account number.
 *
 * Providers (setting `upiVerifyProvider`; MOCK_MODE forces `mock`):
 *   razorpayx_rpd          RazorpayX fund-account validation via a UPI intent link (live only)
 *   razorpay_checkout_vpa  a ₹1 UPI-only order on the normal gateway; the payer VPA is read from the captured payment
 *   mock                   dev and e2e
 */
export const VERIFY_AMOUNT_PAISE = 100;

export type StartResult =
  | { mode: 'mock'; verificationId: number; amountInPaise: number }
  | { mode: 'razorpay'; verificationId: number; amountInPaise: number; keyId: string; razorpayOrderId: string }
  | { mode: 'intent'; verificationId: number; amountInPaise: number; intentUrl: string; qrSvg: string };

export function activeProvider(configured: string): 'razorpayx_rpd' | 'razorpay_checkout_vpa' | 'mock' {
  if (isMockMode()) return 'mock';
  return configured === 'razorpayx_rpd' || configured === 'mock' ? configured : 'razorpay_checkout_vpa';
}

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

async function profileOf(sellerId: number) {
  const db = await getDb();
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  if (!p) throw new ApiError(404, 'Seller profile not found');
  return p;
}

export async function startUpiVerification(sellerId: number): Promise<StartResult> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const profile = await profileOf(sellerId);
  if (!profile.upiVpa || !VPA_RE.test(profile.upiVpa)) throw new ApiError(400, 'Save a valid UPI ID first');
  if (profile.upiVerifyStatus === 'verified' && same(profile.upiVerifiedVpa, profile.upiVpa)) throw new ApiError(409, 'This UPI ID is already verified');
  const provider = activeProvider(settings.upiVerifyProvider);

  const [row] = await db.insert(upiVerifications).values({ sellerId, provider, claimedVpa: profile.upiVpa, status: 'pending' }).returning();
  await db.update(sellerProfiles).set({ upiVerifyStatus: 'pending' }).where(eq(sellerProfiles.userId, sellerId));

  if (provider === 'mock') return { mode: 'mock', verificationId: row.id, amountInPaise: VERIFY_AMOUNT_PAISE };

  if (provider === 'razorpayx_rpd') {
    const v = await createUpiIntentValidation(`pp-upi-${row.id}`);
    if (!v.upiIntentUrl) throw new ApiError(502, 'Could not start the verification — try again');
    await db.update(upiVerifications).set({ validationId: v.id }).where(eq(upiVerifications.id, row.id));
    return { mode: 'intent', verificationId: row.id, amountInPaise: VERIFY_AMOUNT_PAISE, intentUrl: v.upiIntentUrl, qrSvg: await upiQrSvg(v.upiIntentUrl) };
  }

  const rz = await createRazorpayOrder({ amountInPaise: VERIFY_AMOUNT_PAISE, receipt: receiptFor('u', row.id), notes: { purpose: 'upi_verification', verificationId: String(row.id), sellerId: String(sellerId) } });
  await db.update(upiVerifications).set({ razorpayOrderId: rz.id }).where(eq(upiVerifications.id, row.id));
  if (!rz.keyId) return { mode: 'mock', verificationId: row.id, amountInPaise: VERIFY_AMOUNT_PAISE };
  return { mode: 'razorpay', verificationId: row.id, amountInPaise: VERIFY_AMOUNT_PAISE, keyId: rz.keyId, razorpayOrderId: rz.id };
}

type Outcome = { verifiedVpa: string | null; registeredName?: string | null; maskedAccount?: string | null; ifsc?: string | null; bankName?: string | null; paymentId?: string | null };

/**
 * Applies a provider result: the paying VPA must equal the payout VPA. A name score below the setting FLAGS the
 * kitchen for admin review (never an auto-reject). Idempotent: only a pending verification can be finalised.
 */
export async function finalizeVerification(verificationId: number, out: Outcome): Promise<typeof upiVerifications.$inferSelect> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const [row] = await db.select().from(upiVerifications).where(eq(upiVerifications.id, verificationId));
  if (!row) throw new ApiError(404, 'Verification not found');
  if (!['pending', 'needs_manual_review'].includes(row.status)) return row;
  const profile = await profileOf(row.sellerId);

  let status: 'verified' | 'mismatch' | 'needs_manual_review';
  if (!out.verifiedVpa) status = 'needs_manual_review';
  else if (!same(out.verifiedVpa, row.claimedVpa) || !same(row.claimedVpa, profile.upiVpa)) status = 'mismatch';
  else status = 'verified';

  const score = out.registeredName && profile.panNameOnCard ? nameMatchScore(out.registeredName, profile.panNameOnCard) : null;
  const [updated] = await db
    .update(upiVerifications)
    .set({
      status,
      verifiedVpa: out.verifiedVpa ?? null,
      registeredName: out.registeredName ?? null,
      nameMatchScore: score,
      maskedAccount: out.maskedAccount ?? null,
      ifsc: out.ifsc ?? null,
      bankName: out.bankName ?? null,
      razorpayPaymentId: out.paymentId ?? row.razorpayPaymentId,
      completedAt: status === 'needs_manual_review' ? null : new Date(),
    })
    .where(and(eq(upiVerifications.id, verificationId), eq(upiVerifications.status, row.status)))
    .returning();
  if (!updated) return row;

  if (status === 'verified') {
    await db
      .update(sellerProfiles)
      .set({
        upiVerifyStatus: 'verified',
        upiVerifiedVpa: out.verifiedVpa,
        // The name shown to buyers before they pay: bank-registered when the provider returns it, else the PAN name.
        upiVerifiedName: out.registeredName ?? profile.panNameOnCard ?? profile.legalName ?? profile.upiName ?? profile.kitchenName,
        upiVerifiedAt: new Date(),
        upiNameMatchScore: score,
      })
      .where(eq(sellerProfiles.userId, row.sellerId));
    await notify(row.sellerId, 'UPI ID verified ✅', 'Your UPI ID is confirmed. Buyers will pay you at the door on this ID.', '/seller/payment-details');
    if (score != null && score < settings.upiNameMatchMinScore) {
      await notifyAdmins('UPI name needs a look', `Kitchen #${row.sellerId}: the UPI name matched the PAN name at only ${score}/100.`, `/admin/kitchens/${row.sellerId}`);
    }
    await maybeRefund(row.id, row.provider, out.paymentId ?? row.razorpayPaymentId);
  } else if (status === 'mismatch') {
    await db.update(sellerProfiles).set({ upiVerifyStatus: 'mismatch', upiVerifiedVpa: null, upiVerifiedAt: null }).where(eq(sellerProfiles.userId, row.sellerId));
    await notify(row.sellerId, 'UPI ID did not match', 'The ₹1 was paid from a different UPI ID. Pay from the same ID you entered, or correct it.', '/seller/payment-details');
  } else {
    await db.update(sellerProfiles).set({ upiVerifyStatus: 'needs_manual_review' }).where(eq(sellerProfiles.userId, row.sellerId));
    await notify(row.sellerId, 'Upload a screenshot of the ₹1 payment', 'We could not read your UPI ID automatically. Upload a screenshot showing the debit and your UPI ID; an admin will confirm it.', '/seller/payment-details');
    await notifyAdmins('UPI verification needs manual review', `Kitchen #${row.sellerId}`, '/admin/kitchens/requests');
  }
  return updated;
}

async function maybeRefund(verificationId: number, provider: string, paymentId: string | null | undefined) {
  const settings = await getPlatformSettings();
  if (!settings.upiVerifyRefund || provider === 'razorpayx_rpd') return; // an RPD ₹1 is returned by the gateway itself
  const db = await getDb();
  try {
    const r = await createRazorpayRefund({ paymentId: paymentId ?? `pay_MOCKUPI${verificationId}`, amountInPaise: VERIFY_AMOUNT_PAISE, notes: { purpose: 'upi_verification_refund' } });
    await db.update(upiVerifications).set({ refundId: r.id }).where(eq(upiVerifications.id, verificationId));
  } catch (e) {
    log.error('upi_verify.refund_failed', { verificationId, err: e });
  }
}

/** Checkout success callback for razorpay_checkout_vpa: signature, captured ₹1, then read the payer VPA. */
export async function completeCheckoutVerification(input: { sellerId: number; verificationId: number; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
  const db = await getDb();
  const [row] = await db.select().from(upiVerifications).where(eq(upiVerifications.id, input.verificationId));
  if (!row || row.sellerId !== input.sellerId || row.razorpayOrderId !== input.razorpay_order_id) throw new ApiError(400, 'Verification failed');
  if (!verifyCheckoutSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)) throw new ApiError(400, 'Payment signature verification failed');
  const rp = await ensureCaptured({ paymentId: input.razorpay_payment_id, razorpayOrderId: input.razorpay_order_id, amountInPaise: VERIFY_AMOUNT_PAISE });
  const full = await fetchRazorpayPayment(rp.id);
  const vpa = full.vpa ?? full.upi?.vpa ?? null;
  return finalizeVerification(row.id, { verifiedVpa: vpa, paymentId: rp.id });
}

/** MOCK_MODE: the fake ₹1 sheet. Success reports the claimed VPA as the payer. */
export async function completeMockVerification(sellerId: number, verificationId: number, outcome: 'success' | 'failure' | 'other_vpa' | 'unreadable') {
  if (!isMockMode()) throw new ApiError(403, 'Mock verification is disabled in live mode');
  const db = await getDb();
  const [row] = await db.select().from(upiVerifications).where(eq(upiVerifications.id, verificationId));
  if (!row || row.sellerId !== sellerId) throw new ApiError(404, 'Verification not found');
  if (outcome === 'failure') {
    await db.update(upiVerifications).set({ status: 'failed', completedAt: new Date() }).where(and(eq(upiVerifications.id, verificationId), eq(upiVerifications.status, 'pending')));
    await db.update(sellerProfiles).set({ upiVerifyStatus: 'unverified' }).where(eq(sellerProfiles.userId, sellerId));
    return { ...row, status: 'failed' };
  }
  const profile = await profileOf(sellerId);
  return finalizeVerification(verificationId, {
    verifiedVpa: outcome === 'other_vpa' ? 'someone.else@okbank' : outcome === 'unreadable' ? null : row.claimedVpa,
    registeredName: outcome === 'success' ? (profile.legalName ?? profile.upiName ?? profile.kitchenName).toUpperCase() : null,
    maskedAccount: '••••1234',
    ifsc: 'MOCK0000001',
    bankName: 'Mock Bank',
    paymentId: `pay_MOCKUPI${verificationId}`,
  });
}

/** razorpayx_rpd: webhook (`fund_account.validation.completed|failed`) or a poll. */
export async function completeRpdValidation(v: RpdValidation) {
  const db = await getDb();
  const [row] = await db.select().from(upiVerifications).where(eq(upiVerifications.validationId, v.id));
  if (!row) return null;
  if (v.status === 'failed') {
    await db.update(upiVerifications).set({ status: 'failed', completedAt: new Date() }).where(and(eq(upiVerifications.id, row.id), eq(upiVerifications.status, 'pending')));
    await db.update(sellerProfiles).set({ upiVerifyStatus: 'unverified' }).where(eq(sellerProfiles.userId, row.sellerId));
    return null;
  }
  if (v.status !== 'completed') return null;
  return finalizeVerification(row.id, { verifiedVpa: v.vpa, registeredName: v.registeredName, maskedAccount: v.maskedAccount, ifsc: v.ifsc, bankName: v.bankName });
}

export async function pollRpdVerification(sellerId: number, verificationId: number) {
  const db = await getDb();
  const [row] = await db.select().from(upiVerifications).where(eq(upiVerifications.id, verificationId));
  if (!row || row.sellerId !== sellerId || !row.validationId) throw new ApiError(404, 'Verification not found');
  if (row.status !== 'pending') return row;
  const v = await fetchValidation(row.validationId);
  return (await completeRpdValidation(v)) ?? row;
}

export { parseValidation };

/** The seller uploads a screenshot of the ₹1 debit when the VPA could not be read automatically. */
export async function attachEvidence(sellerId: number, verificationId: number, fileKey: string) {
  const db = await getDb();
  const [row] = await db.select().from(upiVerifications).where(eq(upiVerifications.id, verificationId));
  if (!row || row.sellerId !== sellerId) throw new ApiError(404, 'Verification not found');
  if (row.status !== 'needs_manual_review') throw new ApiError(409, 'No screenshot is needed for this verification');
  await db.update(upiVerifications).set({ evidenceFileKey: fileKey }).where(eq(upiVerifications.id, verificationId));
  await notifyAdmins('UPI screenshot uploaded', `Kitchen #${sellerId} uploaded the ₹1 screenshot.`, `/admin/kitchens/${sellerId}`);
}

/** Admin decides a needs_manual_review verification (screenshot shows the VPA) or overrides a flag. */
export async function adminResolveVerification(verificationId: number, adminId: number, decision: 'approve' | 'reject', note?: string) {
  const db = await getDb();
  const [row] = await db.select().from(upiVerifications).where(eq(upiVerifications.id, verificationId));
  if (!row) throw new ApiError(404, 'Verification not found');
  if (row.status !== 'needs_manual_review') throw new ApiError(409, 'This verification is not waiting for review');
  const profile = await profileOf(row.sellerId);
  if (decision === 'approve') {
    if (!same(row.claimedVpa, profile.upiVpa)) throw new ApiError(409, 'The kitchen changed its UPI ID since this check');
    await db.update(upiVerifications).set({ status: 'verified', verifiedVpa: row.claimedVpa, note: `Approved by admin ${adminId}${note ? `: ${note}` : ''}`, completedAt: new Date() }).where(eq(upiVerifications.id, verificationId));
    await db
      .update(sellerProfiles)
      .set({ upiVerifyStatus: 'verified', upiVerifiedVpa: row.claimedVpa, upiVerifiedName: profile.panNameOnCard ?? profile.legalName ?? profile.upiName ?? profile.kitchenName, upiVerifiedAt: new Date() })
      .where(eq(sellerProfiles.userId, row.sellerId));
    await notify(row.sellerId, 'UPI ID verified ✅', 'An admin confirmed your UPI ID.', '/seller/payment-details');
  } else {
    await db.update(upiVerifications).set({ status: 'failed', note: `Rejected by admin ${adminId}${note ? `: ${note}` : ''}`, completedAt: new Date() }).where(eq(upiVerifications.id, verificationId));
    await db.update(sellerProfiles).set({ upiVerifyStatus: 'unverified' }).where(eq(sellerProfiles.userId, row.sellerId));
    await notify(row.sellerId, 'UPI verification not accepted', note ?? 'Please repeat the ₹1 check.', '/seller/payment-details');
  }
}

export async function latestVerification(sellerId: number) {
  const db = await getDb();
  const [row] = await db.select().from(upiVerifications).where(eq(upiVerifications.sellerId, sellerId)).orderBy(desc(upiVerifications.id)).limit(1);
  return row ?? null;
}

/** Called whenever the payout UPI ID is edited: a different ID is unverified until the ₹1 check is repeated. */
export async function onUpiIdChanged(sellerId: number, newVpa: string | null): Promise<boolean> {
  const db = await getDb();
  const p = await profileOf(sellerId);
  if (same(p.upiVerifiedVpa, newVpa) && p.upiVerifyStatus === 'verified') return false;
  await db.update(sellerProfiles).set({ upiVpa: newVpa, upiVerifyStatus: 'unverified', upiVerifiedVpa: null, upiVerifiedName: null, upiVerifiedAt: null, upiNameMatchScore: null }).where(eq(sellerProfiles.userId, sellerId));
  if (p.upiVerifyStatus === 'verified') {
    await notify(sellerId, 'Your kitchen is paused', 'You changed your UPI ID. Verify the new one with a ₹1 payment to resume taking orders.', '/seller/payment-details');
  }
  return true;
}
