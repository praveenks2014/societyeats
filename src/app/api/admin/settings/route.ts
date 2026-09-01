import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getPlatformSettings, setPlatformSetting } from '@/lib/db/platform';
import { isMockMode } from '@/lib/config';

export const dynamic = 'force-dynamic';

const EDITABLE = new Set([
  'commissionHomePct',
  'commissionMallPct',
  'platformFeePaise',
  'fssaiPendingMaxDays',
  'radiusKm',
  'platformDeliveryFeeInPaise',
  'platformDeliveryMinOrderPaise',
]);
// platform_config values are always stored as text; booleans get their own
// set so PATCH knows to expect true/false instead of a non-negative number.
const EDITABLE_BOOL = new Set(['platformDeliveryEnabled']);

export const GET = api(async () => {
  await requireSession(['admin']);
  const settings = await getPlatformSettings();
  return ok({ settings, mockMode: isMockMode() });
});

export const PATCH = api(async (req) => {
  await requireSession(['admin']);
  const body = await readJson<Record<string, number | boolean>>(req);
  for (const [key, value] of Object.entries(body)) {
    if (EDITABLE_BOOL.has(key)) {
      if (typeof value !== 'boolean') throw new ApiError(400, `${key} must be true or false`);
      await setPlatformSetting(key, String(value));
      continue;
    }
    if (!EDITABLE.has(key)) throw new ApiError(400, `Unknown setting: ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new ApiError(400, `${key} must be a non-negative number`);
    }
    await setPlatformSetting(key, String(value));
  }
  const settings = await getPlatformSettings();
  return ok({ settings });
});
