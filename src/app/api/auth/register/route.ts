import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { createSessionCookie, hashPassword } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles, societies, subscriptions, users } from '@/lib/db/schema';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type Body = {
  phone: string;
  name: string;
  password: string;
  role?: 'buyer' | 'seller';
  societyId?: number;
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

  let lat: number | null = null;
  let lng: number | null = null;
  if (body.societyId) {
    const [soc] = await db.select().from(societies).where(eq(societies.id, body.societyId));
    if (soc) {
      lat = soc.lat;
      lng = soc.lng;
    }
  }

  const [user] = await db
    .insert(users)
    .values({
      phone,
      name: body.name.trim(),
      passwordHash: await hashPassword(body.password),
      role,
      societyId: body.societyId ?? null,
      lat,
      lng,
    })
    .returning();

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
