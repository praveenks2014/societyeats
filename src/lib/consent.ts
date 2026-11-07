import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { consents } from '@/lib/db/schema';

export type ConsentKind = 'terms' | 'privacy' | 'age18' | 'kitchen_terms' | 'marketing';

/** Consent is explicit (never pre-ticked) and versioned: we store WHAT was accepted, WHEN, and from which IP. */
export async function recordConsent(userId: number, kind: ConsentKind, version: string, ip?: string | null) {
  const db = await getDb();
  await db.insert(consents).values({ userId, kind, version, ip: ip ?? null });
}

export async function latestConsent(userId: number, kind: ConsentKind) {
  const db = await getDb();
  const [row] = await db.select().from(consents).where(and(eq(consents.userId, userId), eq(consents.kind, kind))).orderBy(desc(consents.acceptedAt), desc(consents.id)).limit(1);
  return row ?? null;
}

/** True when the user has accepted exactly this version. A material change bumps the version and asks again. */
export async function hasAccepted(userId: number, kind: ConsentKind, version: string): Promise<boolean> {
  return (await latestConsent(userId, kind))?.version === version;
}
