import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { complaints, orders, users } from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';
import { COMPLAINT_CATEGORIES, type ComplaintCategory } from '@/lib/complaints';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

/**
 * Buyer complaint intake (DECISIONS.md #73+): quality / wrong item / hygiene
 * / not received, with an optional photo, raised within
 * DEFAULTS.complaintWindowHours of delivery/pickup — matches getListingDetail's
 * review gate (only from delivered/picked_up orders) and reuses
 * orders.updatedAt as the "delivered at" timestamp, same as payouts.ts's T+2
 * hold does. One complaint per order (mirrors the review route's "already
 * rated" 409 pattern) — a buyer with more than one issue describes them all
 * in the single free-text field rather than filing several.
 */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession();
  const orderId = Number(params.id);
  const body = await readJson<{ category: ComplaintCategory; description: string; photoUrl?: string }>(req);

  if (!COMPLAINT_CATEGORIES.some((c) => c.value === body.category)) {
    throw new ApiError(400, 'Invalid complaint category');
  }
  if (!body.description?.trim()) throw new ApiError(400, 'Please describe what went wrong');

  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.buyerId !== session.uid) throw new ApiError(404, 'Order not found');
  if (!['delivered', 'picked_up'].includes(order.status)) {
    throw new ApiError(409, 'You can only report an issue after the order is delivered/collected');
  }
  const hoursSince = (Date.now() - order.updatedAt.getTime()) / (60 * 60 * 1000);
  if (hoursSince > DEFAULTS.complaintWindowHours) {
    throw new ApiError(409, `The ${DEFAULTS.complaintWindowHours}h window to report an issue on this order has passed`);
  }

  const existing = await db.select().from(complaints).where(eq(complaints.orderId, orderId));
  if (existing.length > 0) throw new ApiError(409, 'You already reported an issue on this order');

  const [complaint] = await db
    .insert(complaints)
    .values({
      orderId,
      buyerId: session.uid,
      sellerId: order.sellerId,
      category: body.category,
      description: body.description.trim(),
      photoUrl: body.photoUrl?.trim() || null,
    })
    .returning();

  const admins = await db.select().from(users).where(eq(users.role, 'admin'));
  await Promise.all(
    admins.map((a) =>
      notify(a.id, `New complaint on order #${orderId} ⚠️`, `${body.category.replace('_', ' ')} — needs review.`, '/admin/complaints'),
    ),
  );

  return ok({ complaint });
});

/** The buyer's own complaint on this order, if any — for the order page's status card. */
export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  const session = await requireSession();
  const orderId = Number(params.id);
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.buyerId !== session.uid) throw new ApiError(404, 'Order not found');
  const [complaint] = await db.select().from(complaints).where(eq(complaints.orderId, orderId));

  const eligible =
    !complaint &&
    ['delivered', 'picked_up'].includes(order.status) &&
    (Date.now() - order.updatedAt.getTime()) / (60 * 60 * 1000) <= DEFAULTS.complaintWindowHours;

  return ok({ complaint: complaint ?? null, eligible, windowHours: DEFAULTS.complaintWindowHours });
});
