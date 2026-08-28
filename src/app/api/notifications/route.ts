import { and, desc, eq, isNull } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { notifications } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const session = await requireSession();
  const db = await getDb();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, session.uid))
    .orderBy(desc(notifications.createdAt))
    .limit(15);
  const unreadRows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, session.uid), isNull(notifications.readAt)));
  return ok({ notifications: rows, unread: unreadRows.length });
});

export const PATCH = api(async () => {
  const session = await requireSession();
  const db = await getDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, session.uid), isNull(notifications.readAt)));
  return ok({ ok: true });
});
