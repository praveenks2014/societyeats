import { ApiError } from '@/lib/api';
import { isMockMode } from '@/lib/config';
import { getPlatformSettings } from '@/lib/db/platform';
import type { PlatformSettings } from '@/lib/settings/defs';

/**
 * Live mode (MOCK_MODE=false) takes real money, so it is refused until the legal groundwork is recorded:
 *   - the platform's own FSSAI Central licence (e-commerce operators need one regardless of turnover)
 *   - the GST position confirmed by a CA (date + note)
 *   - a grievance officer and a legal entity name + address (Consumer Protection (E-Commerce) Rules)
 */
export function liveModeMissing(s: Pick<PlatformSettings, 'platformFssaiCentralLicenseNo' | 'gstPositionConfirmedAt' | 'grievanceOfficer' | 'legalEntityName' | 'registeredAddress'>): string[] {
  const missing: string[] = [];
  if (!s.platformFssaiCentralLicenseNo) missing.push('the platform FSSAI Central licence number');
  if (!s.gstPositionConfirmedAt?.trim()) missing.push('the GST position confirmation (date and note)');
  if (!s.grievanceOfficer?.trim()) missing.push('the grievance officer');
  if (!s.legalEntityName?.trim() || !s.registeredAddress?.trim()) missing.push('the legal entity name and registered address');
  return missing;
}

/**
 * Throws 503 for real-money operations while a configuration prerequisite is open. Uses the same list as /admin/go-live
 * (`configBlockers`), and does no I/O beyond the settings read: a late cron run or a storage blip is an alert, never a stopped order.
 */
export async function assertLiveModeReady(settings?: PlatformSettings): Promise<void> {
  if (isMockMode()) return;
  const { configBlockers } = await import('@/lib/go-live');
  const blockers = configBlockers(settings ?? (await getPlatformSettings()));
  if (blockers.length) throw new ApiError(503, `Live orders are paused until these are done (Admin → Go-live): ${blockers.map((b) => b.label).join('; ')}.`);
}
