import { eq } from 'drizzle-orm';
import { addMonthsIST, istDateString } from '@/lib/time';
import { recordFunnel } from '@/lib/fssai/funnel';
import { scheduleDocumentDeletion } from '@/lib/fssai/jobs';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { blockFssai, recordInterruption, requestFssaiChanges, unblockFssai } from '@/lib/fssai/admin-actions';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

type Body =
  | { action: 'file'; foscosRefNumber: string }
  | { action: 'grant'; licenseNumber: string }
  | { action: 'reject'; reason?: string }
  | { action: 'sponsor'; sponsoredByPlatform: boolean }
  | { action: 'inspection_ordered'; date?: string; note?: string }
  | { action: 'inadequacy_notice'; date?: string; note?: string }
  | { action: 'request_changes'; note: string }
  | { action: 'block'; reason: string }
  | { action: 'unblock' };

/** Back-office completes the honest FSSAI loop: file on FoSCoS by hand, then record the outcome. */
export const PATCH = api<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin); // every FSSAI decision needs a fresh 2FA check and is audit-logged
  const body = await readJson<Body>(req);
  const id = Number(params.id);
  const db = await getDb();
  const [app] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.id, id));
  if (!app) throw new ApiError(404, 'Application not found');

  if (body.action === 'request_changes') {
    await requestFssaiChanges({ applicationId: id, note: body.note ?? '', adminId: admin.uid });
    return ok({ ok: true });
  }
  if (body.action === 'block') {
    await blockFssai({ sellerId: app.sellerId, reason: body.reason ?? '', adminId: admin.uid });
    return ok({ ok: true });
  }
  if (body.action === 'unblock') {
    await unblockFssai({ sellerId: app.sellerId, adminId: admin.uid });
    return ok({ ok: true });
  }
  if (body.action === 'inspection_ordered' || body.action === 'inadequacy_notice') {
    await recordInterruption({ applicationId: id, kind: body.action, date: body.date ?? istDateString(new Date()), note: body.note, adminId: admin.uid });
    return ok({ ok: true });
  }

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
        // FSSAI hardening v3 (DECISIONS.md #119+): the anchor the regulatory
        // publishing gate (src/lib/fssai/gate.ts) measures its 7/60-day
        // deemed-commencement window from.
        filedAt: new Date(),
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
    const expiry = addMonthsIST(new Date(), 12 * (app.formAJson?.years ?? 1));
    await db
      .update(sellerProfiles)
      .set({
        fssaiStatus: 'verified',
        fssaiNumber: license,
        fssaiExpiry: expiry.toISOString().slice(0, 10),
      })
      .where(eq(sellerProfiles.userId, app.sellerId));
    await scheduleDocumentDeletion(app.sellerId);
    await recordFunnel(app.sellerId, 'verified');
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
      body.reason || 'This application could not be filed as submitted. Please review and resubmit.',
      '/seller/compliance',
    );
  } else if (body.action === 'sponsor') {
    // Per-application admin toggle (DECISIONS.md #62+ simplifies the brief's
    // "per society/cohort" toggle to per-application, since the pilot has
    // exactly one society and one cohort). Purely an internal acquisition-
    // cost record — never creates or removes a seller debt either way.
    await db
      .update(fssaiApplications)
      .set({ sponsoredByPlatform: body.sponsoredByPlatform, updatedAt: new Date() })
      .where(eq(fssaiApplications.id, id));
  } else {
    throw new ApiError(400, 'Unknown action');
  }

  await recordAudit({ actorId: admin.uid, action: `fssai.${body.action}`, targetType: 'fssai_application', targetId: id });
  return ok({ ok: true });
});
