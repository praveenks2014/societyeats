import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { blockOther, postMessage, readThread, reportMessage } from '@/lib/messaging/order-thread';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  const session = await requireSession();
  return ok(await readThread(Number(params.id), session));
});

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), body: z.string().max(500).optional(), quickReplyKey: z.string().max(30).optional() }),
  z.object({ action: z.literal('report'), messageId: z.number().int() }),
  z.object({ action: z.literal('block') }),
]);

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession();
  const orderId = Number(params.id);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  const a = parsed.data;
  if (a.action === 'send') {
    await rateLimit(`msg:${session.uid}`, { limit: 30, windowMs: 10 * 60 * 1000 });
    await postMessage(orderId, session, a);
  } else if (a.action === 'report') await reportMessage(orderId, session, a.messageId);
  else await blockOther(orderId, session);
  return ok(await readThread(orderId, session));
});
