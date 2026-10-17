import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { getPlatformSettings, setPlatformSetting } from '@/lib/db/platform';
import { fssaiApplications, listings, sellerProfiles, societies, users } from '@/lib/db/schema';
import { kitchenGate } from '@/lib/kitchen/gate';
import { DELIST_CATEGORIES, setDishVisibility, transitionKitchen, type KitchenAction } from '@/lib/kitchen/state';
import { adminSend } from '@/lib/messaging/admin-threads';
import { sellerSubscriptions } from '@/lib/subscriptions/queries';
import { daysLeft, effectiveStatus } from '@/lib/subscriptions/status';

export const dynamic = 'force-dynamic';

/** Everything an admin needs to verify a kitchen. Viewing is audit-logged (it exposes FSSAI documents). */
export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  const admin = await requireSession(['admin']);
  const id = Number(params.id);
  const db = await getDb();
  const [row] = await db
    .select({ p: sellerProfiles, u: users, s: societies })
    .from(sellerProfiles)
    .innerJoin(users, eq(sellerProfiles.userId, users.id))
    .leftJoin(societies, eq(users.societyId, societies.id))
    .where(eq(sellerProfiles.userId, id));
  if (!row) throw new ApiError(404, 'Kitchen not found');
  const [applications, dishes, subs, settings, gate] = await Promise.all([
    db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, id)).orderBy(desc(fssaiApplications.createdAt)),
    db.select().from(listings).where(eq(listings.sellerId, id)).orderBy(desc(listings.id)),
    sellerSubscriptions(id),
    getPlatformSettings(),
    kitchenGate(id),
  ]);
  await recordAudit({ actorId: admin.uid, action: 'kitchen.view', targetType: 'kitchen', targetId: id });
  const now = new Date();
  return ok({
    kitchen: {
      ...row.p,
      owner: { id: row.u.id, name: row.u.name, phone: row.u.phone, email: row.u.email, emailVerified: !!row.u.emailVerifiedAt, blocked: !!row.u.blockedAt },
      society: row.s ? { id: row.s.id, name: row.s.name } : null,
    },
    applications,
    dishes,
    subscriptions: subs.map((s) => ({ ...s, effectiveStatus: effectiveStatus(s, now, settings.subscriptionGraceDays) })),
    subscriptionDaysLeft: daysLeft(subs, now),
    gate: { ok: gate.ok, checks: gate.checks, reasons: gate.reasons },
    isFeatured: settings.featuredSellerId === String(id),
  });
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('request_changes'), reason: z.string().trim().min(1, 'A reason is required').max(1000) }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(1, 'A reason is required').max(1000) }),
  z.object({ action: z.literal('delist'), category: z.enum(DELIST_CATEGORIES), reason: z.string().trim().min(1, 'A note is required').max(1000) }),
  z.object({ action: z.literal('relist') }),
  z.object({ action: z.literal('feature') }),
  z.object({ action: z.literal('unfeature') }),
  z.object({ action: z.literal('message'), subject: z.string().trim().max(200).optional(), body: z.string().trim().min(1, 'Write a message').max(4000), attachments: z.array(z.object({ url: z.string(), name: z.string() })).max(5).optional() }),
  z.object({ action: z.literal('hide_dish'), dishId: z.number().int(), category: z.enum(DELIST_CATEGORIES), reason: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal('unhide_dish'), dishId: z.number().int() }),
]);

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  const id = Number(params.id);
  const parsed = actionSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const a = parsed.data;
  const actor = { id: admin.uid, role: 'admin' as const };
  switch (a.action) {
    case 'approve':
    case 'relist':
      return ok({ state: await transitionKitchen(id, a.action as KitchenAction, actor) });
    case 'request_changes':
    case 'reject':
      return ok({ state: await transitionKitchen(id, a.action, actor, { reason: a.reason }) });
    case 'delist':
      return ok({ state: await transitionKitchen(id, 'delist', actor, { reason: a.reason, category: a.category }) });
    case 'feature':
    case 'unfeature':
      await setPlatformSetting('featuredSellerId', a.action === 'feature' ? String(id) : '');
      await recordAudit({ actorId: admin.uid, action: `kitchen.${a.action}`, targetType: 'kitchen', targetId: id });
      return ok({ ok: true });
    case 'message':
      return ok(await adminSend({ adminId: admin.uid, sellerId: id, subject: a.subject, body: a.body, attachments: a.attachments }));
    case 'hide_dish':
      await setDishVisibility(a.dishId, 'hide', admin.uid, { category: a.category, reason: a.reason });
      return ok({ ok: true });
    case 'unhide_dish':
      await setDishVisibility(a.dishId, 'unhide', admin.uid);
      return ok({ ok: true });
  }
});
