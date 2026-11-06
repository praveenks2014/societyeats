import { ApiError } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { log } from '@/lib/log';
import { assertChatParticipant, messagesAfter } from '@/lib/messaging/order-thread';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;
const POLL_MS = 2_000;
/** Autoscale and proxies cut long connections, so each stream ends cleanly after a few minutes; EventSource reconnects with Last-Event-ID. */
const MAX_STREAM_MS = 4 * 60_000;

/**
 * Server-sent events for one order's chat. New messages are `event: message` with the message id as the SSE id, so a reconnect
 * (Last-Event-ID, or ?after=) resumes without gaps or repeats. A `: hb` comment every 25 s keeps proxies from idling the socket.
 * The database is the only shared state (no in-memory pub/sub), so any instance can serve any reconnect.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let orderId = 0;
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession();
    orderId = Number((await ctx.params).id);
    await assertChatParticipant(orderId, session); // 404/403 for non-participants
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const url = new URL(req.url);
  let last = Number(req.headers.get('last-event-id') ?? url.searchParams.get('after') ?? 0) || 0;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => controller.enqueue(enc.encode(s));
      const started = Date.now();
      let lastBeat = started;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', close);
      send('retry: 3000\n\n');
      send(': connected\n\n');
      while (!closed && Date.now() - started < MAX_STREAM_MS) {
        try {
          const msgs = await messagesAfter(orderId, session, last);
          for (const m of msgs) {
            send(`id: ${m.id}\nevent: message\ndata: ${JSON.stringify(m)}\n\n`);
            last = m.id;
          }
        } catch (e) {
          log.error('chat.stream', { orderId, err: e });
          break;
        }
        if (Date.now() - lastBeat >= HEARTBEAT_MS) {
          send(': hb\n\n');
          lastBeat = Date.now();
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
