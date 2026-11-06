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

/** Throws 503 for real-money operations while live mode is not yet cleared. */
export async function assertLiveModeReady(settings?: PlatformSettings): Promise<void> {
  if (isMockMode()) return;
  const s = settings ?? (await getPlatformSettings());
  const missing = liveModeMissing(s);
  if (missing.length) throw new ApiError(503, `Live orders are paused until these are recorded in admin settings: ${missing.join('; ')}.`);
}
