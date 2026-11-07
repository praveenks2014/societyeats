import { decryptBytes, encryptBytes } from '@/lib/storage/files';

/** A PAN is 5 letters, 4 digits, 1 letter. The 4th letter encodes the holder type (P = individual). */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const normalisePan = (s: string) => s.replace(/\s+/g, '').toUpperCase();
export const isValidPan = (s: string) => PAN_RE.test(normalisePan(s));

/** ABCDE1234F → ABCDE****F (shown in the UI and exports unless an admin re-authenticates). */
export function maskPan(pan: string): string {
  const p = normalisePan(pan);
  return `${p.slice(0, 5)}****${p.slice(9)}`;
}

/** PAN is encrypted at rest (AES-256-GCM, same helper as ID documents) and never returned by any API. */
export const encryptPan = (pan: string): string => encryptBytes(Buffer.from(normalisePan(pan))).toString('base64');
export const decryptPan = (enc: string): string => decryptBytes(Buffer.from(enc, 'base64')).toString();

/**
 * PanVerifierAdapter: checks a PAN against the holder's name. Mock-first (offline format + a deterministic
 * result); a live adapter (e.g. a KYC provider) plugs in behind PAN_VERIFY_API_KEY without touching callers.
 */
export type PanVerifyResult = { status: 'verified' | 'name_mismatch' | 'invalid' | 'unavailable'; nameOnPan?: string };
export async function verifyPan(pan: string, claimedName: string): Promise<PanVerifyResult> {
  const p = normalisePan(pan);
  if (!PAN_RE.test(p)) return { status: 'invalid' };
  if (process.env.PAN_VERIFY_API_KEY && process.env.MOCK_MODE === 'false') return { status: 'unavailable' }; // live adapter not configured yet
  return { status: 'verified', nameOnPan: claimedName };
}
