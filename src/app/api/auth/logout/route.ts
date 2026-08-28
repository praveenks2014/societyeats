import { api, ok } from '@/lib/api';
import { clearSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const POST = api(async () => {
  clearSessionCookie();
  return ok({ ok: true });
});
