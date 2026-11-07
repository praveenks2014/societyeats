#!/usr/bin/env node
// Checks the Razorpay keys in the current environment (Replit Secrets): creates a ₹1 order tagged for this app, reads it back, prints id and status.
// It never opens a checkout and never captures anything. Run: npm run razorpay:check
import { pathToFileURL } from 'node:url';

/**
 * Same rules as src/lib/payments/mode.ts (kept in sync by tests/unit/payments-mode.test.ts).
 * @param {Record<string, string | undefined>} env
 */
export function classify(env) {
  if (env.PAYMENTS_ADAPTER === 'mock') return { mode: 'mock', prefix: null };
  const id = (env.RAZORPAY_KEY_ID ?? '').trim();
  if (!id || !(env.RAZORPAY_KEY_SECRET ?? '').trim()) return { mode: 'mock', prefix: null };
  if (id.startsWith('rzp_test_')) return { mode: 'razorpay_test', prefix: 'rzp_test_' };
  if (id.startsWith('rzp_live_')) return { mode: 'razorpay_live', prefix: 'rzp_live_' };
  return { mode: 'invalid', prefix: id.match(/^([A-Za-z0-9]{1,6}_[A-Za-z0-9]{1,6}_)/)?.[1] ?? '(unrecognised)' };
}

/**
 * Returns { code, lines }. `createClient(keyId, keySecret)` is injectable for tests.
 * @param {{ env?: Record<string, string | undefined>, createClient?: (id: string | undefined, secret: string | undefined) => any }} [opts]
 */
export async function run({ env = process.env, createClient } = {}) {
  const lines = [];
  const say = (l) => lines.push(l);
  const { mode, prefix } = classify(env);
  say(`Payments mode: ${mode}${prefix ? ` (key prefix ${prefix})` : ''}`);
  if (mode === 'mock') {
    say('Nothing to check: payments are mocked. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (and remove PAYMENTS_ADAPTER=mock) first.');
    return { code: 2, lines };
  }
  if (mode === 'invalid') {
    say(`The Razorpay key prefix "${prefix}" is not recognised: it must start with rzp_test_ or rzp_live_.`);
    return { code: 2, lines };
  }
  const client = createClient ? createClient(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET) : new (await import('razorpay')).default({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  try {
    const receipt = `pp-smoke-${Date.now()}`;
    const created = await client.orders.create({ amount: 100, currency: 'INR', receipt, notes: { app: 'padosiplate', kind: 'smoke', ref: receipt } });
    const fetched = await client.orders.fetch(created.id);
    say(`Order ${fetched.id}: status ${fetched.status}, ${fetched.amount} paise, receipt ${fetched.receipt}`);
    say('The keys work. Nothing was captured (a ₹1 order stays unpaid).');
    return { code: 0, lines };
  } catch (e) {
    const status = e?.statusCode ?? e?.status;
    if (status === 401) {
      say('Razorpay rejected the keys: check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.');
      return { code: 1, lines };
    }
    say(`Razorpay request failed${status ? ` (HTTP ${status})` : ''}: ${e?.error?.description ?? e?.message ?? 'unknown error'}`);
    return { code: 1, lines };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, lines } = await run();
  for (const l of lines) console.log(l);
  process.exit(code);
}
