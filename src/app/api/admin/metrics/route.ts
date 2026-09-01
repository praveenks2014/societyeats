import { eq } from 'drizzle-orm';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { societies } from '@/lib/db/schema';
import { getWeeklyMetrics } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

/**
 * Pilot Hardening v2 — Phase 7 (Pilot metrics dashboard, DECISIONS.md #99+).
 * `?societyId=` picks the society (defaults to the first one, ordered by id —
 * this pilot has exactly one live society, so that's Aparna Cyberzon out of
 * the box). Returns the full society list too, for the page's own selector.
 */
export const GET = api(async (req) => {
  await requireSession(['admin']);
  const db = await getDb();
  const allSocieties = await db
    .select({ id: societies.id, name: societies.name, targetHouseholds: societies.targetHouseholds })
    .from(societies);
  if (allSocieties.length === 0) return ok({ societies: [], data: null });

  const requested = Number(new URL(req.url).searchParams.get('societyId'));
  const societyId = allSocieties.some((s) => s.id === requested) ? requested : allSocieties[0].id;

  const data = await getWeeklyMetrics(societyId);
  return ok({ societies: allSocieties, data });
});

/** Edits one society's pilot household target (a society property, not a global platform_config setting). */
export const PATCH = api(async (req) => {
  await requireSession(['admin']);
  const body = await readJson<{ societyId: number; targetHouseholds: number }>(req);
  if (!Number.isInteger(body.societyId)) throw new ApiError(400, 'societyId is required');
  if (!Number.isFinite(body.targetHouseholds) || body.targetHouseholds <= 0) {
    throw new ApiError(400, 'targetHouseholds must be a positive number');
  }
  const db = await getDb();
  const [updated] = await db
    .update(societies)
    .set({ targetHouseholds: Math.round(body.targetHouseholds) })
    .where(eq(societies.id, body.societyId))
    .returning();
  if (!updated) throw new ApiError(404, 'Society not found');
  const data = await getWeeklyMetrics(body.societyId);
  return ok({ data });
});
