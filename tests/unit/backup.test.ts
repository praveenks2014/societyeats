import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import { MemoryStorage } from '@/lib/storage/memory';
import { setStorageForTests } from '@/lib/storage';
import type { Db } from '@/lib/db';
import { BRAND } from '@/config/brand';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Db;
let societyId: number;
beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  delete process.env.DATABASE_URL; // no pg_dump path: the logical export is what runs
  db = await useTestDb();
  setStorageForTests(new MemoryStorage());
  societyId = (await makeSociety(db)).id;
});

async function emptyDb(): Promise<Db> {
  const client = new PGlite();
  const d = drizzle(client, { schema: s });
  await migrate(d, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  return d as unknown as Db;
}

describe('T2: backups', () => {
  test('a backup restores into a fresh database with the same row counts and records', async () => {
    const k = await makeLiveKitchen(db, { societyId });
    const buyer = await makeUser(db, 'buyer', { societyId });
    const { encryptPan } = await import('@/lib/pan');
    await db.update(s.sellerProfiles).set({ offersSelfPickup: true, panEnc: encryptPan('ABCDE1234F') }).where(eq(s.sellerProfiles.userId, k.seller.id));
    const { createHomeOrder } = await import('@/lib/orders/create');
    const o = await createHomeOrder({ buyerId: buyer.id, sellerId: k.seller.id, items: [{ id: k.dish.id, qty: 2 }], fulfillmentType: 'self_pickup' });

    const { runBackup, readIndex, readBackupState } = await import('@/lib/backup/run');
    const r = await runBackup({ method: 'logical', now: new Date('2026-11-10T22:00:00Z') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry).toMatchObject({ method: 'logical', rows: expect.any(Number) });
    expect(r.entry.key).toMatch(/^backups\/kootu-.*\.jsonl\.gz$/);
    expect((await readIndex()).map((e) => e.key)).toContain(r.entry.key);
    expect(await readBackupState()).toMatchObject({ ok: true, key: r.entry.key, method: 'logical', lastSuccessDate: '2026-11-11' });

    const { getStorage } = await import('@/lib/storage');
    const gz = (await (await getStorage()).get(r.entry.key))!;
    // encrypted columns are copied as stored: the file holds the ciphertext and never the plain PAN
    const text = (await import('node:zlib')).gunzipSync(gz).toString('utf8');
    expect(text).not.toContain('ABCDE1234F');
    expect(text).toContain((await db.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, k.seller.id)))[0].panEnc!);
    const { restoreLogical, tableRowCounts } = await import('@/lib/backup/restore');
    const target = await emptyDb();
    const report = await restoreLogical(target, gz);
    const sourceCounts = await tableRowCounts(db);
    const targetCounts = await tableRowCounts(target);
    expect(targetCounts).toEqual(sourceCounts);
    expect(report.counts.every((c) => c.expected === c.restored)).toBe(true);
    expect(report.counts.reduce((a, c) => a + c.restored, 0)).toBe(r.entry.rows);

    // a sample of records is identical, including what is stored encrypted (ciphertext copied as is)
    const [a] = await db.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    const [b] = await target.select().from(s.orders).where(eq(s.orders.id, o.orderId));
    expect(b).toEqual(a);
    const [ua] = await db.select().from(s.users).where(eq(s.users.id, buyer.id));
    const [ub] = await target.select().from(s.users).where(eq(s.users.id, buyer.id));
    expect(ub).toEqual(ua);
    const [pa] = await db.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, k.seller.id));
    const [pb] = await target.select().from(s.sellerProfiles).where(eq(s.sellerProfiles.userId, k.seller.id));
    expect(pb).toEqual(pa);

    // serial ids continue after the restored rows
    const [next] = await target.insert(s.societies).values({ name: 'After restore', city: 'X', lat: 1, lng: 1, addressText: 'x', inviteCode: 'AFTER-RESTORE' }).returning();
    expect(next.id).toBeGreaterThan(Math.max(...(await target.select().from(s.societies)).filter((x) => x.id !== next.id).map((x) => x.id)));
  });

  test('restore refuses a non-empty database and a schema mismatch, and names what is in the way', async () => {
    const { runBackup } = await import('@/lib/backup/run');
    const { getStorage } = await import('@/lib/storage');
    const { restoreLogical } = await import('@/lib/backup/restore');
    const r = await runBackup({ method: 'logical', now: new Date('2026-11-11T22:00:00Z') });
    if (!r.ok) throw new Error(r.error);
    const gz = (await (await getStorage()).get(r.entry.key))!;
    // the source database itself is full
    await expect(restoreLogical(db, gz)).rejects.toThrow(/not empty/);
    // an empty database with one stray row is refused too, and nothing was written
    const target = await emptyDb();
    await target.insert(s.platformConfig).values({ key: 'stray', value: '1' });
    await expect(restoreLogical(target, gz)).rejects.toThrow(/not empty \(platform_config=1/);
    // a different schema level is refused
    const { parseLogical } = await import('@/lib/backup/format');
    const zlib = await import('node:zlib');
    const lines = zlib.gunzipSync(gz).toString('utf8').split('\n');
    const m = JSON.parse(lines[0]);
    m.manifest.migrationHash = 'deadbeef';
    const forged = zlib.gzipSync([JSON.stringify(m), ...lines.slice(1)].join('\n'));
    expect(parseLogical(forged).manifest.migrationHash).toBe('deadbeef');
    await expect(restoreLogical(await emptyDb(), forged)).rejects.toThrow(/Schema mismatch/);
  });

  test('retention keeps the newest daily and weekly backups and prunes the rest from storage', async () => {
    const { retain, runBackup, readIndex } = await import('@/lib/backup/run');
    const { getStorage } = await import('@/lib/storage');
    const mk = (i: number, weekly: boolean) => ({ key: `backups/x-${i}`, at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), bytes: 1, method: 'logical' as const, weekly, rows: 1, schemaVersion: 1, migrationHash: 'h' });
    const entries = Array.from({ length: 30 }, (_, i) => mk(i, i % 7 === 0)); // day 0, 7, 14, 21, 28 are weekly
    const { keep, drop } = retain(entries, 14, 8);
    expect(keep.length).toBe(14 + 3); // the newest 14 days, plus the weekly ones older than those (days 14, 7, 0)
    expect(drop.length).toBe(30 - keep.length);
    expect(keep.some((e) => e.key === 'backups/x-0')).toBe(true); // a weekly from long ago survives
    expect(keep.some((e) => e.key === 'backups/x-3')).toBe(false); // an old non-weekly does not

    // the same rule applied through real runs: 2 daily kept, no weekly extras
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('backupKeepDaily', '2');
    await setPlatformSetting('backupKeepWeekly', '0');
    const storage = await getStorage();
    const keys: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await runBackup({ method: 'logical', now: new Date(Date.UTC(2027, 0, 10 + i, 22)) });
      if (!r.ok) throw new Error(r.error);
      keys.push(r.entry.key);
    }
    const idx = (await readIndex()).map((e) => e.key);
    expect(idx).toEqual([keys[3], keys[2]]);
    expect(await storage.get(keys[0])).toBeNull();
    expect(await storage.get(keys[2])).not.toBeNull();
    await setPlatformSetting('backupKeepDaily', '14');
    await setPlatformSetting('backupKeepWeekly', '8');
  });

  test('the cron runs it once a day after 03:00 IST, even if it fires every five minutes', async () => {
    const { runBackupIfDue, readBackupState, backupIsDue } = await import('@/lib/backup/run');
    const { setPlatformSetting } = await import('@/lib/db/platform');
    await setPlatformSetting('backupState', JSON.stringify({}));
    await setPlatformSetting('backupClaim', '');
    const at = (iso: string) => new Date(iso);
    expect(await runBackupIfDue(at('2027-02-01T20:30:00Z'))).toBe('not_due'); // 02:00 IST: too early
    expect(await runBackupIfDue(at('2027-02-01T21:35:00Z'))).toBe('ran'); // 03:05 IST
    expect(await runBackupIfDue(at('2027-02-01T21:40:00Z'))).toBe('not_due'); // five minutes later: already done today
    expect(await runBackupIfDue(at('2027-02-02T08:00:00Z'))).toBe('not_due'); // later the same IST day? 13:30 IST on the 2nd is a new day…
    const st = await readBackupState();
    expect(st.lastSuccessDate).toBe('2027-02-02');
    expect(backupIsDue(st, at('2027-02-02T09:00:00Z'))).toBe(false);
  });

  test('a failed backup is recorded, retried only after 30 minutes, and counts as a problem to alert on', async () => {
    const { runBackup, readBackupState, backupIsDue, backupProblem } = await import('@/lib/backup/run');
    const storage = new MemoryStorage();
    vi.spyOn(storage, 'put').mockRejectedValue(new Error('bucket unavailable'));
    setStorageForTests(storage);
    const now = new Date('2027-03-01T22:00:00Z');
    const r = await runBackup({ method: 'logical', now });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('bucket unavailable') });
    const st = await readBackupState();
    expect(st.ok).toBe(false);
    expect(backupProblem(st, now)).toBe(true);
    expect(backupIsDue(st, new Date(now.getTime() + 10 * 60_000))).toBe(false);
    expect(backupIsDue(st, new Date(now.getTime() + 31 * 60_000))).toBe(true);
    setStorageForTests(new MemoryStorage());
  });
});

