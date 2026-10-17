import { desc, eq } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { orders, reviews, users } from '@/lib/db/schema';
import { buyerHandle } from '@/lib/handles';

export const dynamic = 'force-dynamic';

/** This seller's reviews, newest first, for the reply screen. */
export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const rows = await db
    .select({ review: reviews, buyer: users })
    .from(reviews)
    .innerJoin(orders, eq(reviews.orderId, orders.id))
    .innerJoin(users, eq(reviews.buyerId, users.id))
    .where(eq(orders.sellerId, session.uid))
    .orderBy(desc(reviews.createdAt));

  return ok({
    reviews: rows.map((r) => ({ ...r.review, buyerName: buyerHandle(r.review.orderId, r.review.buyerId) })),
  });
});
