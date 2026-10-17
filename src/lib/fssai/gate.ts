import type { fssaiApplications, sellerProfiles } from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';
import { istDateString } from '@/lib/time';

/**
 * FSSAI hardening v3 (DECISIONS.md #119+) — the publishing gate.
 *
 * FSSAI's Basic Registration and State License rules both include a
 * "deemed commencement" provision: if the department hasn't acted on a
 * filed application within a fixed window, the applicant may treat it as
 * granted and start operating — UNLESS the department responded within
 * that window (a rejection, an inspection order, or, for State License, an
 * inadequacy notice). FoSCoS has no status API to detect any of that
 * automatically (see DECISIONS.md), so PadosiPlate tracks it by reference number
 * + elapsed time, with an admin able to record an interrupting response by
 * hand (see fssaiAppStatusEnum's 'inspection_ordered'/'inadequacy_notice').
 */
export const FSSAI_DEEMED_GRANT_DAYS = {
  registration: DEFAULTS.fssaiDeemedGrantDaysRegistration,
  state: DEFAULTS.fssaiDeemedGrantDaysState,
} as const;

type Profile = Pick<typeof sellerProfiles.$inferSelect, 'fssaiStatus'> & { fssaiExpiry?: string | null };
type Application = Pick<
  typeof fssaiApplications.$inferSelect,
  'status' | 'foscosRefNumber' | 'filedAt' | 'licenseType'
> | null;

/**
 * True once a filed application has sat at 'filed_on_foscos' (with a real
 * reference number) past its licenseType's deemed-commencement window.
 * Any other status — including the two interrupting ones above, or
 * 'granted'/'rejected' — returns false: this function only describes the
 * *regulatory-presumption* path, not "has a license" in general (that's
 * `profile.fssaiStatus === 'verified'`, checked separately by callers).
 */
export function fssaiFiledEligible(app: Application): boolean {
  if (!app || app.status !== 'filed_on_foscos' || !app.foscosRefNumber || !app.filedAt) return false;
  const elapsedDays = (Date.now() - app.filedAt.getTime()) / (24 * 60 * 60 * 1000);
  return elapsedDays > FSSAI_DEEMED_GRANT_DAYS[app.licenseType];
}

export type FssaiDeemedGrantInfo = {
  licenseType: 'registration' | 'state';
  thresholdDays: number;
  daysElapsed: number;
  /** null once the threshold has already passed (nothing left to count down). */
  daysRemaining: number | null;
  eligible: boolean;
};

/**
 * Display-only counterpart to fssaiFiledEligible() above, for the
 * compliance page's "days until you may be able to go live" messaging and
 * the reminder notification (src/lib/fssai/reminders.ts) — same
 * filed_on_foscos + foscosRefNumber + filedAt precondition, just returning
 * the elapsed/remaining days instead of a plain boolean. Returns null when
 * that precondition isn't met (nothing meaningful to show).
 */
export function fssaiDeemedGrantInfo(app: Application): FssaiDeemedGrantInfo | null {
  if (!app || app.status !== 'filed_on_foscos' || !app.foscosRefNumber || !app.filedAt) return null;
  const daysElapsed = (Date.now() - app.filedAt.getTime()) / (24 * 60 * 60 * 1000);
  const thresholdDays = FSSAI_DEEMED_GRANT_DAYS[app.licenseType];
  return {
    licenseType: app.licenseType,
    thresholdDays,
    daysElapsed: Math.floor(daysElapsed),
    daysRemaining: daysElapsed >= thresholdDays ? null : Math.ceil(thresholdDays - daysElapsed),
    eligible: daysElapsed > thresholdDays,
  };
}

/**
 * The founder's spec, item 4: a seller may publish (create or re-activate a
 * listing — see assertCanPublish in src/lib/seller.ts) only if their FSSAI
 * status is verified, OR their most recent application is deemed-eligible
 * per fssaiFiledEligible() above. Deliberately independent of
 * `profile.fssaiStatus` on the application branch — a seller who has since
 * used the "enter it anytime" card (moving fssaiStatus to
 * 'awaiting_admin_check') keeps whatever publishing rights their filed
 * application already earned them; 'draft' and 'submitted_to_backoffice'
 * never qualify (status simply isn't 'filed_on_foscos' yet).
 */
export function isFssaiEligibleToPublish(profile: Profile, latestApplication: Application, now: Date = new Date()): boolean {
  if (profile.fssaiStatus === 'verified') {
    // Licence expiry is enforced: an expired licence unpublishes the kitchen
    // until it is renewed (dates compared as IST calendar days).
    if (isFssaiExpired(profile.fssaiExpiry, now)) return false;
    return true;
  }
  return fssaiFiledEligible(latestApplication);
}

/** True when the recorded licence/registration expiry date (YYYY-MM-DD) is before today (IST). */
export function isFssaiExpired(expiry: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiry) return false;
  return expiry < istDateString(now);
}
