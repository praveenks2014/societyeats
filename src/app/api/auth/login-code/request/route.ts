import { api, ApiError, ok, readJson } from '@/lib/api';
import { issueLoginCode } from '@/lib/auth/login-code';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Always answers the same, whether or not the address has an account. Limited per email and per IP. */
export const POST = api(async (req) => {
  const { email } = await readJson<{ email: string }>(req);
  const e = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new ApiError(400, 'Enter a valid email address');
  await rateLimit(`login-code-ip:${clientIp(req)}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  await rateLimit(`login-code-email:${e}`, { limit: 3, windowMs: 15 * 60 * 1000 });
  await issueLoginCode(e);
  return ok({ ok: true, message: 'If that email has an account, a 6-digit code is on its way.' });
});
