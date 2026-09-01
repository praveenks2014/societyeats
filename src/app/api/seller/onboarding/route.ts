import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles } from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';

export const dynamic = 'force-dynamic';

const MAX_PHOTOS = 6;
const MAX_CUISINES = 6;

type Body = {
  kitchenPhotosJson?: string[];
  kitchenVideoUrl?: string | null;
  cookingSinceYear?: number | null;
  cuisinesJson?: string[];
};

/**
 * Kitchen-profile onboarding (DECISIONS.md #73+): 3 kitchen photos are the
 * only required piece (nudged by seller/layout.tsx's banner, not hard-
 * blocked elsewhere — see decisions log); video, cooking-since year and
 * cuisines are all optional. Kept as its own route/page rather than folded
 * into listings/compliance, matching this app's one-page-per-concern layout
 * (DECISIONS.md #48).
 */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
  if (!profile) throw new ApiError(404, 'Seller profile not found');
  return ok({
    kitchenName: profile.kitchenName,
    fssaiStatus: profile.fssaiStatus,
    fssaiNumber: profile.fssaiNumber,
    kitchenPhotosJson: profile.kitchenPhotosJson ?? [],
    kitchenVideoUrl: profile.kitchenVideoUrl,
    cookingSinceYear: profile.cookingSinceYear,
    cuisinesJson: profile.cuisinesJson ?? [],
    minKitchenPhotosRequired: DEFAULTS.minKitchenPhotosRequired,
  });
});

export const PATCH = api(async (req) => {
  const session = await requireSession(['seller']);
  const body = await readJson<Body>(req);
  const patch: Partial<typeof sellerProfiles.$inferInsert> = {};

  if (body.kitchenPhotosJson !== undefined) {
    if (!Array.isArray(body.kitchenPhotosJson) || body.kitchenPhotosJson.some((u) => typeof u !== 'string')) {
      throw new ApiError(400, 'Invalid kitchen photos');
    }
    patch.kitchenPhotosJson = body.kitchenPhotosJson.slice(0, MAX_PHOTOS);
  }
  if (body.kitchenVideoUrl !== undefined) {
    patch.kitchenVideoUrl = body.kitchenVideoUrl?.trim() || null;
  }
  if (body.cookingSinceYear !== undefined) {
    const y = body.cookingSinceYear;
    if (y !== null && (typeof y !== 'number' || y < 1950 || y > new Date().getFullYear())) {
      throw new ApiError(400, 'Enter a valid year');
    }
    patch.cookingSinceYear = y;
  }
  if (body.cuisinesJson !== undefined) {
    if (!Array.isArray(body.cuisinesJson) || body.cuisinesJson.some((c) => typeof c !== 'string')) {
      throw new ApiError(400, 'Invalid cuisines');
    }
    patch.cuisinesJson = body.cuisinesJson.slice(0, MAX_CUISINES);
  }

  const db = await getDb();
  await db.update(sellerProfiles).set(patch).where(eq(sellerProfiles.userId, session.uid));
  return ok({ ok: true });
});
