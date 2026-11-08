import { and, eq, like, or } from 'drizzle-orm';
import { BRAND } from '@/config/brand';
import type { Db } from '@/lib/db';
import { disclaimers, disclaimerVersions, fssaiWalkthroughSteps } from '@/lib/db/schema';

/** The product names this database may still carry in seeded text, as [old, replacement]. */
const LEGACY: (readonly [string, string])[] = [...BRAND.legacyNames.map((n) => [n, BRAND.name] as const), ...BRAND.legacySlugs.map((s) => [s, BRAND.slug] as const)];

export function renameBrandText(text: string | null): string | null {
  if (text == null) return text;
  return LEGACY.reduce((t, [from, to]) => t.split(from).join(to), text);
}

/**
 * After a rename, text that was SEEDED under the old name is updated to the new one. Idempotent, and it never touches text an admin wrote:
 * a disclaimer is only changed while it is still version 1 (an admin edit makes version 2+), the FSSAI walkthrough is seeded content.
 */
export async function renameSeededBrandText(db: Db): Promise<{ disclaimers: number; fssaiSteps: number }> {
  let nd = 0;
  let ns = 0;
  const patterns = LEGACY.map(([from]) => `%${from}%`);
  for (const d of await db.select().from(disclaimers).where(and(eq(disclaimers.version, 1), or(...patterns.map((p) => like(disclaimers.text, p)))))) {
    const text = renameBrandText(d.text)!;
    await db.update(disclaimers).set({ text }).where(and(eq(disclaimers.id, d.id), eq(disclaimers.version, 1)));
    await db.update(disclaimerVersions).set({ text }).where(and(eq(disclaimerVersions.disclaimerId, d.id), eq(disclaimerVersions.version, 1)));
    nd++;
  }
  for (const step of await db.select().from(fssaiWalkthroughSteps)) {
    const next = { title: renameBrandText(step.title)!, body: renameBrandText(step.body)!, tip: renameBrandText(step.tip) };
    if (next.title !== step.title || next.body !== step.body || next.tip !== step.tip) {
      await db.update(fssaiWalkthroughSteps).set(next).where(eq(fssaiWalkthroughSteps.id, step.id));
      ns++;
    }
  }
  return { disclaimers: nd, fssaiSteps: ns };
}
