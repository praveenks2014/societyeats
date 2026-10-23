import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { messageTemplates } from '@/lib/db/schema';
import { DEFAULT_TEMPLATES } from '@/lib/messaging/admin-threads';

export const dynamic = 'force-dynamic';

async function ensure() {
  const db = await getDb();
  const rows = await db.select().from(messageTemplates).orderBy(messageTemplates.sort, messageTemplates.id);
  if (rows.length) return rows;
  await db.insert(messageTemplates).values(DEFAULT_TEMPLATES.map((t, i) => ({ ...t, sort: i })));
  return db.select().from(messageTemplates).orderBy(messageTemplates.sort, messageTemplates.id);
}

export const GET = api(async () => {
  await requireSession(['admin']);
  return ok({ templates: await ensure() });
});

const tpl = z.object({ id: z.number().int().optional(), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(4000) });

/** Create or update a template. */
export const PUT = api(async (req) => {
  await requireSession(['admin']);
  const parsed = tpl.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const db = await getDb();
  if (parsed.data.id) await db.update(messageTemplates).set({ title: parsed.data.title, body: parsed.data.body }).where(eq(messageTemplates.id, parsed.data.id));
  else await db.insert(messageTemplates).values({ title: parsed.data.title, body: parsed.data.body, sort: 99 });
  return ok({ templates: await ensure() });
});

export const DELETE = api(async (req) => {
  await requireSession(['admin']);
  const id = Number(req.nextUrl.searchParams.get('id'));
  const db = await getDb();
  await db.delete(messageTemplates).where(eq(messageTemplates.id, id));
  return ok({ templates: await ensure() });
});
