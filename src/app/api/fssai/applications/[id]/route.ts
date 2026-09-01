import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fssaiApplications, users } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

/**
 * Self-service counterpart to admin's "Mark filed" (src/app/api/admin/fssai/
 * [id]/route.ts) — only for applications the seller chose to file themselves
 * (DECISIONS.md #62+). Lets them record the FoSCoS reference number they got
 * after filing on the portal, so their compliance page timeline and the
 * admin queue (which then tracks it to grant, same as the facilitator path)
 * stay accurate.
 */
export const PATCH = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['seller']);
  const body = await readJson<{ foscosRefNumber: string }>(req);
  const id = Number(params.id);
  const db = await getDb();
  const [app] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.id, id));
  if (!app) throw new ApiError(404, 'Application not found');
  if (app.sellerId !== session.uid) throw new ApiError(403, 'Not your application');
  if (app.filingMode !== 'self') {
    throw new ApiError(400, 'Only applications you chose to file yourself can be updated this way');
  }
  if (app.status !== 'draft') throw new ApiError(400, 'This application has already been filed');

  const ref = body.foscosRefNumber?.trim();
  if (!ref) throw new ApiError(400, 'Enter your FoSCoS reference number');

  const timeline = [...(app.timelineJson ?? []), { at: new Date().toISOString(), event: `Filed on FoSCoS by you — ref ${ref}` }];
  await db
    .update(fssaiApplications)
    .set({ status: 'filed_on_foscos', foscosRefNumber: ref, timelineJson: timeline, updatedAt: new Date() })
    .where(eq(fssaiApplications.id, id));

  const admins = await db.select().from(users).where(eq(users.role, 'admin'));
  await Promise.all(
    admins.map((a) =>
      notify(
        a.id,
        'Seller self-filed on FoSCoS 📨',
        `${app.applicantName} filed their own application — ref ${ref}. Track it to grant.`,
        '/admin/fssai',
      ),
    ),
  );

  return ok({ ok: true });
});
