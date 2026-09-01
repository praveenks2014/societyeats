import { desc, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

type Body =
  | { action: 'verify'; confirmName: boolean; confirmAddress: boolean; confirmExpiryFuture: boolean }
  | { action: 'reject'; reason?: string };

/**
 * FSSAI hardening v3 (DECISIONS.md #119+) — item 3's admin actions on the
 * "Verify licenses" queue. Every action appends to
 * sellerProfiles.fssaiVerificationTimelineJson (a seller can land here with
 * no fssaiApplications row at all, so this can't reuse that table's own
 * timeline).
 */
export const PATCH = api<{ params: { userId: string } }>(async (req, { params }) => {
  await requireSession(['admin']);
  const body = await readJson<Body>(req);
  const sellerId = Number(params.userId);
  const db = await getDb();
  const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  if (!profile) throw new ApiError(404, 'Seller not found');
  if (profile.fssaiStatus !== 'awaiting_admin_check') {
    throw new ApiError(400, 'This seller is not on the verification queue');
  }

  const timeline = [...(profile.fssaiVerificationTimelineJson ?? [])];
  const now = new Date().toISOString();

  if (body.action === 'verify') {
    // Server-side re-check, same "never trust the client alone" posture as
    // every other gate in this app — the UI already disables the button
    // unless all three are ticked.
    if (!body.confirmName || !body.confirmAddress || !body.confirmExpiryFuture) {
      throw new ApiError(400, 'Confirm name, address, and expiry-in-future before marking verified');
    }
    timeline.push({ at: now, event: `Admin verified license ${profile.fssaiNumber} (name, address, expiry confirmed)` });
    await db
      .update(sellerProfiles)
      .set({
        fssaiStatus: 'verified',
        fssaiVerifiedBy: 'admin',
        fssaiVerifiedAt: new Date(),
        fssaiVerificationTimelineJson: timeline,
      })
      .where(eq(sellerProfiles.userId, sellerId));
    await notify(
      sellerId,
      'FSSAI license verified! ✅',
      `License ${profile.fssaiNumber} is confirmed. The green badge is live — re-enable any paused dishes.`,
      '/seller/compliance',
    );
    return ok({ ok: true });
  }

  if (body.action === 'reject') {
    // FSSAI hardening v3 (DECISIONS.md #119+): "returns the seller to their
    // previous status" is derived, not stored — no fssaiPriorStatus column
    // exists (same "compute it lazily from real rows" convention this
    // codebase already uses for the hygiene auto-pause counter and badge
    // tiers). A seller with a real application still in flight
    // (draft/submitted/filed) goes back to 'pending_application'; anyone
    // else goes back to 'unverified'.
    const [latestApplication] = await db
      .select()
      .from(fssaiApplications)
      .where(eq(fssaiApplications.sellerId, sellerId))
      .orderBy(desc(fssaiApplications.createdAt))
      .limit(1);
    const priorStatus =
      latestApplication && ['draft', 'submitted_to_backoffice', 'filed_on_foscos'].includes(latestApplication.status)
        ? ('pending_application' as const)
        : ('unverified' as const);

    timeline.push({
      at: now,
      event: `Admin rejected license ${profile.fssaiNumber}${body.reason ? ` — ${body.reason}` : ''}`,
    });
    await db
      .update(sellerProfiles)
      .set({
        fssaiStatus: priorStatus,
        fssaiVerifiedBy: null,
        fssaiVerifiedAt: null,
        fssaiVerificationTimelineJson: timeline,
      })
      .where(eq(sellerProfiles.userId, sellerId));
    await notify(
      sellerId,
      'FSSAI license needs another look',
      body.reason || 'We could not confirm this license — please re-check the number and re-upload your certificate.',
      '/seller/compliance',
    );
    return ok({ ok: true });
  }

  throw new ApiError(400, 'Unknown action');
});
