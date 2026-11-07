import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notifications, files, fssaiApplications, sellerProfiles } from '@/lib/db/schema';
import { notifyUser } from '@/lib/db/notify';
import { getPlatformSettings } from '@/lib/db/platform';
import { getStorage } from '@/lib/storage';
import { keyFromUrl } from '@/lib/storage/files';
import { DAY_MS, istDateString } from '@/lib/time';
import { log } from '@/lib/log';
import { fssaiTierInfo } from '@/lib/fssai/tier';

async function once(userId: number, key: string, title: string, body: string, href: string): Promise<boolean> {
  const db = await getDb();
  const tag = `${href}?r=${key}`; // the href doubles as the de-dup key
  const [seen] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.href, tag)));
  if (seen) return false;
  await notifyUser(userId, title, body, tag, { email: true, emailKind: 'fssai_reminder' });
  return true;
}

/**
 * FSSAI scheduled work (idempotent):
 *  - day 3 and day 6 after the seller files on FoSCoS: "check your application"
 *  - 30 days before a licence/registration expires: renewal reminder
 *  - on expiry: tell the seller their listings are unpublished (the publishing
 *    gate itself already treats an expired licence as ineligible)
 *  - purge ID/address documents whose retention window has passed
 */
export async function runFssaiJobs(now: Date = new Date()): Promise<Record<string, number>> {
  const db = await getDb();
  const out = { day3: 0, day6: 0, expiry30: 0, expired: 0, purged: 0, annualFee: 0, provisionalEnded: 0 };

  const filed = await db.select().from(fssaiApplications).where(and(eq(fssaiApplications.status, 'filed_on_foscos'), isNotNull(fssaiApplications.filedAt)));
  for (const a of filed) {
    const days = (now.getTime() - a.filedAt!.getTime()) / DAY_MS;
    if (days >= 3 && (await once(a.sellerId, `d3-${a.id}`, 'FSSAI: 3 days since you filed', `Check your application status on foscos.fssai.gov.in (ref ${a.foscosRefNumber ?? '—'}). Reply to any query from FSSAI quickly.`, '/seller/compliance'))) out.day3++;
    if (days >= 6 && (await once(a.sellerId, `d6-${a.id}`, 'FSSAI: 6 days since you filed', `Basic Registration is deemed granted if there is no response in 7 days — check foscos.fssai.gov.in today (ref ${a.foscosRefNumber ?? '—'}).`, '/seller/compliance'))) out.day6++;
  }

  const verified = await db.select().from(sellerProfiles).where(and(eq(sellerProfiles.fssaiStatus, 'verified'), isNotNull(sellerProfiles.fssaiExpiry)));
  const today = istDateString(now);
  for (const p of verified) {
    const expiry = p.fssaiExpiry!;
    const daysLeft = Math.floor((new Date(`${expiry}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY_MS);
    if (daysLeft < 0) {
      if (await once(p.userId, `exp-${expiry}`, 'Your FSSAI has expired — listings paused', 'Your dishes are hidden until you renew and enter the new expiry date on the FSSAI page.', '/seller/compliance')) out.expired++;
    } else if (daysLeft <= 30) {
      if (await once(p.userId, `exp30-${expiry}`, `Your FSSAI expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, 'Renew on foscos.fssai.gov.in before it lapses — an expired licence automatically unpublishes your listings.', '/seller/compliance')) out.expiry30++;
    }
  }

  // Registrations are perpetual (no expiry date), but ₹100 a year is still payable on FoSCoS: remind before each anniversary.
  const settings = await getPlatformSettings();
  const registered = await db.select().from(sellerProfiles).where(eq(sellerProfiles.fssaiStatus, 'verified'));
  for (const p of registered) {
    const since = p.fssaiGrantedAt ? new Date(`${p.fssaiGrantedAt}T00:00:00Z`) : p.fssaiVerifiedAt;
    if (!since) continue;
    const next = new Date(since);
    while (next.getTime() <= now.getTime()) next.setUTCFullYear(next.getUTCFullYear() + 1);
    const daysTo = Math.ceil((next.getTime() - now.getTime()) / DAY_MS);
    if (daysTo <= settings.fssaiAnnualFeeReminderDays) {
      if (await once(p.userId, `fee-${next.getUTCFullYear()}`, 'FSSAI annual fee due soon', `Your FSSAI registration does not expire, but the annual fee (₹${settings.fssaiBasicFeePerYear}) is due around ${next.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}. Pay it only on the official FoSCoS portal — never to an agent.`, '/seller/compliance')) out.annualFee++;
    }
  }

  // A provisional kitchen whose provisional period ran out without verification is hidden — tell the seller (and admins) once.
  const provisional = await db.select().from(sellerProfiles).where(eq(sellerProfiles.fssaiStatus, 'awaiting_admin_check'));
  const apps = await db.select().from(fssaiApplications).where(inArray(fssaiApplications.sellerId, [...provisional.map((p) => p.userId), ...filed.map((a) => a.sellerId)].concat([-1])));
  const candidates = await db.select().from(sellerProfiles).where(inArray(sellerProfiles.userId, [...new Set([...provisional.map((p) => p.userId), ...filed.map((a) => a.sellerId)])].concat([-1])));
  for (const p of candidates) {
    const app = apps.filter((a) => a.sellerId === p.userId).sort((a, b) => b.id - a.id)[0] ?? null;
    const info = fssaiTierInfo(p, app, { deemedDays: settings.fssaiDeemedGrantDaysRegistration, provisionalMaxDays: settings.provisionalMaxDays, now });
    if (info.tier === 'blocked' && info.provisionalEndsAt) {
      if (await once(p.userId, `prov-end-${p.userId}`, 'Provisional selling has ended', 'Your FSSAI is still not verified, so your kitchen is hidden. Upload your FSSAI certificate on the FSSAI page to go live again.', '/seller/compliance')) {
        out.provisionalEnded++;
        const { notifyAdmins } = await import('@/lib/orders/strikes');
        await notifyAdmins('Provisional period ended', `Kitchen #${p.userId} is hidden: FSSAI not verified.`, `/admin/kitchens/${p.userId}`);
      }
    }
  }

  out.purged = await purgeExpiredDocuments(now);
  log.info('fssai.jobs', out);
  return out;
}

