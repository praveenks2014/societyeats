import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { grievances, strikes } from '@/lib/db/schema';
import { slaOf } from '@/lib/disputes';
import { acknowledgeGrievance, addNote, assignGrievance, grievanceHistory, resolveGrievance } from '@/lib/grievances';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  await requireSession(['admin']);
  const db = await getDb();
  const [g] = await db.select().from(grievances).where(eq(grievances.id, Number(params.id)));
  if (!g) throw new ApiError(404, 'Ticket not found');
  return ok({ ticket: { ...g, ...slaOf(g) }, history: await grievanceHistory(g.id) });
});

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('note'), body: z.string().trim().min(2).max(2000) }),
  z.object({ action: z.literal('acknowledge') }),
  z.object({ action: z.literal('assign'), assigneeId: z.number().int() }),
  z.object({ action: z.literal('resolve'), resolution: z.string().trim().min(2).max(30), note: z.string().trim().min(3).max(1000) }),
  // Strike appeals: decide the appeal (lifting the strike on a successful one).
  z.object({ action: z.literal('decide_appeal'), outcome: z.enum(['lift', 'uphold']), note: z.string().trim().min(3).max(1000) }),
]);

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  const id = Number(params.id);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const a = parsed.data;
  const db = await getDb();
  const [g] = await db.select().from(grievances).where(eq(grievances.id, id));
  if (!g) throw new ApiError(404, 'Ticket not found');
  switch (a.action) {
    case 'note':
      await addNote(id, admin.uid, a.body);
      break;
    case 'acknowledge':
      await acknowledgeGrievance(id, admin.uid);
      break;
    case 'assign':
      await assignGrievance(id, admin.uid, a.assigneeId);
      break;
    case 'resolve': {
      if (g.status === 'resolved' || g.status === 'closed') throw new ApiError(409, 'This ticket is already resolved');
      await resolveGrievance(id, admin.uid, a.resolution, a.note);
      break;
    }
    case 'decide_appeal': {
      if (g.kind !== 'strike_appeal') throw new ApiError(400, 'This ticket is not a strike appeal');
      if (g.status === 'resolved' || g.status === 'closed') throw new ApiError(409, 'This appeal is already decided');
      const strikeId = Number((g.evidenceJson as { strikeId?: number } | null)?.strikeId);
      if (a.outcome === 'lift' && strikeId) await db.update(strikes).set({ liftedAt: new Date() }).where(eq(strikes.id, strikeId));
      await resolveGrievance(id, admin.uid, a.outcome === 'lift' ? 'appeal_upheld' : 'appeal_rejected', a.note);
      break;
    }
  }
  await recordAudit({ actorId: admin.uid, action: `grievance.${a.action}`, targetType: 'grievance', targetId: id, meta: { kind: g.kind } });
  const [fresh] = await db.select().from(grievances).where(eq(grievances.id, id));
  return ok({ ticket: { ...fresh, ...slaOf(fresh) }, history: await grievanceHistory(id) });
});
