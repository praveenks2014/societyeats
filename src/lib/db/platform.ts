import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { platformConfig } from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';

export type PlatformSettings = {
  commissionHomePct: number;
  commissionMallPct: number;
  platformFeePaise: number;
  fssaiPendingMaxDays: number;
  radiusKm: number;
};

/** Admin-editable settings stored in platform_config, defaults from config.ts. */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const db = await getDb();
  const rows = await db.select().from(platformConfig);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const v = map[key];
    const parsed = v === undefined ? NaN : Number(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    commissionHomePct: num('commissionHomePct', DEFAULTS.commissionHomePct),
    commissionMallPct: num('commissionMallPct', DEFAULTS.commissionMallPct),
    platformFeePaise: num('platformFeePaise', DEFAULTS.platformFeePaise),
    fssaiPendingMaxDays: num('fssaiPendingMaxDays', DEFAULTS.fssaiPendingMaxDays),
    radiusKm: num('radiusKm', DEFAULTS.radiusKm),
  };
}

export async function setPlatformSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(platformConfig)
    .where(eq(platformConfig.key, key));
  if (existing.length > 0) {
    await db.update(platformConfig).set({ value }).where(eq(platformConfig.key, key));
  } else {
    await db.insert(platformConfig).values({ key, value });
  }
}
