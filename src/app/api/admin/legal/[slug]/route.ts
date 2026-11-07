import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { getLegalDocument, isLegalSlug, legalVersions, markLegalReviewed, publishLegalDocument, seedLegalDocuments } from '@/lib/legal/docs';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { slug: string } }>(async (_req, { params }) => {
  await requireSession(['admin']);
  if (!isLegalSlug(params.slug)) throw new ApiError(404, 'Unknown document');
  await seedLegalDocuments();
  return ok({ document: await getLegalDocument(params.slug), versions: await legalVersions(params.slug) });
});

const publishSchema = z.object({
  action: z.literal('publish'),
  title: z.string().trim().min(3).max(160),
  body: z.string().min(40).max(60_000),
  material: z.boolean(),
  changeSummary: z.string().trim().min(3).max(500),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Publish a new version, or mark the current version reviewed by counsel. Both need a fresh 2FA check and are audit-logged. */
export const POST = api<{ params: { slug: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  if (!isLegalSlug(params.slug)) throw new ApiError(404, 'Unknown document');
  const body = await readJson<{ action?: string }>(req);
  if (body.action === 'review') {
    await markLegalReviewed(params.slug, admin.uid);
    await recordAudit({ actorId: admin.uid, action: 'legal.review', targetType: 'legal_document', targetId: params.slug });
    return ok({ document: await getLegalDocument(params.slug) });
  }
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  let version: number;
  try {
    version = await publishLegalDocument(params.slug, parsed.data, admin.uid);
  } catch (e) {
    throw new ApiError(400, e instanceof Error ? e.message : 'Could not publish');
  }
  await recordAudit({ actorId: admin.uid, action: 'legal.publish', targetType: 'legal_document', targetId: params.slug, meta: { version, material: parsed.data.material } });
  return ok({ document: await getLegalDocument(params.slug), version });
});
