import { api, ok } from '@/lib/api';
import { getDb } from '@/lib/db';
import { societies } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const db = await getDb();
  const rows = await db.select().from(societies);
  return ok({ societies: rows });
});