/** Deletes identity documents past their retention date (storage object + metadata) and unlinks them from applications. */
export async function purgeExpiredDocuments(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const due = await db.select().from(files).where(and(isNotNull(files.deleteAfter), lt(files.deleteAfter, now)));
  if (!due.length) return 0;
  const storage = await getStorage();
  const keys = new Set<string>();
  for (const f of due) {
    await storage.delete(f.key).catch(() => {});
    keys.add(f.key);
  }
  await db.delete(files).where(inArray(files.key, [...keys]));
  const apps = await db.select().from(fssaiApplications);
  for (const a of apps) {
    const docs = a.documentsJson ?? [];
    const kept = docs.filter((d) => !keys.has(keyFromUrl(d.url) ?? ''));
    if (kept.length !== docs.length) {
      const timeline = [...(a.timelineJson ?? []), { at: now.toISOString(), event: 'ID/address documents deleted per the retention policy' }];
      await db.update(fssaiApplications).set({ documentsJson: kept, timelineJson: timeline }).where(eq(fssaiApplications.id, a.id));
    }
  }
  return keys.size;
}

/** After verification, ID/address documents are kept only `fssaiDocRetentionDays` more days. */
export async function scheduleDocumentDeletion(sellerId: number, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const deleteAfter = new Date(now.getTime() + settings.fssaiDocRetentionDays * DAY_MS);
  await db
    .update(files)
    .set({ deleteAfter })
    .where(and(eq(files.ownerId, sellerId), inArray(files.purpose, ['id_proof', 'address_proof'])));
}
