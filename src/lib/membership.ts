import { and, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { getPlatformSettings } from '@/lib/db/platform';
import { societies, societyMemberships, users } from '@/lib/db/schema';
import { BRAND } from '@/config/brand';

export type MembershipStatus = 'pending' | 'approved' | 'rejected';

/**
 * Joins a user to a society. Residents arriving through a valid invite link are approved automatically when the
 * `membershipAutoApprove` setting is on and the society has not been switched to manual approval; otherwise the
 * membership waits for an admin. `users.societyId` / `approvalStatus` mirror the membership for the rest of the app.
 */
export async function joinSociety(input: { userId: number; societyId: number; tower?: string | null; flat?: string | null; viaInvite: boolean }) {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const [society] = await db.select().from(societies).where(eq(societies.id, input.societyId));
  if (!society || !society.isActive) throw new ApiError(400, 'That society is not available');
  const [existing] = await db.select().from(societyMemberships).where(and(eq(societyMemberships.userId, input.userId), eq(societyMemberships.societyId, input.societyId)));
  if (existing) return existing;
  const auto = input.viaInvite && settings.membershipAutoApprove && !society.requireApproval;
  const status: MembershipStatus = auto ? 'approved' : 'pending';
  const [m] = await db
    .insert(societyMemberships)
    .values({ userId: input.userId, societyId: input.societyId, tower: input.tower?.trim() || null, flat: input.flat?.trim() || null, status, decidedAt: auto ? new Date() : null })
    .returning();
  await db.update(users).set({ societyId: input.societyId, lat: society.lat, lng: society.lng, approvalStatus: status }).where(eq(users.id, input.userId));
  if (!auto) {
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
    for (const a of admins) await notify(a.id, 'New resident waiting for approval', `${society.name}`, '/admin/societies');
  }
  return m;
}

export async function decideMembership(membershipId: number, adminId: number, decision: 'approve' | 'reject') {
  const db = await getDb();
  const [m] = await db.select().from(societyMemberships).where(eq(societyMemberships.id, membershipId));
  if (!m) throw new ApiError(404, 'Membership not found');
  const status: MembershipStatus = decision === 'approve' ? 'approved' : 'rejected';
  await db.update(societyMemberships).set({ status, decidedBy: adminId, decidedAt: new Date() }).where(eq(societyMemberships.id, membershipId));
  await db.update(users).set({ approvalStatus: status }).where(eq(users.id, m.userId));
  await recordAudit({ actorId: adminId, action: `membership.${decision}`, targetType: 'membership', targetId: membershipId, meta: { userId: m.userId, societyId: m.societyId } });
  await notify(m.userId, decision === 'approve' ? `Welcome to your society on ${BRAND.name} 🎉` : 'Your membership was not approved', decision === 'approve' ? 'You can now browse, order and sell.' : 'Contact your society admin if you think this is a mistake.', '/');
  return status;
}

/** Admin removes a member: their membership is deleted and ordering/selling stops (pilot gate). */
export async function removeMember(membershipId: number, adminId: number) {
  const db = await getDb();
  const [m] = await db.select().from(societyMemberships).where(eq(societyMemberships.id, membershipId));
  if (!m) throw new ApiError(404, 'Membership not found');
  await db.delete(societyMemberships).where(eq(societyMemberships.id, membershipId));
  await db.update(users).set({ approvalStatus: 'rejected' }).where(eq(users.id, m.userId));
  await recordAudit({ actorId: adminId, action: 'membership.remove', targetType: 'membership', targetId: membershipId, meta: { userId: m.userId, societyId: m.societyId } });
  await notify(m.userId, 'You were removed from your society', 'Contact your society admin if you think this is a mistake.', '/');
}
