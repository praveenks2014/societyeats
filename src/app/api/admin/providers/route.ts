import { asc, eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { providerHealth } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const db = await getDb();
  const rows = await db.select().from(providerHealth).orderBy(asc(providerHealth.priority));
  return ok({ providers: rows });
});

export const PATCH = api(async (req) => {
  await requireSession(['admin']);
  const body = await readJson<{
    provider: 'porter' | 'shadowfax' | 'borzo';
    isEnabled?: boolean;
    chaosForceFail?: boolean;
    resetFailures?: boolean;
  }>(req);
  if (!body.provider) throw new ApiError(400, 'provider required');
  const db = await getDb();
  const [updated] = await db
    .update(providerHealth)
    .set({
      ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
      ...(body.chaosForceFail !== undefined ? { chaosForceFail: body.chaosForceFail } : {}),
      ...(body.resetFailures ? { failureCount: 0 } : {}),
    })
    .where(eq(providerHealth.provider, body.provider))
    .returning();
  if (!updated) throw new ApiError(404, 'Provider not found');
  return ok({ provider: updated });
});
