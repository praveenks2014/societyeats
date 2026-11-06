import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { societyAccessRequests } from '@/lib/db/schema';
import { notifyAdmins } from '@/lib/orders/strikes';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  societyName: z.string().trim().min(2, 'Tell us your society’s name').max(160),
  city: z.string().trim().max(80).optional(),
  contactName: z.string().trim().min(2, 'Your name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: z.string().trim().max(15).optional(),
  message: z.string().trim().max(500).optional(),
});

/** Public: the "Request access for my society" form on the invite-only page. */
export const POST = api(async (req) => {
  await rateLimit(`access-request:${clientIp(req)}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  const session = await getSession();
  const db = await getDb();
  await db.insert(societyAccessRequests).values({ ...parsed.data, userId: session?.uid ?? null });
  await notifyAdmins('New society access request', parsed.data.societyName, '/admin/societies');
  return ok({ ok: true });
});
