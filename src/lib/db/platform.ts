import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { platformConfig } from '@/lib/db/schema';
import { SETTING_DEFS, type Def, type PlatformSettings, type SettingKey } from '@/lib/settings/defs';

export type { PlatformSettings } from '@/lib/settings/defs';

/** Parse one stored string according to its definition, falling back to the default when absent/invalid. */
export function decodeSetting(def: Def, stored: string | undefined): string | number | boolean {
  if (stored === undefined) return def.def;
  switch (def.kind) {
    case 'bool':
      return stored === 'true';
    case 'int':
    case 'number': {
      const n = Number(stored);
      return Number.isFinite(n) ? n : def.def;
    }
    case 'enum':
      return def.options.includes(stored) ? stored : def.def;
    default:
      return stored;
  }
}

/** Admin-editable settings stored in platform_config, defaults from src/lib/settings/defs.ts. */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const db = await getDb();
  const rows = await db.select().from(platformConfig);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out: Record<string, string | number | boolean> = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) out[key] = decodeSetting(def as Def, map[key]);
  return out as PlatformSettings;
}

export async function setPlatformSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db
    .insert(platformConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: platformConfig.key, set: { value } });
}

/** Idempotently writes every default into platform_config without overwriting admin edits. */
export async function seedPlatformDefaults(): Promise<void> {
  const db = await getDb();
  for (const [key, def] of Object.entries(SETTING_DEFS) as [SettingKey, Def][]) {
    await db.insert(platformConfig).values({ key, value: String(def.def) }).onConflictDoNothing();
  }
}
