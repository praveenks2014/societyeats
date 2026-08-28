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
]);

export const GET = api(async () => {
  await requireSession(['admin']);
  const settings = await getPlatformSettings();
  return ok({ settings, mockMode: isMockMode() });
});

export const PATCH = api(async (req) => {
  await requireSession(['admin']);
  const body = await readJson<Record<string, number>>(req);
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE.has(key)) throw new ApiError(400, `Unknown setting: ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new ApiError(400, `${key} must be a non-negative number`);
    }
    await setPlatformSetting(key, String(value));
  }
  const settings = await getPlatformSettings();
  return ok({ settings });
});
