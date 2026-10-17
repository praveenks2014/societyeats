import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { notifyUser } from '@/lib/db/notify';
import { listings } from '@/lib/db/schema';
import { DELIST_CATEGORIES, setDishVisibility } from '@/lib/kitchen/state';

export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(1, 'A reason is required').max(1000) }),
  z.object({ action: z.literal('hide'), category: z.enum(DELIST_CATEGORIES), reason: z.string().trim().min(1, 'A note is required').max(1000) }),
  z.object({ action: z.literal('unhide') }),
]);

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  const id = Number(params.id);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const a = parsed.data;
  const db = await getDb();
  const [dish] = await db.select().from(listings).where(eq(listings.id, id));
  if (!dish) throw new ApiError(404, 'Dish not found');

  if (a.action === 'hide' || a.action === 'unhide') {
    await setDishVisibility(id, a.action, admin.uid, a.action === 'hide' ? { category: a.category, reason: a.reason } : {});
    return ok({ ok: true });
  }
  if (!['pending', 'rejected'].includes(dish.moderationStatus)) throw new ApiError(409, `Dish is already ${dish.moderationStatus}`);
  if (a.action === 'approve') {
    await db
      .update(listings)
      .set({ moderationStatus: 'approved', moderationNote: null, moderationReasonCategory: null, moderatedAt: new Date(), approvedSnapshotJson: { title: dish.title, photoUrl: dish.photoUrl, priceInPaise: dish.priceInPaise } })
      .where(eq(listings.id, id));
    await notifyUser(dish.sellerId, `"${dish.title}" approved ✅`, 'Your dish passed review.', '/seller/listings');
  } else {
    await db.update(listings).set({ moderationStatus: 'rejected', moderationNote: a.reason, moderatedAt: new Date() }).where(eq(listings.id, id));
    await notifyUser(dish.sellerId, `"${dish.title}" needs changes`, `Reason: ${a.reason}`, '/seller/listings', { email: true, emailKind: 'dish_rejected' });
  }
  await recordAudit({ actorId: admin.uid, action: `dish.${a.action}`, targetType: 'dish', targetId: id });
  return ok({ ok: true });
});
