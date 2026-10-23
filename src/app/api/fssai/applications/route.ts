import { desc, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles, users } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';
import { getPlatformSettings } from '@/lib/db/platform';
import { basicRegistrationFeePaise, validateFormA, type FormAAnswers } from '@/lib/fssai/assistant';
import { recordFunnel } from '@/lib/fssai/funnel';

export const dynamic = 'force-dynamic';

/**
 * "Get me a license" wizard submits here. Two filing paths (DECISIONS.md
 * #62+): 'facilitator' opens a real back-office task for PadosiPlate's compliance
 * team (who file on FoSCoS by hand — there is no public submission API);
 * 'self' just records the application for the seller's own reference — no
 * back-office task, no facilitation cost — the wizard's prefilled summary +
 * document bundle is theirs to file with directly on FoSCoS.
 */
export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const body = await readJson<{
    applicantName: string;
    kitchenAddress: string;
    licenseType: 'registration' | 'state';
    documents: { label: string; url: string }[];
    filingMode?: 'facilitator' | 'self';
    /** Form A answers from the assistant (Basic Registration). */
    formA?: Omit<FormAAnswers, 'eligibility'> & { eligibility: FormAAnswers['eligibility'] };
  }>(req);
  if (!body.applicantName?.trim() || !body.kitchenAddress?.trim()) {
    throw new ApiError(400, 'Applicant name and kitchen address are required');
  }

  const db = await getDb();
  const settings0 = await getPlatformSettings();
  // The assistant only prepares Basic Registration (Form A). Validate every answer on the server.
  let formA: typeof fssaiApplications.$inferInsert['formAJson'] = null;
  if (body.formA) {
    const problem = validateFormA(body.formA);
    if (problem) throw new ApiError(400, problem);
    formA = { ...body.formA, feeInPaise: basicRegistrationFeePaise(body.formA.years, settings0.fssaiBasicFeePerYear), idType: body.formA.idType };
  }
  const filingMode: 'facilitator' | 'self' = body.filingMode === 'self' ? 'self' : 'facilitator';
  const now = new Date().toISOString();

  // Sponsorship (founder-specified: facilitation sponsored at ₹2,000/seller,
  // capped at a configurable number of sellers per pilot cohort). A seller
  // who was already sponsored on an earlier application (e.g. resubmitting
  // after a rejection) stays sponsored rather than being re-evaluated against
  // a cap that may have since filled up.
  let facilitationCostInPaise = 0;
  let sponsoredByPlatform = false;
  if (filingMode === 'facilitator') {
    facilitationCostInPaise = 200000; // matches the schema column default (₹2,000)
    const settings = await getPlatformSettings();
    const sponsoredRows = await db
      .select({ sellerId: fssaiApplications.sellerId })
      .from(fssaiApplications)
      .where(eq(fssaiApplications.sponsoredByPlatform, true));
    const sponsoredSellers = new Set(sponsoredRows.map((r) => r.sellerId));
    sponsoredByPlatform =
      sponsoredSellers.has(session.uid) || sponsoredSellers.size < settings.fssaiSponsorshipCapPerCohort;
  }

  const [app] = await db
    .insert(fssaiApplications)
    .values({
      sellerId: session.uid,
      applicantName: body.applicantName.trim(),
      kitchenAddress: body.kitchenAddress.trim(),
      licenseType: formA ? 'registration' : body.licenseType === 'state' ? 'state' : 'registration',
      formAJson: formA,
      documentsJson: body.documents ?? [],
      filingMode,
      facilitationCostInPaise,
      sponsoredByPlatform,
      status: filingMode === 'facilitator' ? 'submitted_to_backoffice' : 'draft',
      timelineJson:
        filingMode === 'facilitator'
          ? [{ at: now, event: "Application submitted to PadosiPlate's back office" }]
          : [{ at: now, event: 'Application created — filing it yourself on FoSCoS' }],
    })
    .returning();

  // Either path puts the kitchen's badge into "pending" — both represent an
  // application genuinely in progress, just filed by different hands.
  await db
    .update(sellerProfiles)
    .set({ fssaiStatus: 'pending_application' })
    .where(eq(sellerProfiles.userId, session.uid));

  if (filingMode === 'facilitator') {
    const admins = await db.select().from(users).where(eq(users.role, 'admin'));
    await Promise.all(
      admins.map((a) =>
        notify(
          a.id,
          'New FSSAI application 📋',
          `${body.applicantName} needs their application filed on FoSCoS within 48h.`,
          '/admin/fssai',
        ),
      ),
    );
  }

  await recordFunnel(session.uid, 'started');
  if (formA) {
    await recordFunnel(session.uid, 'eligible');
    await recordFunnel(session.uid, 'details_complete');
    if ((body.documents ?? []).length >= 4) await recordFunnel(session.uid, 'documents_ready');
  }
  return ok({ application: app });
});

export const GET = api(async () => {
  const session = await requireSession(['seller']);
  const db = await getDb();
  const apps = await db
    .select()
    .from(fssaiApplications)
    .where(eq(fssaiApplications.sellerId, session.uid))
    .orderBy(desc(fssaiApplications.createdAt));
  return ok({ applications: apps });
});
