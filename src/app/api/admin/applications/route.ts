import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { applicationsQueue, CHANGE_TEMPLATES } from '@/lib/admin/checklist';

export const dynamic = 'force-dynamic';

/** Kitchens waiting for a decision, each with its pass/flag/fail checklist and its age against the review target. */
export const GET = api(async () => {
  await requireSession(['admin']);
  const queue = await applicationsQueue();
  return ok({ applications: queue, templates: CHANGE_TEMPLATES, overdue: queue.filter((q) => q.overdue).length });
});
