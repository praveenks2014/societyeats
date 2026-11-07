import { desc, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { getPlatformSettings, setPlatformSetting } from '@/lib/db/platform';
import { settingsHistory, users } from '@/lib/db/schema';
import { SETTING_DEFS, crossCheck, parseSettingsPatch, type PlatformSettings } from '@/lib/settings/defs';

const str = (v: unknown) => (v == null ? null : String(v));

/** One history row per changed key: old value, new value, who, when and why. */
export async function recordSettingChanges(changes: Record<string, { from: unknown; to: unknown }>, adminId: number, reason: string, restoredFromId?: number) {
  const db = await getDb();
  const rows = Object.entries(changes)
    .filter(([, c]) => str(c.from) !== str(c.to))
    .map(([key, c]) => ({ key, oldValue: str(c.from), newValue: str(c.to), changedBy: adminId, reason, restoredFromId: restoredFromId ?? null }));
  if (rows.length) await db.insert(settingsHistory).values(rows);
  return rows.length;
}

export async function settingsHistoryList(opts: { key?: string; limit?: number } = {}) {
  const db = await getDb();
  const rows = await db
    .select({ h: settingsHistory, who: users.name })
    .from(settingsHistory)
    .leftJoin(users, eq(users.id, settingsHistory.changedBy))
    .where(opts.key ? eq(settingsHistory.key, opts.key) : undefined)
    .orderBy(desc(settingsHistory.changedAt), desc(settingsHistory.id))
    .limit(Math.min(opts.limit ?? 100, 500));
  return rows.map(({ h, who }) => ({ id: h.id, key: h.key, label: (SETTING_DEFS as Record<string, { label: string }>)[h.key]?.label ?? h.key, oldValue: h.oldValue, newValue: h.newValue, changedBy: who ?? 'system', changedAt: h.changedAt, reason: h.reason, restoredFromId: h.restoredFromId }));
}

/**
 * Put a setting back to the value it had BEFORE a history row. Validated like any other change (bounds, cross-checks), recorded as a
 * new history row that points at the one it restores, and audit-logged. Past orders keep their snapshots either way.
 */
export async function restoreSetting(historyId: number, adminId: number, reason: string): Promise<{ key: string; restoredTo: string | null }> {
  const why = reason.trim();
  if (why.length < 3) throw new ApiError(400, 'Say why you are restoring this');
  const db = await getDb();
  const [h] = await db.select().from(settingsHistory).where(eq(settingsHistory.id, historyId));
  if (!h) throw new ApiError(404, 'History entry not found');
  if (!(h.key in SETTING_DEFS)) throw new ApiError(400, 'That setting no longer exists');
  if (h.oldValue == null) throw new ApiError(400, 'There is no earlier value to restore');
  const { values, errors } = parseSettingsPatch({ [h.key]: coerce(h.key, h.oldValue) });
  if (errors.length) throw new ApiError(400, errors[0]);
  const before = await getPlatformSettings();
  const merged = { ...before, ...values } as PlatformSettings;
  const cross = crossCheck(merged);
  if (cross.length) throw new ApiError(400, cross[0]);
  const current = (before as Record<string, unknown>)[h.key];
  await setPlatformSetting(h.key, String(values[h.key as keyof typeof values]));
  await recordSettingChanges({ [h.key]: { from: current, to: values[h.key as keyof typeof values] } }, adminId, `Restored: ${why}`, historyId);
  await recordAudit({ actorId: adminId, action: 'settings.restore', targetType: 'settings', targetId: h.key, meta: { historyId, to: h.oldValue, reason: why } });
  return { key: h.key, restoredTo: h.oldValue };
}

/** History stores strings; give the validator the type it expects. */
function coerce(key: string, v: string): unknown {
  const d = (SETTING_DEFS as Record<string, { kind: string }>)[key];
  if (d.kind === 'bool') return v === 'true';
  if (d.kind === 'int' || d.kind === 'number') return Number(v);
  return v;
}
