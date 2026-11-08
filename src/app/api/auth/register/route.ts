import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { createSession } from '@/lib/auth';
import { sendVerificationEmail } from '@/lib/auth/mail';
import { hashPassword, validatePassword } from '@/lib/auth/passwords';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { sellerProfiles, societies, users } from '@/lib/db/schema';
import { recordConsent } from '@/lib/consent';
import { currentConsentLabel } from '@/lib/legal/docs';
import { joinSociety } from '@/lib/membership';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { referralCodeFor } from '@/lib/referrals';
import { BRAND } from '@/config/brand';

export const dynamic = 'force-dynamic';

type Body = {
  phone: string;
  email: string;
  name: string;
  password: string;
  role?: 'buyer' | 'seller';
  societyId?: number;
  /** Resolves a society regardless of isLive. */
  inviteCode?: string;
  /** The referrer's own referralCode, if this signup came from a shared link/code. */
  referredByCode?: string;
  kitchenName?: string;
  vegOnly?: boolean;
  bio?: string;
  /** Explicit, never pre-ticked: 18+ and acceptance of the Terms and the Privacy Notice. */
  age18?: boolean;
  acceptTerms?: boolean;
  tower?: string;
  flat?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const POST = api(async (req) => {
  // pre-auth: keyed by IP, throttles automated account-farming
  await rateLimit(`register:${clientIp(req)}`, { limit: 5, windowMs: 10 * 60 * 1000 });
  const body = await readJson<Body>(req);
  const phone = (body.phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new ApiError(400, 'Enter a valid 10-digit Indian mobile number');
  const email = (body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new ApiError(400, 'Enter a valid email address');
  if (!body.name?.trim()) throw new ApiError(400, 'Name is required');
  const pwError = validatePassword(body.password, { phone, email });
  if (pwError) throw new ApiError(400, pwError);
  if (body.age18 !== true) throw new ApiError(400, `You must be 18 or older to use ${BRAND.name}`);
  if (body.acceptTerms !== true) throw new ApiError(400, 'Please accept the Terms and the Privacy Notice to continue');
  const role = body.role === 'seller' ? 'seller' : 'buyer';
  if (role === 'seller' && !body.kitchenName?.trim()) throw new ApiError(400, 'Kitchen name is required');

  const db = await getDb();
  const [byPhone] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone));
  if (byPhone) throw new ApiError(409, 'An account with this phone already exists — log in instead');
  const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (byEmail) throw new ApiError(409, 'An account with this email already exists — log in instead');

  // Every signup must resolve to a society: a live one from the dropdown, or
  // an invite code (which resolves a society regardless of isLive).
  let society: typeof societies.$inferSelect | undefined;
  const inviteCode = body.inviteCode?.trim().toUpperCase();
  if (inviteCode) {
    [society] = await db.select().from(societies).where(eq(societies.inviteCode, inviteCode));
    if (!society || society.isActive === false) throw new ApiError(400, 'Invalid invite code');
  } else if (body.societyId && !(await getPlatformSettings()).pilotSocietiesOnly) {
    [society] = await db.select().from(societies).where(eq(societies.id, body.societyId));
    if (!society?.isLive || society.isActive === false) throw new ApiError(400, 'Select a valid society');
  } else {
    throw new ApiError(400, `${BRAND.name} is invite-only during the pilot — use the invite link from your society’s WhatsApp group`);
  }

  let referredByUserId: number | null = null;
  const referredByCode = body.referredByCode?.trim().toUpperCase();
  if (referredByCode) {
    const [referrer] = await db.select().from(users).where(eq(users.referralCode, referredByCode));
    // An unrecognised code doesn't block signup — it just means no referral credit.
    if (referrer) referredByUserId = referrer.id;
  }

  const [user] = await db
    .insert(users)
    .values({
      phone,
      email,
      name: body.name.trim(),
      passwordHash: await hashPassword(body.password),
      role,
      societyId: society.id,
      lat: society.lat,
      lng: society.lng,
      referredByUserId,
      age18ConfirmedAt: new Date(),
      approvalStatus: 'pending',
    })
    .returning();

  // Consent is recorded with the version accepted, when and from where.
  const ip = clientIp(req);
  await recordConsent(user.id, 'age18', '1', ip);
  await recordConsent(user.id, 'terms', await currentConsentLabel('terms'), ip);
  await recordConsent(user.id, 'privacy', await currentConsentLabel('privacy'), ip);
  // Society membership: automatic for a valid invite link, otherwise it waits for an admin.
  await joinSociety({ userId: user.id, societyId: society.id, tower: body.tower, flat: body.flat, viaInvite: !!inviteCode });

  await db.update(users).set({ referralCode: referralCodeFor(user.id) }).where(eq(users.id, user.id));

  if (role === 'seller') {
    await db.insert(sellerProfiles).values({
      userId: user.id,
      kitchenName: body.kitchenName!.trim(),
      bio: body.bio?.trim(),
      vegOnly: !!body.vegOnly,
    });
  }

  await sendVerificationEmail(user.id);
  await createSession(user.id);
  const [fresh] = await db.select({ approvalStatus: users.approvalStatus }).from(users).where(eq(users.id, user.id));
  return ok({ ok: true, role: user.role, pending: fresh?.approvalStatus === 'pending' });
});
