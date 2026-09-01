import { desc, eq } from 'drizzle-orm';
import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { referralCredits, users } from '@/lib/db/schema';
import { getPlatformSettings } from '@/lib/db/platform';
import { referralCodeFor } from '@/lib/referrals';

export const dynamic = 'force-dynamic';

/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md
 * #87+). Powers the /refer page and checkout's "apply credit" toggle.
 * Any signed-in role can refer neighbours (this app already lets any role
 * place a buyer order — see /api/orders — so a seller/admin/restaurant
 * account referring someone and later redeeming the credit at their own
 * checkout is consistent, not a new carve-out).
 */
export const GET = api(async () => {
  const session = await requireSession();
  const db = await getDb();
  const [me] = await db.select().from(users).where(eq(users.id, session.uid));

  // Self-heal for accounts created before this phase (referralCode was added
  // as a nullable column — DECISIONS.md #87+) rather than requiring a
  // one-off backfill migration.
  let referralCode = me.referralCode;
  if (!referralCode) {
    referralCode = referralCodeFor(session.uid);
    await db.update(users).set({ referralCode }).where(eq(users.id, session.uid));
  }

  const settings = await getPlatformSettings();
  const rows = await db
    .select()
    .from(referralCredits)
    .where(eq(referralCredits.buyerId, session.uid))
    .orderBy(desc(referralCredits.createdAt));
  const availablePaise = rows
    .filter((r) => r.status === 'available')
    .reduce((sum, r) => sum + r.amountInPaise, 0);

  return ok({
    referralCode,
    creditPaise: settings.referralCreditPaise,
    capPerUser: settings.referralCreditCapPerUser,
    grantedCount: rows.length,
    availablePaise,
    credits: rows.map((r) => ({
      id: r.id,
      amountInPaise: r.amountInPaise,
      status: r.status,
      createdAt: r.createdAt,
    })),
  });
});
