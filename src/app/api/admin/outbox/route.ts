import { desc } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { emailOutbox } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db.select().from(emailOutbox).orderBy(desc(emailOutbox.id)).limit(100);
  return ok({ emails: rows });
});
