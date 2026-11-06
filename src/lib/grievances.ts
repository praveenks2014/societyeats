import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { grievances } from '@/lib/db/schema';
import { DAY_MS } from '@/lib/time';

export type GrievanceKind = 'dispute_payment' | 'dispute_food' | 'dispute_quality' | 'chat_report' | 'grievance' | 'data_request';

/**
 * One ticket list for disputes, grievances, chat reports and data requests. Timers follow the
 * Consumer Protection (E-Commerce) Rules 2020: acknowledge within 48 hours, resolve within one month
 * (DPDP requests use the same, stricter, bar). Both are admin settings.
 */
export async function createGrievance(input: {
  kind: GrievanceKind;
  subject: string;
  body?: string;
  orderId?: number | null;
  raisedById?: number | null;
  raisedRole?: 'buyer' | 'seller' | 'system' | null;
  evidence?: Record<string, unknown>;
}, now: Date = new Date()) {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const [row] = await db
    .insert(grievances)
    .values({
      kind: input.kind,
      subject: input.subject.slice(0, 200),
      body: input.body ?? null,
      orderId: input.orderId ?? null,
      raisedById: input.raisedById ?? null,
      raisedRole: input.raisedRole ?? null,
      evidenceJson: input.evidence ?? null,
      ackDueAt: new Date(now.getTime() + settings.grievanceAckHours * 3_600_000),
      resolveDueAt: new Date(now.getTime() + settings.grievanceResolveDays * DAY_MS),
    })
    .returning();
  return row;
}

export async function acknowledgeGrievance(id: number, adminId: number, now: Date = new Date()) {
  const db = await getDb();
  const [row] = await db.update(grievances).set({ status: 'acknowledged', ackAt: now, handledBy: adminId }).where(and(eq(grievances.id, id), eq(grievances.status, 'open'))).returning();
  return row ?? null;
}

export async function resolveGrievance(id: number, adminId: number, resolution: string, note?: string, now: Date = new Date()) {
  const db = await getDb();
  const [row] = await db
    .update(grievances)
    .set({ status: 'resolved', resolvedAt: now, resolution, resolutionNote: note ?? null, handledBy: adminId, ackAt: now })
    .where(and(eq(grievances.id, id), inArray(grievances.status, ['open', 'acknowledged'])))
    .returning();
  return row ?? null;
}

/** Tickets past their acknowledgement or resolution deadline — for the admin SLA badge and the cron nudge. */
export async function overdueGrievances(now: Date = new Date()) {
  const db = await getDb();
  const open = await db.select().from(grievances).where(inArray(grievances.status, ['open', 'acknowledged']));
  return open.filter((g) => (g.status === 'open' && g.ackDueAt.getTime() < now.getTime()) || g.resolveDueAt.getTime() < now.getTime());
}
