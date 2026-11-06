import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { blockOther, markRead, postMessage, readThread, reportMessage, reportUser, setPhoneShare } from '@/lib/messaging/order-thread';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** The thread. Sends an ETag; a client that already has this version gets a 304 (the polling fallback uses it). */
export const GET = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession();
  const markReadFlag = req.nextUrl.searchParams.get('markRead') === '1';
  const thread = await readThread(Number(params.id), session, { markRead: markReadFlag });
  if (!markReadFlag && req.headers.get('if-none-match') === thread.etag) return new NextResponse(null, { status: 304, headers: { ETag: thread.etag } });
  return NextResponse.json(thread, { headers: { ETag: thread.etag, 'Cache-Control': 'private, no-store' } });
});

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), body: z.string().max(4000).optional(), quickReplyKey: z.string().max(30).optional(), imageKey: z.string().max(80).optional(), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal('report'), messageId: z.number().int() }),
  z.object({ action: z.literal('report_user'), reason: z.string().max(1000).default('') }),
  z.object({ action: z.literal('block') }),
  z.object({ action: z.literal('share_phone'), on: z.boolean() }),
  z.object({ action: z.literal('mark_read') }),
]);

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession();
  const orderId = Number(params.id);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Invalid request');
  const a = parsed.data;
  let warnings: unknown = undefined;
  let sentId: number | undefined;
  let reported: number | null | undefined;
  switch (a.action) {
    case 'send': {
      await rateLimit(`msg:${session.uid}`, { limit: 40, windowMs: 10 * 60 * 1000 });
      const r = await postMessage(orderId, session, a);
      if (r.sent) sentId = r.message.id;
      else warnings = r.warnings;
      break;
    }
    case 'report':
      await rateLimit(`chat-report:${session.uid}`, { limit: 10, windowMs: 60 * 60 * 1000 });
      reported = (await reportMessage(orderId, session, a.messageId)).grievanceId;
      break;
    case 'report_user':
      await rateLimit(`chat-report:${session.uid}`, { limit: 10, windowMs: 60 * 60 * 1000 });
      reported = (await reportUser(orderId, session, a.reason)).grievanceId;
      break;
    case 'block':
      await blockOther(orderId, session);
      break;
    case 'share_phone':
      await setPhoneShare(orderId, session, a.on);
      break;
    case 'mark_read':
      break;
  }
  const thread = await readThread(orderId, session, { markRead: a.action === 'mark_read' || a.action === 'send' });
  return ok({ ...thread, ...(warnings ? { warnings, sent: false } : a.action === 'send' ? { sent: true, sentId } : {}), ...(reported !== undefined ? { grievanceId: reported } : {}) });
});
