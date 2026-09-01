import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles, users } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';
import { verifyFssaiLicense } from '@/lib/fssai/verify';
import { fuzzyNameMatch } from '@/lib/fssai/match';

export const dynamic = 'force-dynamic';

/**
 * FSSAI hardening v3 (DECISIONS.md #119+) — the "Got your license? Enter it
 * here" card on /seller/compliance, shown whenever fssaiStatus != 'verified'
 * (including while an application is pending). A certificate upload is
 * required on every submission. If the verification adapter finds the
 * number valid AND its returned licensee name fuzzy-matches the seller's
 * own name or kitchen name, this auto-verifies (fssaiVerifiedBy: 'api').
 * Otherwise it's left at 'awaiting_admin_check' for a human to confirm on
 * /admin/fssai's "Verify licenses" queue — never silently rejected, since a
 * real license can fail an automated name match for mundane reasons
 * (maiden name on the certificate, a co-owned kitchen, OCR-unfriendly
 * formatting) that only a human should adjudicate.
 */
export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const { licenseNumber, certificateUrl } = await readJson<{
    licenseNumber: string;
    certificateUrl: string;
  }>(req);
  if (!certificateUrl?.trim()) {
    throw new ApiError(400, 'Upload your FSSAI certificate (PDF, JPG or PNG)');
  }
  const clean = (licenseNumber || '').replace(/\s/g, '');

  const db = await getDb();
  const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
  if (!profile) throw new ApiError(404, 'Seller profile missing');
  if (profile.fssaiStatus === 'verified') {
    throw new ApiError(400, 'This kitchen already has a verified FSSAI license');
  }

  const result = await verifyFssaiLicense(clean);
  const holderName = result.valid ? result.holderName : null;
  const nameMatches = holderName ? fuzzyNameMatch(holderName, [session.name, profile.kitchenName]) : false;
  const autoVerified = result.valid && nameMatches;

  await db
    .update(sellerProfiles)
    .set({
      fssaiNumber: clean || profile.fssaiNumber,
      fssaiCertificateUrl: certificateUrl.trim(),
      fssaiLicenseeName: holderName,
      fssaiLicenseeAddress: result.valid ? (result.address ?? null) : null,
      fssaiExpiry: result.valid ? result.expiresOn || null : null,
      fssaiStatus: autoVerified ? 'verified' : 'awaiting_admin_check',
      fssaiVerifiedBy: autoVerified ? 'api' : null,
      fssaiVerifiedAt: autoVerified ? new Date() : null,
      fssaiVerificationTimelineJson: [
        ...(profile.fssaiVerificationTimelineJson ?? []),
        {
          at: new Date().toISOString(),
          event: autoVerified
            ? `License ${clean} auto-verified — API match on "${holderName}"`
            : result.valid
              ? `License ${clean} entered — API found "${holderName}", queued for admin check (name didn't auto-match)`
              : `License ${clean} entered — API could not verify it (${result.reason}), queued for admin check`,
        },
      ],
    })
    .where(eq(sellerProfiles.userId, session.uid));

  if (!autoVerified) {
    const admins = await db.select().from(users).where(eq(users.role, 'admin'));
    await Promise.all(
      admins.map((a) =>
        notify(
          a.id,
          'FSSAI license needs a manual check 🔍',
          `${profile.kitchenName} entered a license number — review it on the Verify licenses queue.`,
          '/admin/fssai',
        ),
      ),
    );
  }

  return ok({
    ok: true,
    verification: result,
    status: autoVerified ? 'verified' : 'awaiting_admin_check',
  });
});
