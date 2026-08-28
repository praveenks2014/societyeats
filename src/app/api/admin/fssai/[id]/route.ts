import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

type Body =
  | { action: 'file'; foscosRefNumber: string }
  | { action: 'grant'; licenseNumber: string }
  | { action: 'reject'; reason?: string };

/** Back-office completes the honest FSSAI loop: file on FoSCoS by hand, then record the outcome. */
export const PATCH = api<{ params: { id: string } }>(async (req, { params }) => {
  await requireSession(['admin']);
  const body = await readJson<Body>(req);
  const id = Number(params.id);
  const db = await getDb();
  const [app] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.id, id));
  if (!app) throw new ApiError(404, 'Application not found');

  const timeline = [...(app.timelineJson ?? [])];
  const now = new Date().toISOString();

  if (body.action === 'file') {
    if (!body.foscosRefNumber?.trim()) throw new ApiError(400, 'FoSCoS reference number required');
    timeline.push({ at: now, event: `Filed on FoSCoS — ref ${body.foscosRefNumber.trim()}` });
    await db
      .update(fssaiApplications)
      .set({
        status: 'filed_on_foscos',
        foscosRefNumber: body.foscosRefNumber.trim(),
        timelineJson: timeline,
        updatedAt: new Date(),
      })
      .where(eq(fssaiApplications.id, id));
    await notify(
      app.sellerId,
      'FSSAI application filed on FoSCoS 📨',
      `Reference ${body.foscosRefNumber.trim()}. We'll update you when it's granted.`,
      '/seller/compliance',
    );
  } else if (body.action === 'grant') {
    const license = body.licenseNumber?.replace(/\s/g, '');
    if (!/^\d{14}$/.test(license || '')) throw new ApiError(400, 'Enter the granted 14-digit license number');
    timeline.push({ at: now, event: `License granted — ${license}` });
    await db
      .update(fssaiApplications)
      .set({ status: 'granted', timelineJson: timeline, updatedAt: new Date() })
      .where(eq(fssaiApplications.id, id));
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);
    await db
      .update(sellerProfiles)
      .set({
        fssaiStatus: 'verified',
        fssaiNumber: license,
        fssaiExpiry: expiry.toISOString().slice(0, 10),
      })
      .where(eq(sellerProfiles.userId, app.sellerId));
    await notify(
      app.sellerId,
      'FSSAI license granted! ✅',
      `License ${license} is now on your kitchen. The green badge is live — re-enable any paused dishes.`,
      '/seller/compliance',
    );
  } else if (body.action === 'reject') {
    timeline.push({ at: now, event: `Application rejected${body.reason ? ` — ${body.reason}` : ''}` });
    await db
      .update(fssaiApplications)
      .set({ status: 'rejected', timelineJson: timeline, updatedAt: new Date() })
      .where(eq(fssaiApplications.id, id));
    await db
      .update(sellerProfiles)
      .set({ fssaiStatus: 'unverified' })
      .where(eq(sellerProfiles.userId, app.sellerId));
    await notify(
      app.sellerId,
      'FSSAI application needs attention',
      body.reason || 'Our compliance team could not file this application. Please review and resubmit.',
      '/seller/compliance',
    );
  } else {
    throw new ApiError(400, 'Unknown action');
  }

  return ok({ ok: true });
});
