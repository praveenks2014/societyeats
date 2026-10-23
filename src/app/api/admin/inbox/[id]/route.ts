import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { adminSend, getThread, markThreadRead } from '@/lib/messaging/admin-threads';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  await requireSession(['admin']);
  const t = await getThread(Number(params.id));
  if (!t) throw new ApiError(404, 'Thread not found');
  await markThreadRead(t.thread.id, 'admin');
  return ok(t);
});

const schema = z.object({ body: z.string().trim().min(1).max(4000), attachments: z.array(z.object({ url: z.string(), name: z.string() })).max(5).optional() });

export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  const t = await getThread(Number(params.id));
  if (!t) throw new ApiError(404, 'Thread not found');
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'Write a message first');
  return ok(await adminSend({ adminId: admin.uid, sellerId: t.thread.sellerId, threadId: t.thread.id, body: parsed.data.body, attachments: parsed.data.attachments }));
});
