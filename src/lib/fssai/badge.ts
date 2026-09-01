/**
 * FSSAI hardening v3 (DECISIONS.md #119+) — the single place that turns a
 * seller's FSSAI state into the badge text/tone shown across the app
 * (browse cards, dish/kitchen pages, admin sellers list, the compliance
 * page itself), per the founder's spec item 4:
 *   "FSSAI applied · ref XXXX" once filed and eligible;
 *   "FSSAI verified" once verified;
 *   'awaiting_admin_check' shows "Verification in progress".
 * Pure and DB-free so it can run in both server and client components.
 */

export type FssaiBadgeStatus = 'verified' | 'pending_application' | 'unverified' | 'awaiting_admin_check';

export type FssaiBadgeInput = {
  fssaiStatus: FssaiBadgeStatus;
  fssaiNumber?: string | null;
  /**
   * The application's foscosRefNumber, but ONLY when
   * isFssaiEligibleToPublish's deemed-commencement branch is true (i.e.
   * fssaiFiledEligible() in src/lib/fssai/gate.ts) — pass null/undefined
   * otherwise, even if a reference number exists but isn't old enough yet.
   */
  eligibleFoscosRef?: string | null;
};

export type FssaiBadge = { label: string; tone: 'green' | 'amber' | 'neutral' };

export function fssaiBadge({ fssaiStatus, fssaiNumber, eligibleFoscosRef }: FssaiBadgeInput): FssaiBadge {
  if (fssaiStatus === 'verified') {
    return {
      label: fssaiNumber ? `FSSAI Verified ✅ · Lic. ${fssaiNumber}` : 'FSSAI Verified ✅',
      tone: 'green',
    };
  }
  // Independent of fssaiStatus on purpose — see isFssaiEligibleToPublish's
  // own doc comment (a seller mid "enter it anytime" check keeps whatever
  // publishing/display rights their filed application already earned).
  if (eligibleFoscosRef) {
    return { label: `FSSAI applied · ref ${eligibleFoscosRef}`, tone: 'amber' };
  }
  if (fssaiStatus === 'awaiting_admin_check') {
    return { label: 'Verification in progress', tone: 'amber' };
  }
  if (fssaiStatus === 'pending_application') {
    return { label: 'FSSAI Pending — application under process', tone: 'amber' };
  }
  return { label: 'FSSAI not yet verified', tone: 'neutral' };
}
