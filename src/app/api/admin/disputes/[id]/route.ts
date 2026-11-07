import { z } from 'zod';
import { api, ApiError, ok, readJson } from '@/lib/api';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { applyOutcome, disputeDetail } from '@/lib/disputes';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  await requireSession(['admin']);
  return ok(await disputeDetail(Number(params.id)));
});

const schema = z.object({
  note: z.string().trim().min(3, 'Write a short note for the record').max(500),
  outcome: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('mark_paid') }),
    z.object({ kind: z.literal('mark_unpaid') }),
    z.object({ kind: z.literal('refund_fee') }),
    z.object({ kind: z.literal('issue_credit'), amountPaise: z.number().int().positive() }),
    z.object({ kind: z.literal('warn'), target: z.enum(['buyer', 'seller']), message: z.string().trim().min(3).max(400) }),
    z.object({ kind: z.literal('suspend'), target: z.enum(['buyer', 'seller']), days: z.number().int().min(1).max(365).optional() }),
  ]),
});

/** Decide a dispute. Money and suspension outcomes need a fresh 2FA check; everything is audit-logged. */
export const POST = api<{ params: { id: string } }>(async (req, { params }) => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
  return ok(await applyOutcome(Number(params.id), parsed.data.outcome, parsed.data.note, admin.uid));
});
