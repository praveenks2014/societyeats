import { isMockMode } from '@/lib/config';

/**
 * FSSAI license VERIFICATION adapter (Surepass/AuthBridge-style).
 *
 * Honest reality check: FSSAI's FoSCoS portal has NO public application-
 * submission API. Third parties only offer license *verification*. GharSe
 * therefore verifies existing licenses here — sellers file new applications
 * themselves on FoSCoS, using GharSe's prefilled summary as a walkthrough —
 * never a fake "submitted to government" API.
 */

export type FssaiVerification =
  | {
      valid: true;
      holderName: string;
      status: 'Active';
      licenseType: string;
      expiresOn: string;
      // FSSAI hardening v3 (DECISIONS.md #119+): the licensed address, when
      // the adapter actually returns one — used to compare against the
      // kitchen's own address on the admin "Verify licenses" queue.
      // Deliberately absent in mock mode (an honest adapter doesn't
      // fabricate data it wasn't given), and only best-effort in the live
      // branch below since Surepass's own docs weren't verified for this
      // field's exact shape.
      address?: string;
    }
  | { valid: false; reason: string };

export async function verifyFssaiLicense(licenseNumber: string): Promise<FssaiVerification> {
  const clean = licenseNumber.replace(/\s/g, '');
  if (!/^\d{14}$/.test(clean)) {
    return { valid: false, reason: 'FSSAI license numbers are exactly 14 digits' };
  }

  if (isMockMode() || !process.env.FSSAI_VERIFY_API_KEY) {
    // deterministic mock with simulated latency; numbers ending 0000 fail so
    // the error path is demoable
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 600));
    if (clean.endsWith('0000')) {
      return { valid: false, reason: 'License number not found in FoSCoS records (simulated)' };
    }
    const names = ['Lakshmi Devi', 'S. Iyer', 'A. Sen', 'K. Jain', 'R. Malhotra', 'H. Kaur'];
    const holderName = names[Number(clean[13]) % names.length];
    return {
      valid: true,
      holderName,
      status: 'Active',
      licenseType: clean.startsWith('1') ? 'Central License' : 'State License',
      expiresOn: '2027-06-30',
    };
  }

  // Live branch: Surepass-style REST call.
  // VERIFY against provider docs when keys arrive (e.g. Surepass "FSSAI Verification" API).
  const res = await fetch('https://kyc-api.surepass.io/api/v1/corporate/fssai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.FSSAI_VERIFY_API_KEY}`,
    },
    body: JSON.stringify({ id_number: clean }),
  });
  if (!res.ok) return { valid: false, reason: `Verification service error (HTTP ${res.status})` };
  const data = await res.json();
  const d = data?.data;
  if (!d || data.success === false) {
    return { valid: false, reason: 'License number not found in FoSCoS records' };
  }
  return {
    valid: true,
    holderName: d.name ?? d.company_name ?? 'License holder',
    status: 'Active',
    licenseType: d.license_type ?? 'State License',
    expiresOn: d.expiry_date ?? '',
    address: d.address ?? d.registered_address ?? undefined,
  };
}
