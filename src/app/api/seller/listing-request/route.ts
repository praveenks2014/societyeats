import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { kitchenChecklist } from '@/lib/kitchen/checklist';
import { transitionKitchen } from '@/lib/kitchen/state';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const c = await kitchenChecklist(session.uid);
  if (!c) throw new ApiError(404, 'Seller profile not found');
  return ok({ items: c.items, requestReady: c.requestReady, state: c.state, reviewNote: c.reviewNote, live: c.gate.ok, gateReasons: c.gate.reasons });
});

/** Submit (or resubmit after "changes requested") the listing request for admin review. */
export const POST = api(async () => {
  const session = await requireSession(['seller']);
  const c = await kitchenChecklist(session.uid);
  if (!c) throw new ApiError(404, 'Seller profile not found');
  if (!c.requestReady) {
    const missing = c.items.slice(0, 5).filter((i) => !i.done).map((i) => i.label);
    throw new ApiError(400, `Finish these first: ${missing.join('; ')}`);
  }
  const to = await transitionKitchen(session.uid, 'submit', { id: session.uid, role: 'seller' });
  const db = await getDb();
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  for (const a of admins) await notify(a.id, 'New kitchen listing request', 'A kitchen is waiting for review.', '/admin/kitchens/requests');
  return ok({ ok: true, state: to });
});
