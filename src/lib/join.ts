import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sellerProfiles, societies, users } from '@/lib/db/schema';
import { kitchenGate } from '@/lib/kitchen/gate';

/** The society behind an invite code (active only), plus how many kitchens are live there. */
export async function societyForInvite(code: string) {
  const db = await getDb();
  const [society] = await db.select().from(societies).where(and(eq(societies.inviteCode, code.trim().toUpperCase()), eq(societies.isActive, true)));
  if (!society) return null;
  const sellers = await db
    .select({ id: sellerProfiles.userId })
    .from(sellerProfiles)
    .innerJoin(users, eq(sellerProfiles.userId, users.id))
    .where(and(eq(users.societyId, society.id), eq(sellerProfiles.listingState, 'approved')));
  let live = 0;
  for (const s of sellers) if ((await kitchenGate(s.id)).ok) live++;
  return { society, liveKitchens: live };
}
