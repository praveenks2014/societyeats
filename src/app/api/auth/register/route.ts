import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { createSessionCookie, hashPassword } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles, societies, subscriptions, users } from '@/lib/db/schema';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { referralCodeFor } from '@/lib/referrals';

export const dynamic = 'force-dynamic';

type Body = {
  phone: string;
  name: string;
  password: string;
  role?: 'buyer' | 'seller';
  societyId?: number;
  /** Pilot Hardening v2 — Phase 6 (DECISIONS.md #87+): resolves a society regardless of isLive. */
  inviteCode?: string;
  /** The referrer's own referralCode, if this signup came from a shared link/code. */
  referredByCode?: string;
  kitchenName?: string;
  vegOnly?: boolean;
  bio?: string;
};

export const POST = api(async (req) => {
  // pre-auth: keyed by IP, throttles automated account-farming
  rateLimit(`register:${clientIp(req)}`, { limit: 5, windowMs: 10 * 60 * 1000 });
  const body = await readJson<Body>(req);
  const phone = (body.phone || '').replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new ApiError(400, 'Enter a valid 10-digit Indian mobile number');
  if (!body.name?.trim()) throw new ApiError(400, 'Name is required');
  if (!body.password || body.password.length < 6) throw new ApiError(400, 'Password must be at least 6 characters');
  const role = body.role === 'seller' ? 'seller' : 'buyer';
  if (role === 'seller' && !body.kitchenName?.trim()) throw new ApiError(400, 'Kitchen name is required');

  const db = await getDb();
  const existing = await db.select().from(users).where(eq(users.phone, phone));
  if (existing.length > 0) throw new ApiError(409, 'An account with this phone already exists — log in instead');

  // Pilot Hardening v2 — Phase 6 (Society-first launch mechanics,
  // DECISIONS.md #87+): the pilot is one live, publicly-joinable society —
  // every new signup must resolve to a society, either by picking a live
  // one from the dropdown or by entering an invite code (which can resolve
  // a not-yet-public society regardless of isLive). Re-validated here even
  // though the register form only ever shows live societies in its
  // dropdown, matching this app's established "never trust the client for
  // something worth enforcing" pattern (10 km radius, slot caps, etc.).
  let society: typeof societies.$inferSelect | undefined;
  const inviteCode = body.inviteCode?.trim().toUpperCase();
  if (inviteCode) {
    [society] = await db.select().from(societies).where(eq(societies.inviteCode, inviteCode));
    if (!society) throw new ApiError(400, 'Invalid invite code');
  } else if (body.societyId) {
    [society] = await db
      .select()
      .from(societies)
      .where(eq(societies.id, body.societyId));
    if (!society?.isLive) throw new ApiError(400, 'Select a valid society');
  } else {
    throw new ApiError(400, 'Select your society or enter an invite code');
  }

  let referredByUserId: number | null = null;
  const referredByCode = body.referredByCode?.trim().toUpperCase();
  if (referredByCode) {
    const [referrer] = await db.select().from(users).where(eq(users.referralCode, referredByCode));
    // An unrecognised code doesn't block signup — it just means no referral
    // credit will be earned by anyone for this account.
    if (referrer) referredByUserId = referrer.id;
  }

  const [user] = await db
    .insert(users)
    .values({
      phone,
      name: body.name.trim(),
      passwordHash: await hashPassword(body.password),
      role,
      societyId: society.id,
      lat: society.lat,
      lng: society.lng,
      referredByUserId,
    })
    .returning();

  // Derived from the now-known id, so it's unique by construction — no
  // retry-on-conflict loop needed (see src/lib/referrals.ts).
  await db.update(users).set({ referralCode: referralCodeFor(user.id) }).where(eq(users.id, user.id));

  if (role === 'seller') {
    await db.insert(sellerProfiles).values({
      userId: user.id,
      kitchenName: body.kitchenName!.trim(),
      bio: body.bio?.trim(),
      vegOnly: !!body.vegOnly,
    });
    await db.insert(subscriptions).values({ sellerId: user.id, plan: 'free', status: 'active' });
  }

  await createSessionCookie({ uid: user.id, role: user.role, name: user.name, phone: user.phone });
  return ok({ ok: true, role: user.role });
});
