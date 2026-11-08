import { and, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { societies, societyMemberships, users } from '@/lib/db/schema';
import { BRAND } from '@/config/brand';

/**
 * Who may browse, order and sell. Pilot v2: invite-only — a user needs an APPROVED membership of an
 * ACTIVE pilot society (when `pilotSocietiesOnly` is on). Email must be verified before ordering,
 * selling or chatting; buyers with an ordering block (strikes) cannot book.
 */
export type AccessUser = typeof users.$inferSelect;

export async function activeMembership(userId: number) {
  const db = await getDb();
  const rows = await db
    .select({ m: societyMemberships, s: societies })
    .from(societyMemberships)
    .innerJoin(societies, eq(societyMemberships.societyId, societies.id))
    .where(and(eq(societyMemberships.userId, userId), eq(societyMemberships.status, 'approved'), eq(societies.isActive, true)));
  return rows[0] ?? null;
}

export async function isPilotMember(userId: number): Promise<boolean> {
  const settings = await getPlatformSettings();
  if (!settings.pilotSocietiesOnly) return true;
  const m = await activeMembership(userId);
  return !!m && m.s.isPilot;
}

export function requireVerifiedEmail(u: Pick<AccessUser, 'emailVerifiedAt'>, what = 'do this'): void {
  if (!u.emailVerifiedAt) throw new ApiError(403, `Please verify your email to ${what}. Check your inbox for the link.`);
}

/** Throws unless this user may place an order right now. */
export async function assertBuyerCanOrder(userId: number, now: Date = new Date()): Promise<AccessUser> {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || u.anonymizedAt) throw new ApiError(404, 'Account not found');
  if (u.blockedAt) throw new ApiError(403, 'Your account is blocked');
  requireVerifiedEmail(u, 'place an order');
  if (u.ordersBlockedUntil && u.ordersBlockedUntil.getTime() > now.getTime()) {
    throw new ApiError(403, `Ordering is paused on your account until ${u.ordersBlockedUntil.toDateString()} after repeated cancelled orders. You can appeal from Help.`);
  }
  if (u.approvalStatus !== 'approved') throw new ApiError(403, 'Your account is waiting for approval from your society admin');
  if (!(await isPilotMember(userId))) throw new ApiError(403, `${BRAND.name} is invite-only during the pilot. Join through your society’s invite link.`);
  return u;
}

/** Throws unless this user may sell: verified email, pilot member, not blocked. */
export async function assertSellerAccess(userId: number): Promise<AccessUser> {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || u.anonymizedAt) throw new ApiError(404, 'Account not found');
  if (u.blockedAt) throw new ApiError(403, 'Your account is blocked');
  requireVerifiedEmail(u, 'set up your kitchen');
  if (!(await isPilotMember(userId))) throw new ApiError(403, `${BRAND.name} is invite-only during the pilot. Join through your society’s invite link.`);
  return u;
}
