import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { sendVerificationEmail } from '@/lib/auth/mail';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = api(async () => {
  const session = await requireSession();
  await rateLimit(`resend-verify:${session.uid}`, { limit: 3, windowMs: 15 * 60 * 1000 });
  await sendVerificationEmail(session.uid);
  return ok({ ok: true });
});
