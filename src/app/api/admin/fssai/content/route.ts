import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { fssaiWalkthroughSteps } from '@/lib/db/schema';
import { LANGS } from '@/lib/fssai/content';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireSession(['admin']);
  const lang = req.nextUrl.searchParams.get('lang') ?? 'en';
  const db = await getDb();
  const steps = await db.select().from(fssaiWalkthroughSteps).where(eq(fssaiWalkthroughSteps.lang, lang)).orderBy(asc(fssaiWalkthroughSteps.sort), asc(fssaiWalkthroughSteps.id));
  return ok({ lang, languages: LANGS, steps });
});

const step = z.object({
  id: z.number().int().optional(),
  lang: z.enum(['en', 'te', 'hi']),
  sort: z.number().int().min(0).max(99).optional(),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2000),
  tip: z.string().trim().max(1000).nullish(),
  screenshotUrl: z.string().trim().max(500).nullish(),
});

export const PUT = api(async (req) => {
  const admin = await requireSession(['admin']);
  const parsed = step.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const v = parsed.data;
  const db = await getDb();
  const values = { lang: v.lang, title: v.title, body: v.body, tip: v.tip || null, screenshotUrl: v.screenshotUrl || null, updatedAt: new Date(), ...(v.sort !== undefined ? { sort: v.sort } : {}) };
  const [row] = v.id ? await db.update(fssaiWalkthroughSteps).set(values).where(eq(fssaiWalkthroughSteps.id, v.id)).returning() : await db.insert(fssaiWalkthroughSteps).values({ sort: 99, ...values }).returning();
  await recordAudit({ actorId: admin.uid, action: 'fssai.content.save', targetType: 'walkthrough_step', targetId: row.id });
  return ok({ step: row });
});

export const DELETE = api(async (req) => {
  await requireSession(['admin']);
  const id = Number(req.nextUrl.searchParams.get('id'));
  const db = await getDb();
  await db.delete(fssaiWalkthroughSteps).where(eq(fssaiWalkthroughSteps.id, id));
  return ok({ ok: true });
});
