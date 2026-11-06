import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { assertSellerAccess, activeMembership } from '@/lib/access';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles, societyMemberships } from '@/lib/db/schema';
import { recordConsent } from '@/lib/consent';
import { AGREEMENT_VERSION, FOOD_MARKS, HYGIENE_ITEMS, MAX_KITCHEN_PHOTOS, MIN_KITCHEN_PHOTOS, WEEKDAYS } from '@/lib/kitchen/onboarding';
import { encryptPan, isValidPan, maskPan, verifyPan } from '@/lib/pan';
import { nameMatchScore } from '@/lib/upi-verify/name-match';

export const dynamic = 'force-dynamic';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const urlList = z.array(z.string().max(300)).max(MAX_KITCHEN_PHOTOS);

const steps = {
  about: z.object({
    legalName: z.string().trim().min(3, 'Enter your name as it appears on your PAN').max(160),
    displayName: z.string().trim().min(2).max(120),
    kitchenName: z.string().trim().min(2).max(160),
    languages: z.array(z.string().trim().max(30)).max(8).optional(),
    tower: z.string().trim().max(40).optional(),
    flat: z.string().trim().max(20).optional(),
  }),
  kitchen: z.object({
    cuisines: z.array(z.string().trim().max(40)).min(1, 'Pick at least one cuisine').max(6),
    foodMark: z.enum(FOOD_MARKS.map((f) => f.value) as [string, ...string[]]),
    cookingDays: z.array(z.enum(WEEKDAYS)).min(1, 'Pick the days you cook'),
    cookingHours: z.string().trim().max(120).optional(),
    maxOrdersPerDay: z.number().int().min(1).max(100),
    minOrderPaise: z.number().int().min(0).max(500_000),
    offersSelfPickup: z.boolean(),
    offersSellerDelivery: z.boolean(),
    deliveryRadiusKm: z.number().min(0.1).max(10).optional(),
    pickupInstructions: z.string().trim().max(300).optional(),
    photos: urlList,
  }),
  hygiene: z.object({ declared: z.array(z.string()).min(1) }),
  tax: z.object({
    pan: z.string().trim(),
    gstin: z.string().trim().toUpperCase().optional().or(z.literal('')),
  }),
  agreement: z.object({ accept: z.literal(true, { error: 'Please accept the kitchen agreement' }), version: z.string() }),
} as const;

/** PAN is never returned: only the masked form and the name on the card. */
function view(p: typeof sellerProfiles.$inferSelect, memberOk: boolean) {
  return {
    kitchenName: p.kitchenName,
    legalName: p.legalName,
    displayName: p.displayName,
    languages: p.languagesJson ?? [],
    tower: p.tower,
    cuisines: p.cuisinesJson ?? [],
    foodMark: p.foodMark,
    cookingDays: p.cookingDaysJson ?? [],
    cookingHours: p.cookingHoursText,
    maxOrdersPerDay: p.maxOrdersPerDay,
    minOrderPaise: p.minOrderPaise,
    offersSelfPickup: p.offersSelfPickup,
    offersSellerDelivery: p.offersSellerDelivery,
    deliveryRadiusKm: p.sellerDeliveryRadiusKm,
    pickupInstructions: p.pickupInstructions,
    photos: p.kitchenPhotosJson ?? [],
    hygiene: p.hygieneDeclarationJson ?? {},
    panMasked: p.panMasked,
    panNameOnCard: p.panNameOnCard,
    panStatus: p.panVerifyJson?.status ?? null,
    gstin: p.gstin,
    agreementVersion: p.agreementVersion,
    currentAgreementVersion: AGREEMENT_VERSION,
    memberOk,
    hygieneItems: HYGIENE_ITEMS,
    minPhotos: MIN_KITCHEN_PHOTOS,
    maxPhotos: MAX_KITCHEN_PHOTOS,
    upiVerifyStatus: p.upiVerifyStatus,
  };
}

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
  if (!p) throw new ApiError(404, 'Seller profile not found');
  return ok(view(p, !!(await activeMembership(session.uid))));
});

