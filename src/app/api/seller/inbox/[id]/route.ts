import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getThread, markThreadRead, sellerReply } from '@/lib/messaging/admin-threads';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  const session = await requireSession(['seller']);
  const t = await getThread(Number(params.id));
  if (!t || t.thread.sellerId !== session.uid) throw new ApiError(404, 'Thread not found');
  await markThreadRead(t.thread.id, 'seller');
  return ok(t);
});

const schema = z.object({ body: z.string().trim().min(1, 'Write a message first').max(4000), attachments: z.array(z.object({ url: z.string(), name: z.string() })).max(5).optional() });

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireSession(['seller']);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  return ok(await sellerReply({ sellerId: session.uid, threadId: Number(params.id), body: parsed.data.body, attachments: parsed.data.attachments }));
});