describe('storage keys for backups', () => {
  test('the local adapter stores nested keys such as backups/…, and still refuses anything that could escape its folder', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-local-'));
    process.env.LOCAL_UPLOAD_DIR = dir;
    const { LocalStorage } = await import('@/lib/storage/local');
    const st = new LocalStorage();
    await st.put(`backups/${BRAND.slug}-2026-11-08T03-00-00-000Z.jsonl.gz`, Buffer.from('x'));
    expect((await st.get(`backups/${BRAND.slug}-2026-11-08T03-00-00-000Z.jsonl.gz`))?.toString()).toBe('x');
    await st.put('abcdef0123456789abcdef01.png', Buffer.from('y')); // flat upload keys still work
    expect((await st.get('abcdef0123456789abcdef01.png'))?.toString()).toBe('y');
    await st.delete(`backups/${BRAND.slug}-2026-11-08T03-00-00-000Z.jsonl.gz`);
    expect(await st.get(`backups/${BRAND.slug}-2026-11-08T03-00-00-000Z.jsonl.gz`)).toBeNull();
    for (const bad of ['../x', 'backups/../../x', '/etc/passwd', 'a//b', 'backups/.', 'a b']) await expect(st.put(bad, Buffer.from('z'))).rejects.toThrow(/bad storage key/);
    delete process.env.LOCAL_UPLOAD_DIR;
  });
});
