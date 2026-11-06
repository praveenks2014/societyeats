import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { adminMayRead, adminReadThread } from '@/lib/messaging/order-thread';

export const dynamic = 'force-dynamic';

/** Whether an admin may open this chat (a dispute or a reported message exists). Reveals nothing about the content. */
export const GET = api<{ params: { orderId: string } }>(async (_req, { params }) => {
  await requireSession(['admin']);
  return ok({ mayRead: await adminMayRead(Number(params.orderId)) });
});

/** Open a chat for review: needs a reason and a fresh 2FA check; the read is audit-logged with the reason. */
export const POST = api<{ params: { orderId: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  const parsed = z.object({ reason: z.string().trim().min(5, 'Say why you are opening this chat').max(300) }).safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  return ok(await adminReadThread(Number(params.orderId), admin, parsed.data.reason));
});
