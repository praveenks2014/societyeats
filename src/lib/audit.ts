import { getDb } from '@/lib/db';
import { auditLog } from '@/lib/db/schema';

export async function recordAudit(e: {
  actorId: number | null;
  action: string;
  targetType?: string;
  targetId?: string | number;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const db = await getDb();
  await db.insert(auditLog).values({
    actorId: e.actorId,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId != null ? String(e.targetId) : null,
    meta: e.meta ?? null,
  });
}
