import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { disclaimers, disclaimerVersions } from '@/lib/db/schema';
import { DISCLAIMER_DEFAULTS, DISCLAIMER_IDS, type DisclaimerId } from '@/lib/disclaimers/defs';

type Db = Awaited<ReturnType<typeof getDb>>;

/** Idempotent: inserts missing disclaimers at version 1 and never touches an existing (possibly admin-edited) row. */
export async function seedDisclaimers(db?: Db): Promise<number> {
  const d = db ?? (await getDb());
  let added = 0;
  for (const id of DISCLAIMER_IDS) {
    const rows = await d.insert(disclaimers).values({ id, version: 1, text: DISCLAIMER_DEFAULTS[id] }).onConflictDoNothing().returning({ id: disclaimers.id });
    if (rows.length) {
      added++;
      await d.insert(disclaimerVersions).values({ disclaimerId: id, version: 1, text: DISCLAIMER_DEFAULTS[id] }).onConflictDoNothing();
    }
  }
  return added;
}

/** Text for a disclaimer: the DB version, or the built-in default if the row is missing (e.g. before bootstrap). */
export async function getDisclaimerText(id: DisclaimerId): Promise<string> {
  try {
    const db = await getDb();
    const [row] = await db.select({ text: disclaimers.text }).from(disclaimers).where(eq(disclaimers.id, id));
    return row?.text ?? DISCLAIMER_DEFAULTS[id];
  } catch {
    return DISCLAIMER_DEFAULTS[id];
  }
}

export { fillDisclaimer } from '@/lib/disclaimers/fill';

export async function listDisclaimers() {
  const db = await getDb();
  return db.select().from(disclaimers).orderBy(disclaimers.id);
}

export async function disclaimerHistory(id: DisclaimerId) {
  const db = await getDb();
  return db.select().from(disclaimerVersions).where(eq(disclaimerVersions.disclaimerId, id)).orderBy(desc(disclaimerVersions.version));
}

/** Publishes a new version of a disclaimer (admin, re-auth required by the caller). */
export async function updateDisclaimer(id: DisclaimerId, text: string, adminId: number): Promise<number> {
  const clean = text.trim();
  if (clean.length < 10 || clean.length > 1200) throw new Error('Disclaimer text must be 10–1200 characters');
  const db = await getDb();
  await db.insert(disclaimers).values({ id, version: 1, text: DISCLAIMER_DEFAULTS[id] }).onConflictDoNothing();
  const [cur] = await db.select().from(disclaimers).where(eq(disclaimers.id, id));
  if (cur.text === clean) return cur.version;
  const version = cur.version + 1;
  await db.update(disclaimers).set({ text: clean, version, updatedAt: new Date(), updatedBy: adminId }).where(and(eq(disclaimers.id, id), eq(disclaimers.version, cur.version)));
  await db.insert(disclaimerVersions).values({ disclaimerId: id, version, text: clean, changedBy: adminId });
  return version;
}
