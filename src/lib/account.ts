import crypto from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import {
  chatReads, complaints, consents, emailOutbox, emailTokens, favourites, grievances, listings, loginCodes, notifications, orderItems, orderMessages, orders, pushSubscriptions,
  reviews, sellerProfiles, sessions, societyMemberships, strikes, userBlocks, users, kitchenSubscriptions,
} from '@/lib/db/schema';
import { ACTIVE_STATES, type OrderStatus } from '@/lib/orders/state';

/** "Download my data" (DPDP right of access): everything we hold about the user, as JSON. Secrets (password hash, 2FA, PAN ciphertext) are never included. */
export async function exportUserData(userId: number) {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new ApiError(404, 'Account not found');
  const myOrders = await db.select().from(orders).where(or(eq(orders.buyerId, userId), eq(orders.sellerId, userId)));
  const ids = myOrders.map((o) => o.id);
  const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, userId));
  const { passwordHash, totpSecretEnc, totpRecoveryHashesJson, ...safeUser } = u;
  void passwordHash; void totpSecretEnc; void totpRecoveryHashesJson;
  const safeProfile = profile ? (({ panEnc, ...rest }) => { void panEnc; return rest; })(profile) : null;
  return {
    exportedAt: new Date().toISOString(),
    account: safeUser,
    sellerProfile: safeProfile,
    memberships: await db.select().from(societyMemberships).where(eq(societyMemberships.userId, userId)),
    consents: await db.select().from(consents).where(eq(consents.userId, userId)),
    orders: myOrders.map(({ sellerVpaSnapshot, sellerRegisteredNameSnapshot, otpCode, ...o }) => { void sellerVpaSnapshot; void sellerRegisteredNameSnapshot; void otpCode; return o; }),
    orderItems: ids.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids)) : [],
    messagesSent: await db.select({ orderId: orderMessages.orderId, body: orderMessages.body, createdAt: orderMessages.createdAt }).from(orderMessages).where(eq(orderMessages.senderId, userId)),
    reviews: await db.select().from(reviews).where(eq(reviews.buyerId, userId)),
    complaints: await db.select().from(complaints).where(or(eq(complaints.buyerId, userId), eq(complaints.sellerId, userId))),
    grievances: await db.select().from(grievances).where(eq(grievances.raisedById, userId)),
    strikes: await db.select().from(strikes).where(eq(strikes.userId, userId)),
    notifications: await db.select().from(notifications).where(eq(notifications.userId, userId)),
    favourites: await db.select().from(favourites).where(eq(favourites.userId, userId)),
    listings: profile ? await db.select().from(listings).where(eq(listings.sellerId, userId)) : [],
    subscriptions: profile ? await db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.sellerId, userId)) : [],
  };
}

export async function openOrderCount(userId: number): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ id: orders.id, status: orders.status }).from(orders).where(or(eq(orders.buyerId, userId), eq(orders.sellerId, userId)));
  return rows.filter((r) => ACTIVE_STATES.includes(r.status as OrderStatus)).length;
}

/**
 * "Delete my account": allowed once no order is open. Personal data is anonymised in place; order, payment and tax records the
 * law requires us to keep stay, with their personal fields pseudonymised. The user row survives as `Deleted user` so
 * those records keep a valid reference.
 */
export async function deleteAccount(userId: number): Promise<void> {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new ApiError(404, 'Account not found');
  if (u.anonymizedAt) throw new ApiError(409, 'This account is already deleted');
  if ((await openOrderCount(userId)) > 0) throw new ApiError(409, 'You still have an open order. Finish or cancel it, then delete your account.');
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(users).set({
      name: 'Deleted user', email: null, emailVerifiedAt: null, phone: `x${userId}`.slice(0, 15), passwordHash: crypto.randomBytes(24).toString('hex'),
      totpSecretEnc: null, totpEnabledAt: null, totpRecoveryHashesJson: null, googleSub: null, referredByUserId: null, referralCode: null,
      lat: null, lng: null, societyId: null, blockedAt: now, anonymizedAt: now, deletionRequestedAt: now,
    }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(societyMemberships).where(eq(societyMemberships.userId, userId));
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    await tx.delete(favourites).where(eq(favourites.userId, userId));
    await tx.delete(emailTokens).where(eq(emailTokens.userId, userId));
    await tx.delete(emailOutbox).where(eq(emailOutbox.userId, userId));
    await tx.delete(notifications).where(eq(notifications.userId, userId));
    await tx.delete(userBlocks).where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
    await tx.delete(chatReads).where(eq(chatReads.userId, userId));
    if (u.email) await tx.delete(loginCodes).where(eq(loginCodes.email, u.email));
    await tx.update(orderMessages).set({ body: '[deleted]', imageKey: null }).where(eq(orderMessages.senderId, userId));
    await tx.update(orders).set({ deliveryAddressJson: null, buyerNote: null }).where(eq(orders.buyerId, userId));
    await tx.update(sellerProfiles).set({
      kitchenName: 'Deleted kitchen', bio: null, legalName: null, displayName: null, panEnc: null, panMasked: null, panNameOnCard: null, panVerifyJson: null, gstin: null,
      upiVpa: null, upiName: null, upiVerifiedVpa: null, upiVerifiedName: null, upiVerifyStatus: 'unverified', tower: null, kitchenPhotosJson: null, kitchenVideoUrl: null,
      pickupInstructions: null, listingState: 'delisted', isApproved: false,
    }).where(eq(sellerProfiles.userId, userId));
    await tx.update(listings).set({ isActive: false, moderationStatus: 'hidden', photoUrl: null, photosJson: null }).where(eq(listings.sellerId, userId));
  });
  await recordAudit({ actorId: userId, action: 'account.deleted', targetType: 'user', targetId: userId });
}
