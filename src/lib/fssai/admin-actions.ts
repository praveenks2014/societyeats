import { eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { fssaiApplications, sellerProfiles } from '@/lib/db/schema';
import { istDateString } from '@/lib/time';

const ymd = (d: Date) => istDateString(d); // dates are IST calendar days

/** FoSCoS interrupted the deemed window (inspection ordered / inadequacy notice). `date` is when, as told to us. Moves the application off 'filed_on_foscos', which ends buyer visibility under the provisional tier. */
export async function recordInterruption(input: { applicationId: number; kind: 'inspection_ordered' | 'inadequacy_notice'; date: string; note?: string; adminId: number }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ApiError(400, 'Enter the date FoSCoS responded (YYYY-MM-DD)');
  if (input.date > ymd(new Date())) throw new ApiError(400, 'That date is in the future');
  const db = await getDb();
  const [app] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.id, input.applicationId));
  if (!app) throw new ApiError(404, 'Application not found');
  if (app.status !== 'filed_on_foscos') throw new ApiError(400, 'Only an application currently filed on FoSCoS can be interrupted');
  const label = input.kind === 'inspection_ordered' ? 'Inspection ordered' : 'Inadequacy notice issued';
  const timeline = [...(app.timelineJson ?? []), { at: new Date().toISOString(), event: `${label} by FoSCoS on ${input.date}${input.note ? ` — ${input.note}` : ''}` }];
  await db.update(fssaiApplications).set({ status: input.kind, interruptionAt: new Date(`${input.date}T00:00:00+05:30`), interruptionNote: input.note ?? null, timelineJson: timeline, updatedAt: new Date() }).where(eq(fssaiApplications.id, input.applicationId));
  await recordAudit({ actorId: input.adminId, action: 'fssai.interruption', targetType: 'fssai_application', targetId: input.applicationId, meta: { kind: input.kind, date: input.date } });
  await notify(app.sellerId, `FSSAI: ${label.toLowerCase()}`, `FoSCoS responded to your filing (ref ${app.foscosRefNumber}) with a ${label.toLowerCase()}. Check your FoSCoS account for next steps. Your kitchen is hidden until this is sorted.`, '/seller/compliance');
}

export async function blockFssai(input: { sellerId: number; reason: string; adminId: number }) {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ApiError(400, 'Give a reason (the kitchen will see it)');
  const db = await getDb();
  const [p] = await db.update(sellerProfiles).set({ fssaiBlockedReason: reason.slice(0, 200), fssaiBlockedAt: new Date() }).where(eq(sellerProfiles.userId, input.sellerId)).returning({ id: sellerProfiles.userId });
  if (!p) throw new ApiError(404, 'Kitchen not found');
  await recordAudit({ actorId: input.adminId, action: 'fssai.block', targetType: 'kitchen', targetId: input.sellerId, meta: { reason } });
  await notify(input.sellerId, 'FSSAI: your kitchen is hidden', `PadosiPlate blocked your FSSAI status: ${reason}. Fix it and we will review again.`, '/seller/compliance');
}

export async function unblockFssai(input: { sellerId: number; adminId: number }) {
  const db = await getDb();
  await db.update(sellerProfiles).set({ fssaiBlockedReason: null, fssaiBlockedAt: null }).where(eq(sellerProfiles.userId, input.sellerId));
  await recordAudit({ actorId: input.adminId, action: 'fssai.unblock', targetType: 'kitchen', targetId: input.sellerId });
  await notify(input.sellerId, 'FSSAI: block lifted', 'Your FSSAI status is back to normal.', '/seller/compliance');
}

export async function requestFssaiChanges(input: { applicationId: number; note: string; adminId: number }) {
  const note = input.note.trim();
  if (note.length < 5) throw new ApiError(400, 'Say what the kitchen needs to change');
  const db = await getDb();
  const [app] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.id, input.applicationId));
  if (!app) throw new ApiError(404, 'Application not found');
  const timeline = [...(app.timelineJson ?? []), { at: new Date().toISOString(), event: `Changes requested: ${note}` }];
  await db.update(fssaiApplications).set({ changesRequestedNote: note, changesRequestedAt: new Date(), timelineJson: timeline, updatedAt: new Date() }).where(eq(fssaiApplications.id, input.applicationId));
  await recordAudit({ actorId: input.adminId, action: 'fssai.request_changes', targetType: 'fssai_application', targetId: input.applicationId, meta: { note } });
  await notify(app.sellerId, 'FSSAI: changes needed', note, '/seller/compliance');
}
