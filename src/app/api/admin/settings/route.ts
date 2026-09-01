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
  'fssaiSponsorshipCapPerCohort',
  // Pilot Hardening v2 — Phase 6 (DECISIONS.md #87+).
  'referralCreditPaise',
  'referralCreditCapPerUser',
  // Pilot Hardening v2 — Phase 7 (Pilot metrics dashboard, DECISIONS.md #99+).
  'killWeek8PenetrationPct',
  'killWeek8RetentionPct',
  'killWeek14PenetrationPct',
  'killWeek14RetentionPct',
]);
// platform_config values are always stored as text; booleans get their own
// set so PATCH knows to expect true/false instead of a non-negative number.
const EDITABLE_BOOL = new Set(['platformDeliveryEnabled']);
// Pilot Hardening v2 — Phase 4 (DECISIONS.md #62+): free-text settings, kept
// separate from EDITABLE (numbers) so PATCH can apply the right validation.
const EDITABLE_TEXT = new Set(['platformFssaiCentralLicenseNo']);

export const GET = api(async () => {
  await requireSession(['admin']);
  const settings = await getPlatformSettings();
  return ok({ settings, mockMode: isMockMode() });
});

export const PATCH = api(async (req) => {
  await requireSession(['admin']);
  const body = await readJson<Record<string, number | boolean | string>>(req);
  for (const [key, value] of Object.entries(body)) {
    if (EDITABLE_BOOL.has(key)) {
      if (typeof value !== 'boolean') throw new ApiError(400, `${key} must be true or false`);
      await setPlatformSetting(key, String(value));
      continue;
    }
    if (EDITABLE_TEXT.has(key)) {
      if (typeof value !== 'string') throw new ApiError(400, `${key} must be text`);
      const clean = value.trim();
      // FSSAI license numbers are 14 digits; an empty string is the valid
      // "not yet entered" state that keeps the live-order block active.
      if (clean !== '' && !/^\d{14}$/.test(clean)) {
        throw new ApiError(400, `${key} must be a 14-digit FSSAI license number, or blank`);
      }
      await setPlatformSetting(key, clean);
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
