import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { orders, reviews } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

/** A seller can reply to a review on their own order exactly once (DECISIONS.md #73+). */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['seller']);
  const { text } = await readJson<{ text: string }>(req);
  if (!text?.trim()) throw new ApiError(400, 'Reply cannot be empty');

  const reviewId = Number(params.id);
  const db = await getDb();
  const [review] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
  if (!review) throw new ApiError(404, 'Review not found');
  const [order] = await db.select().from(orders).where(eq(orders.id, review.orderId));
  if (!order || order.sellerId !== session.uid) throw new ApiError(403, 'Not your review to reply to');
  if (review.sellerReplyText) throw new ApiError(409, 'You already replied to this review');

  await db
    .update(reviews)
    .set({ sellerReplyText: text.trim(), sellerRepliedAt: new Date() })
    .where(eq(reviews.id, reviewId));

  await notify(review.buyerId, 'The kitchen replied to your review 💬', text.trim(), `/orders/${order.id}`);
  return ok({ ok: true });
});
