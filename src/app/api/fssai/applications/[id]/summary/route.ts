import { eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles, users } from '@/lib/db/schema';
import { BRAND } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * The wizard's actual "output" (DECISIONS.md #62+): a prefilled application
 * summary + document bundle that either the seller themselves (the only
 * path the wizard UI offers as of DECISIONS.md #119+) or, for a small
 * number of legacy applications, PadosiPlate's back office (facilitator path,
 * backend kept but no longer reachable from the wizard) uses to file on
 * FoSCoS by hand. There is no government submission API this calls — it
 * only renders what was already collected in the wizard.
 */
export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  const session = await requireSession();
  const id = Number(params.id);
  const db = await getDb();
  const [app] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.id, id));
  if (!app) throw new ApiError(404, 'Application not found');
  if (app.sellerId !== session.uid && session.role !== 'admin') {
    throw new ApiError(403, 'Not your application');
  }

  const [profile] = await db
    .select()
    .from(sellerProfiles)
    .where(eq(sellerProfiles.userId, app.sellerId));
  const [seller] = await db.select().from(users).where(eq(users.id, app.sellerId));

  return ok({
    id: app.id,
    generatedAt: new Date().toISOString(),
    platform: { name: BRAND.name },
    applicant: {
      name: app.applicantName,
      phone: seller?.phone ?? '',
      kitchenName: profile?.kitchenName ?? '',
      kitchenAddress: app.kitchenAddress,
    },
    licenseType: app.licenseType,
    documents: app.documentsJson ?? [],
    filingMode: app.filingMode,
    facilitationCostInPaise: app.facilitationCostInPaise,
    sponsoredByPlatform: app.sponsoredByPlatform,
    status: app.status,
    foscosRefNumber: app.foscosRefNumber,
    createdAt: app.createdAt,
    canSelfFile: session.uid === app.sellerId && app.filingMode === 'self' && app.status === 'draft',
  });
});