/** One wizard step at a time: `{ step, data }`. Each save is independent, so the wizard is resumable. */
export const PATCH = api(async (req) => {
  const session = await requireSession(['seller']);
  await assertSellerAccess(session.uid);
  const body = await readJson<{ step: keyof typeof steps; data: unknown }>(req);
  const schema = steps[body.step];
  if (!schema) throw new ApiError(400, 'Unknown step');
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const db = await getDb();
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
  if (!p) throw new ApiError(404, 'Seller profile not found');
  const patch: Partial<typeof sellerProfiles.$inferInsert> = {};
  const now = new Date();

  if (body.step === 'about') {
    const d = parsed.data as z.infer<typeof steps.about>;
    Object.assign(patch, { legalName: d.legalName, displayName: d.displayName, kitchenName: d.kitchenName, languagesJson: d.languages ?? [], tower: d.tower || p.tower });
    if (d.tower || d.flat) await db.update(societyMemberships).set({ tower: d.tower || null, flat: d.flat || null }).where(eq(societyMemberships.userId, session.uid));
  } else if (body.step === 'kitchen') {
    const d = parsed.data as z.infer<typeof steps.kitchen>;
    if (!d.offersSelfPickup && !d.offersSellerDelivery) throw new ApiError(400, 'Offer pickup, delivery or both');
    Object.assign(patch, {
      cuisinesJson: d.cuisines, foodMark: d.foodMark, vegOnly: d.foodMark === 'veg', cookingDaysJson: d.cookingDays, cookingHoursText: d.cookingHours || null,
      maxOrdersPerDay: d.maxOrdersPerDay, minOrderPaise: d.minOrderPaise, offersSelfPickup: d.offersSelfPickup, offersSellerDelivery: d.offersSellerDelivery,
      sellerDeliveryRadiusKm: d.deliveryRadiusKm ?? p.sellerDeliveryRadiusKm, pickupInstructions: d.pickupInstructions || null, kitchenPhotosJson: d.photos,
    });
  } else if (body.step === 'hygiene') {
    const d = parsed.data as z.infer<typeof steps.hygiene>;
    const known = new Set<string>(HYGIENE_ITEMS.map((i) => i.key));
    const decl: Record<string, string> = { ...(p.hygieneDeclarationJson ?? {}) };
    for (const key of d.declared) if (known.has(key)) decl[key] = decl[key] ?? now.toISOString();
    for (const key of Object.keys(decl)) if (!d.declared.includes(key)) delete decl[key];
    Object.assign(patch, { hygieneDeclarationJson: decl });
  } else if (body.step === 'tax') {
    const d = parsed.data as z.infer<typeof steps.tax>;
    if (!isValidPan(d.pan)) throw new ApiError(400, 'Enter a valid PAN, like ABCDE1234F');
    if (d.gstin && !GSTIN_RE.test(d.gstin)) throw new ApiError(400, 'Enter a valid 15-character GSTIN, or leave it blank');
    const legal = p.legalName ?? p.displayName ?? p.kitchenName;
    const v = await verifyPan(d.pan, legal);
    if (v.status === 'invalid') throw new ApiError(400, 'That PAN is not valid');
    Object.assign(patch, {
      panEnc: encryptPan(d.pan), panMasked: maskPan(d.pan), panNameOnCard: v.nameOnPan ?? legal, gstin: d.gstin || null,
      panVerifyJson: { status: v.status, nameMatchScore: nameMatchScore(v.nameOnPan ?? legal, legal), checkedAt: now.toISOString() },
    });
  } else if (body.step === 'agreement') {
    const d = parsed.data as z.infer<typeof steps.agreement>;
    if (d.version !== AGREEMENT_VERSION) throw new ApiError(409, 'The agreement was updated — reload and read the latest version');
    Object.assign(patch, { agreementVersion: AGREEMENT_VERSION, agreementAcceptedAt: now });
    await recordConsent(session.uid, 'kitchen_terms', AGREEMENT_VERSION, req.headers.get('x-forwarded-for')?.split(',')[0]?.trim());
  }
  await db.update(sellerProfiles).set(patch).where(eq(sellerProfiles.userId, session.uid));
  const [after] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
  return ok(view(after, !!(await activeMembership(session.uid))));
});

