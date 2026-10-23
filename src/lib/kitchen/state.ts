import { eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { notifyUser } from '@/lib/db/notify';
import { listings, sellerProfiles } from '@/lib/db/schema';
import { and } from 'drizzle-orm';

/**
 * Kitchen listing state machine.
 *   draft -> submitted -> changes_requested | approved | rejected
 *   changes_requested -> submitted (kitchen resubmits)
 *   approved -> delisted -> approved (relist)
 */
export type KitchenState = 'draft' | 'submitted' | 'changes_requested' | 'approved' | 'rejected' | 'delisted';
export type KitchenAction = 'submit' | 'approve' | 'request_changes' | 'reject' | 'delist' | 'relist';

const TRANSITIONS: Record<KitchenAction, { from: KitchenState[]; to: KitchenState; actor: 'seller' | 'admin'; reasonRequired: boolean }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'submitted', actor: 'seller', reasonRequired: false },
  approve: { from: ['submitted'], to: 'approved', actor: 'admin', reasonRequired: false },
  request_changes: { from: ['submitted'], to: 'changes_requested', actor: 'admin', reasonRequired: true },
  reject: { from: ['submitted'], to: 'rejected', actor: 'admin', reasonRequired: true },
  delist: { from: ['approved'], to: 'delisted', actor: 'admin', reasonRequired: true },
  relist: { from: ['delisted'], to: 'approved', actor: 'admin', reasonRequired: false },
};

export const DELIST_CATEGORIES = ['hygiene', 'complaints', 'fssai', 'misleading_listing', 'non_payment', 'owner_request', 'other'] as const;
export type DelistCategory = (typeof DELIST_CATEGORIES)[number];

/** Pure: is this transition allowed? Returns the target state or throws. */
export function nextKitchenState(from: KitchenState, action: KitchenAction, actor: 'seller' | 'admin', reason?: string): KitchenState {
  const t = TRANSITIONS[action];
  if (!t) throw new ApiError(400, 'Unknown action');
  if (t.actor !== actor) throw new ApiError(403, 'You cannot do that');
  if (!t.from.includes(from)) throw new ApiError(409, `Cannot ${action.replace('_', ' ')} a kitchen that is ${from.replace('_', ' ')}`);
  if (t.reasonRequired && !reason?.trim()) throw new ApiError(400, 'A reason is required');
  return t.to;
}

export async function transitionKitchen(
  sellerId: number,
  action: KitchenAction,
  actor: { id: number; role: 'seller' | 'admin' },
  opts: { reason?: string; category?: string } = {},
): Promise<KitchenState> {
  const db = await getDb();
  const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  if (!profile) throw new ApiError(404, 'Kitchen not found');
  if (actor.role === 'seller' && actor.id !== sellerId) throw new ApiError(403, 'Not your kitchen');
  const to = nextKitchenState(profile.listingState as KitchenState, action, actor.role, opts.reason);
  if (action === 'delist' && !(DELIST_CATEGORIES as readonly string[]).includes(opts.category ?? '')) {
    throw new ApiError(400, 'Choose a reason category');
  }

  await db
    .update(sellerProfiles)
    .set({
      listingState: to,
      isApproved: to === 'approved',
      ...(action === 'submit' ? { listingSubmittedAt: new Date(), listingReviewNote: null } : {}),
      ...(action === 'request_changes' || action === 'reject' ? { listingReviewNote: opts.reason!.trim() } : {}),
      ...(action === 'delist' ? { delistReasonCategory: opts.category, delistedAt: new Date(), listingReviewNote: opts.reason?.trim() ?? null } : {}),
      ...(action === 'relist' || action === 'approve' ? { delistReasonCategory: null, delistedAt: null, listingReviewNote: null } : {}),
    })
    .where(eq(sellerProfiles.userId, sellerId));

  if (actor.role === 'admin') {
    await recordAudit({ actorId: actor.id, action: `kitchen.${action}`, targetType: 'kitchen', targetId: sellerId, meta: { from: profile.listingState, to, reason: opts.reason, category: opts.category } });
    const copy: Record<string, [string, string]> = {
      approve: ['Your kitchen is approved 🎉', 'PadosiPlate approved your listing request. Once your subscription and FSSAI requirement are in place, your dishes are visible to neighbours.'],
      request_changes: ['Changes needed on your listing', `We need a few changes before approving: ${opts.reason}`],
      reject: ['Your listing request was not approved', `Reason: ${opts.reason}`],
      delist: ['Your kitchen has been delisted', `New orders are paused; orders you already accepted can still be completed. Reason (${opts.category}): ${opts.reason ?? ''}`],
      relist: ['Your kitchen is listed again ✅', 'Your kitchen has been relisted — welcome back.'],
    };
    const [title, body] = copy[action];
    await notifyUser(sellerId, title, body, '/seller', { email: true, emailKind: `kitchen_${action}` });
  }
  return to;
}

// ---- delist / relist a single dish (admin) ----
export async function setDishVisibility(
  dishId: number,
  action: 'hide' | 'unhide',
  adminId: number,
  opts: { reason?: string; category?: string } = {},
): Promise<void> {
  const db = await getDb();
  const [dish] = await db.select().from(listings).where(eq(listings.id, dishId));
  if (!dish) throw new ApiError(404, 'Dish not found');
  if (action === 'hide') {
    if (!opts.category || !opts.reason?.trim()) throw new ApiError(400, 'A reason category and note are required');
    await db.update(listings).set({ moderationStatus: 'hidden', moderationReasonCategory: opts.category, moderationNote: opts.reason.trim(), moderatedAt: new Date() }).where(eq(listings.id, dishId));
    await notifyUser(dish.sellerId, `"${dish.title}" was hidden`, `Reason (${opts.category}): ${opts.reason}`, '/seller/listings', { email: true, emailKind: 'dish_hidden' });
  } else {
    if (dish.moderationStatus !== 'hidden') throw new ApiError(409, 'Dish is not hidden');
    await db
      .update(listings)
      .set({ moderationStatus: 'approved', moderationReasonCategory: null, moderationNote: null, moderatedAt: new Date(), approvedSnapshotJson: { title: dish.title, photoUrl: dish.photoUrl, priceInPaise: dish.priceInPaise } })
      .where(and(eq(listings.id, dishId)));
    await notifyUser(dish.sellerId, `"${dish.title}" is visible again`, 'Your dish was relisted.', '/seller/listings', { email: true, emailKind: 'dish_relisted' });
  }
  await recordAudit({ actorId: adminId, action: `dish.${action}`, targetType: 'dish', targetId: dishId, meta: opts });
}
