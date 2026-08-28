import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { orders, reviews, sellerProfiles } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession();
  const { rating, text } = await readJson<{ rating: number; text?: string }>(req);
  const orderId = Number(params.id);
  if (!rating || rating < 1 || rating > 5) throw new ApiError(400, 'Rating must be 1–5');

  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.buyerId !== session.uid) throw new ApiError(404, 'Order not found');
  if (!['delivered', 'picked_up'].includes(order.status)) {
    throw new ApiError(409, 'You can rate after the order is delivered');
  }
  const existing = await db.select().from(reviews).where(eq(reviews.orderId, orderId));
  if (existing.length > 0) throw new ApiError(409, 'Already rated');

  await db.insert(reviews).values({ orderId, buyerId: session.uid, rating, text: text?.trim() });

  // roll the rating into the kitchen's aggregate
  if (order.sellerId) {
    const [profile] = await db
      .select()
      .from(sellerProfiles)
      .where(eq(sellerProfiles.userId, order.sellerId));
    if (profile) {
      const newCount = profile.ratingCount + 1;
      const newRating = (profile.rating * profile.ratingCount + rating) / newCount;
      await db
        .update(sellerProfiles)
        .set({ rating: Math.round(newRating * 10) / 10, ratingCount: newCount })
        .where(eq(sellerProfiles.userId, order.sellerId));
    }
  }
  return ok({ ok: true });
});
