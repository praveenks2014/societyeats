import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { isMockMode } from '@/lib/config';
import { getPlatformSettings, setPlatformSetting } from '@/lib/db/platform';
import { SETTING_DEFS, crossCheck, parseSettingsPatch, type PlatformSettings } from '@/lib/settings/defs';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  const settings = await getPlatformSettings();
  // Definitions drive the form: label, hint, group, bounds and unit per field.
  const defs = Object.entries(SETTING_DEFS).map(([key, d]) => ({
    key,
    kind: d.kind,
    label: d.label,
    hint: 'hint' in d ? d.hint : undefined,
    group: d.group,
    unit: 'unit' in d ? d.unit : undefined,
    min: 'min' in d ? d.min : undefined,
    max: 'max' in d ? d.max : undefined,
    options: 'options' in d ? d.options : undefined,
  }));
  return ok({ settings, defs, mockMode: isMockMode() });
});

/**
 * Every field is validated (integer, bounds, enum, pattern) before anything
 * is written — a commission over 100% or a fractional paise value is
 * rejected outright. The whole patch is rejected if any field is invalid.
 */
export const PATCH = api(async (req) => {
  const admin = await requireSession(['admin']);
  const { values, errors } = parseSettingsPatch(await readJson(req));
  if (errors.length) throw new ApiError(400, errors[0]);
  const before = await getPlatformSettings();
  const merged = { ...before, ...values } as PlatformSettings;
  const cross = crossCheck(merged);
  if (cross.length) throw new ApiError(400, cross[0]);
  for (const [key, value] of Object.entries(values)) await setPlatformSetting(key, String(value));
  const changed = Object.entries(values).filter(([k, v]) => (before as Record<string, unknown>)[k] !== v);
  if (changed.length) {
    await recordAudit({ actorId: admin.uid, action: 'settings.update', targetType: 'settings', meta: { changed: Object.fromEntries(changed.map(([k, v]) => [k, { from: (before as Record<string, unknown>)[k], to: v }])) } });
  }
  return ok({ settings: await getPlatformSettings() });
});
