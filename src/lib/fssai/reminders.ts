import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notifications, type fssaiApplications } from '@/lib/db/schema';
import { notify } from '@/lib/db/notify';
import { fssaiDeemedGrantInfo } from '@/lib/fssai/gate';

/**
 * FSSAI hardening v3 (DECISIONS.md #119+) — item 5's in-app reminder.
 * FoSCoS has no status API (see DECISIONS.md), so this is entirely
 * reference-number + elapsed-time based: computed lazily whenever the
 * seller's own summary is fetched (GET /api/seller/summary, polled by
 * /seller/compliance on load) — same "no cron, compute it when someone
 * looks" philosophy this codebase already uses for slot capacity and the
 * hygiene auto-pause counter — rather than a background job.
 *
 * Reuses the existing bell/toast `notify()` mechanism (src/lib/db/notify.ts)
 * rather than inventing a new notification system, matching the app's other
 * lazy, request-triggered nudges (e.g. the kitchen-photos onboarding
 * banner). Deduped on (userId, title, href) so a seller with the compliance
 * page open doesn't get re-notified on every poll — a real limitation at
 * pilot scale is that a seller with more than one application over time
 * would only ever get this fixed-title reminder once; acceptable given a
 * seller filing a second application after this one is a rare edge case
 * this codebase already doesn't handle specially elsewhere either.
 */
const REMINDER_TITLE = 'You may be able to go live under FSSAI regulation 📋';

export async function maybeNotifyDeemedGrantWindow(
  sellerId: number,
  application: typeof fssaiApplications.$inferSelect | null,
): Promise<void> {
  const info = fssaiDeemedGrantInfo(application);
  if (!info?.eligible || !application) return;

  const db = await getDb();
  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, sellerId), eq(notifications.title, REMINDER_TITLE)));
  if (existing) return;

  await notify(
    sellerId,
    REMINDER_TITLE,
    `Your FoSCoS filing (ref ${application.foscosRefNumber}) has had no response for over ${info.thresholdDays} days — under the regulation you may be able to go live now. As soon as FoSCoS actually grants your license, come back and enter the number on your Compliance page so we can show your verified badge.`,
    '/seller/compliance',
  );
}
