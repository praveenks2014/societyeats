import { desc, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fssaiApplications, sellerProfiles, users } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';

export const dynamic = 'force-dynamic';

/** "Get me a license" wizard submits here → back-office queue (no fake govt API). */
export const POST = api(async (req) => {
  const session = await requireSession(['seller']);
  const body = await readJson<{
    applicantName: string;
    kitchenAddress: string;
    licenseType: 'registration' | 'state';
    documents: { label: string; url: string }[];
  }>(req);
  if (!body.applicantName?.trim() || !body.kitchenAddress?.trim()) {
    throw new ApiError(400, 'Applicant name and kitchen address are required');
  }

  const db = await getDb();
  const [app] = await db
    .insert(fssaiApplications)
    .values({
      sellerId: session.uid,
      applicantName: body.applicantName.trim(),
      kitchenAddress: body.kitchenAddress.trim(),
      licenseType: body.licenseType === 'registration' ? 'registration' : 'state',
      documentsJson: body.documents ?? [],
      status: 'submitted_to_backoffice',
      timelineJson: [
        { at: new Date().toISOString(), event: 'Application submitted to GharSe compliance team' },
      ],
    })
    .returning();

  await db
    .update(sellerProfiles)
    .set({ fssaiStatus: 'pending_application' })
    .where(eq(sellerProfiles.userId, session.uid));

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
