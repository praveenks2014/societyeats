import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { fssaiFunnelEvents, societies, users } from '@/lib/db/schema';

export const FUNNEL_STAGES = ['started', 'eligible', 'details_complete', 'documents_ready', 'pack_downloaded', 'reference_entered', 'verified'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const FUNNEL_LABELS: Record<FunnelStage, string> = {
  started: 'Started',
  eligible: 'Eligible (Form A)',
  details_complete: 'Details complete',
  documents_ready: 'Documents ready',
  pack_downloaded: 'Pack downloaded',
  reference_entered: 'Reference entered',
  verified: 'Verified',
};

/** Idempotent: records the first time a seller reaches a stage. */
export async function recordFunnel(sellerId: number, stage: FunnelStage): Promise<void> {
  const db = await getDb();
  await db.insert(fssaiFunnelEvents).values({ sellerId, stage }).onConflictDoNothing();
}

/** Counts per stage, overall and per society. */
export async function funnelReport() {
  const db = await getDb();
  const rows = await db
    .select({ societyId: users.societyId, societyName: societies.name, stage: fssaiFunnelEvents.stage, n: sql<number>`count(*)` })
    .from(fssaiFunnelEvents)
    .innerJoin(users, eq(fssaiFunnelEvents.sellerId, users.id))
    .leftJoin(societies, eq(users.societyId, societies.id))
    .groupBy(users.societyId, societies.name, fssaiFunnelEvents.stage);
  const bySociety = new Map<string, Record<string, number>>();
  const total: Record<string, number> = {};
  for (const r of rows) {
    const key = r.societyName ?? 'No society';
    const row = bySociety.get(key) ?? {};
    row[r.stage] = Number(r.n);
    bySociety.set(key, row);
    total[r.stage] = (total[r.stage] ?? 0) + Number(r.n);
  }
  return { stages: FUNNEL_STAGES.map((s) => ({ key: s, label: FUNNEL_LABELS[s] })), total, societies: [...bySociety.entries()].map(([name, counts]) => ({ name, counts })) };
}
