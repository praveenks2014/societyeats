import { and, asc, eq, inArray } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getPlatformSettings, setPlatformSetting } from '@/lib/db/platform';
import { grievanceEvents, grievances, platformConfig, users } from '@/lib/db/schema';
import { DAY_MS } from '@/lib/time';
import { emit } from '@/lib/notify';

export type GrievanceKind = 'dispute_payment' | 'dispute_food' | 'dispute_quality' | 'chat_report' | 'grievance' | 'data_request' | 'strike_appeal';

/**
 * One ticket list for disputes, grievances, chat reports, data requests and strike appeals. Timers follow the Consumer Protection
 * (E-Commerce) Rules 2020: the person gets an automatic acknowledgement the moment they raise it, a human must pick it up within
 * `grievanceAckHours` (48), and it is resolved within `grievanceResolveDays` (data requests: `dataRequestDays`, 30). Admins get an
 * alert once when a ticket passes a deadline.
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
  const resolveDays = input.kind === 'data_request' ? settings.dataRequestDays : settings.grievanceResolveDays;
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
      resolveDueAt: new Date(now.getTime() + resolveDays * DAY_MS),
      createdAt: now,
    })
    .returning();
  await db.insert(grievanceEvents).values({ grievanceId: row.id, actorId: input.raisedById ?? null, kind: 'created', body: input.subject.slice(0, 200), createdAt: now });
  // The automatic acknowledgement (in-app + email) — what the E-Commerce Rules ask for within 48 hours.
  if (row.raisedById) await emit('grievance_received', row.raisedById, { grievanceId: row.id, ackHours: settings.grievanceAckHours, resolveDays }, now);
  return row;
}

/** A person at PadosiPlate picks the ticket up (and, optionally, takes ownership). */
export async function acknowledgeGrievance(id: number, adminId: number, now: Date = new Date()) {
  const db = await getDb();
  const [row] = await db.update(grievances).set({ status: 'acknowledged', ackAt: now, handledBy: adminId }).where(and(eq(grievances.id, id), eq(grievances.status, 'open'))).returning();
  if (row) {
    await db.insert(grievanceEvents).values({ grievanceId: id, actorId: adminId, kind: 'status', body: 'Picked up', createdAt: now });
    if (row.raisedById) await emit('grievance_acknowledged', row.raisedById, { grievanceId: row.id, resolveDays: (await getPlatformSettings()).grievanceResolveDays }, now);
  }
  return row ?? null;
}

export async function assignGrievance(id: number, adminId: number, assigneeId: number, now: Date = new Date()) {
  const db = await getDb();
  const [assignee] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, assigneeId));
  if (!assignee || assignee.role !== 'admin') throw new ApiError(400, 'Only an admin can own a ticket');
  const [g] = await db.select().from(grievances).where(eq(grievances.id, id));
  if (!g) throw new ApiError(404, 'Ticket not found');
  if (g.status === 'resolved' || g.status === 'closed') throw new ApiError(409, 'This ticket is already resolved');
  await db.update(grievances).set({ handledBy: assigneeId }).where(eq(grievances.id, id));
  await db.insert(grievanceEvents).values({ grievanceId: id, actorId: adminId, kind: 'assigned', body: `Assigned to ${assignee.name}`, createdAt: now });
  if (g.status === 'open') await acknowledgeGrievance(id, assigneeId, now);
}

export async function addNote(id: number, adminId: number, body: string, now: Date = new Date()) {
  const text = body.trim();
  if (text.length < 2) throw new ApiError(400, 'Write a note');
  const db = await getDb();
  const [g] = await db.select({ id: grievances.id }).from(grievances).where(eq(grievances.id, id));
  if (!g) throw new ApiError(404, 'Ticket not found');
  await db.insert(grievanceEvents).values({ grievanceId: id, actorId: adminId, kind: 'note', body: text.slice(0, 2000), createdAt: now });
}

export async function grievanceHistory(id: number) {
  const db = await getDb();
  const rows = await db.select({ e: grievanceEvents, actor: users.name }).from(grievanceEvents).leftJoin(users, eq(users.id, grievanceEvents.actorId)).where(eq(grievanceEvents.grievanceId, id)).orderBy(asc(grievanceEvents.createdAt), asc(grievanceEvents.id));
  return rows.map((r) => ({ id: r.e.id, kind: r.e.kind, body: r.e.body, at: r.e.createdAt, actor: r.actor }));
}

export async function resolveGrievance(id: number, adminId: number, resolution: string, note?: string, now: Date = new Date()) {
  const db = await getDb();
  const [row] = await db
    .update(grievances)
    .set({ status: 'resolved', resolvedAt: now, resolution, resolutionNote: note ?? null, handledBy: adminId, ackAt: now })
    .where(and(eq(grievances.id, id), inArray(grievances.status, ['open', 'acknowledged'])))
    .returning();
  if (row) {
    await db.insert(grievanceEvents).values({ grievanceId: id, actorId: adminId, kind: 'status', body: `Resolved: ${resolution}${note ? ` — ${note}` : ''}`, createdAt: now });
    if (row.raisedById) await emit('grievance_resolved', row.raisedById, { grievanceId: row.id, resolution: row.resolutionNote ?? row.resolution ?? 'Resolved' }, now);
  }
  return row ?? null;
}

/** Tickets past their pick-up or resolution deadline — for the admin SLA badge and the cron alert. */
export async function overdueGrievances(now: Date = new Date()) {
  const db = await getDb();
  const open = await db.select().from(grievances).where(inArray(grievances.status, ['open', 'acknowledged']));
  return open.filter((g) => (g.status === 'open' && g.ackDueAt.getTime() < now.getTime()) || g.resolveDueAt.getTime() < now.getTime());
}

/**
 * Cron: tell admins once per ticket and per deadline (pick-up, resolution) when it has been missed. The platform_config key is the
 * once-only record, so running every five minutes never repeats an alert.
 */
export async function alertOverdueGrievances(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const { notifyAdmins } = await import('@/lib/orders/strikes');
  let sent = 0;
  for (const g of await overdueGrievances(now)) {
    for (const [kind, late] of [['ack', g.status === 'open' && g.ackDueAt.getTime() < now.getTime()], ['resolve', g.resolveDueAt.getTime() < now.getTime()]] as const) {
      if (!late) continue;
      const key = `grievance_alert:${g.id}:${kind}`;
      const [seen] = await db.select().from(platformConfig).where(eq(platformConfig.key, key));
      if (seen) continue;
      await setPlatformSetting(key, now.toISOString());
      await notifyAdmins(kind === 'ack' ? `Ticket #${g.id} has not been picked up` : `Ticket #${g.id} is past its resolution date`, g.subject, '/admin/grievances');
      await db.insert(grievanceEvents).values({ grievanceId: g.id, actorId: null, kind: 'alert', body: kind === 'ack' ? 'Pick-up deadline missed' : 'Resolution deadline missed', createdAt: now });
      sent++;
    }
  }
  return sent;
}
