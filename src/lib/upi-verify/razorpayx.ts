import { BRAND } from '@/config/brand';

/**
 * RazorpayX reverse penny drop (live mode only; needs a RazorpayX account and RAZORPAYX_ACCOUNT_NUMBER).
 * The seller pays ₹1 from THEIR UPI app via an intent link; Razorpay reports the VPA that actually paid and
 * the bank-registered name — proof of ownership. Field names follow the Fund Account Validation (UPI intent) API.
 */
export type RpdValidation = {
  id: string;
  status: 'created' | 'completed' | 'failed' | string;
  upiIntentUrl: string | null;
  vpa: string | null;
  registeredName: string | null;
  maskedAccount: string | null;
  ifsc: string | null;
  bankName: string | null;
};

type Fetcher = typeof fetch;

function authHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing');
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

export function parseValidation(j: Record<string, any>): RpdValidation {
  const r = j.results ?? {};
  const upi = j.upi_intent ?? j.upi ?? {};
  const bank = j.bank_account ?? j.fund_account?.bank_account ?? {};
  const acct = String(bank.account_number ?? r.account_number ?? '');
  return {
    id: String(j.id),
    status: String(j.status ?? 'created'),
    upiIntentUrl: upi.link ?? upi.intent_link ?? upi.url ?? null,
    vpa: upi.vpa ?? r.vpa ?? null,
    registeredName: r.registered_name ?? upi.registered_name ?? null,
    maskedAccount: acct ? `••••${acct.slice(-4)}` : null,
    ifsc: bank.ifsc ?? null,
    bankName: bank.bank_name ?? r.bank_name ?? null,
  };
}

export async function createUpiIntentValidation(ref: string, fetcher: Fetcher = fetch): Promise<RpdValidation> {
  const source = process.env.RAZORPAYX_ACCOUNT_NUMBER;
  if (!source) throw new Error('RAZORPAYX_ACCOUNT_NUMBER is required for razorpayx_rpd');
  const res = await fetcher('https://api.razorpay.com/v1/fund_accounts/validations', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_account_number: source, validation_type: 'upi_intent', reference_id: ref, notes: { purpose: `${BRAND.slug}_upi_ownership` } }),
  });
  if (!res.ok) throw new Error(`RazorpayX validation failed (${res.status})`);
  return parseValidation(await res.json());
}

export async function fetchValidation(id: string, fetcher: Fetcher = fetch): Promise<RpdValidation> {
  const res = await fetcher(`https://api.razorpay.com/v1/fund_accounts/validations/${encodeURIComponent(id)}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error(`RazorpayX fetch failed (${res.status})`);
  return parseValidation(await res.json());
}
