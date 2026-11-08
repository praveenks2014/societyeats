import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { platformConfig } from '@/lib/db/schema';
import { getPlatformSettings, setPlatformSetting } from '@/lib/db/platform';
import { log } from '@/lib/log';
import { getStorage } from '@/lib/storage';
import { istDateString, istParts } from '@/lib/time';
import { exportLogical, migrationState } from './format';
import { BRAND } from '@/config/brand';

/**
 * Daily database backups to Object Storage (`backups/…`). Driven by the existing cron job: it is called every 5 minutes and does the work
 * once a day, after 03:00 IST, tracked in `backupState` so a second run (or a second instance) the same day does nothing.
 *   method `pg_dump`  when the binary exists and DATABASE_URL is set (a plain SQL dump, restore with psql)
 *   method `logical`  otherwise (gzipped JSON lines, restore with `npm run db:restore`)
 */
export type BackupMethod = 'pg_dump' | 'logical';
export type BackupEntry = { key: string; at: string; bytes: number; method: BackupMethod; weekly: boolean; rows: number | null; schemaVersion: number | null; migrationHash: string | null };
export type BackupState = { lastAttemptAt: string | null; lastSuccessAt: string | null; lastSuccessDate: string | null; ok: boolean; error: string | null; bytes: number | null; method: BackupMethod | null; key: string | null; trigger: 'cron' | 'manual' | null };

const STATE_KEY = 'backupState';
const CLAIM_KEY = 'backupClaim';
export const INDEX_KEY = 'backups/index.json';
export const BACKUP_DUE_HOUR_IST = 3;
export const BACKUP_STALE_HOURS = 26;
const RETRY_AFTER_FAILURE_MS = 30 * 60_000;
const CLAIM_MS = 15 * 60_000;

const EMPTY: BackupState = { lastAttemptAt: null, lastSuccessAt: null, lastSuccessDate: null, ok: true, error: null, bytes: null, method: null, key: null, trigger: null };

export async function readBackupState(): Promise<BackupState> {
  const db = await getDb();
  const [row] = await db.select().from(platformConfig).where(eq(platformConfig.key, STATE_KEY));
  try {
    return row ? { ...EMPTY, ...(JSON.parse(row.value) as Partial<BackupState>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

async function writeState(patch: Partial<BackupState>) {
  await setPlatformSetting(STATE_KEY, JSON.stringify({ ...(await readBackupState()), ...patch }));
}

export async function readIndex(): Promise<BackupEntry[]> {
  const raw = await (await getStorage()).get(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw.toString('utf8')) as BackupEntry[];
  } catch {
    return [];
  }
}

async function writeIndex(entries: BackupEntry[]) {
  await (await getStorage()).put(INDEX_KEY, Buffer.from(JSON.stringify(entries, null, 1)), 'application/json');
}

/** Which entries survive: the newest `daily`, plus the newest `weekly` among those flagged weekly. */
export function retain(entries: BackupEntry[], daily: number, weekly: number): { keep: BackupEntry[]; drop: BackupEntry[] } {
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at));
  const keepKeys = new Set(sorted.slice(0, daily).map((e) => e.key));
  for (const e of sorted.filter((x) => x.weekly).slice(0, weekly)) keepKeys.add(e.key);
  return { keep: sorted.filter((e) => keepKeys.has(e.key)), drop: sorted.filter((e) => !keepKeys.has(e.key)) };
}

function pgDump(): Buffer | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (spawnSync('pg_dump', ['--version'], { stdio: 'ignore' }).status !== 0) return null;
  const r = spawnSync('pg_dump', ['--no-owner', '--no-privileges', url], { maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) {
    log.warn('backup.pg_dump_failed', { status: r.status });
    return null; // fall back to the logical export
  }
  return zlib.gzipSync(r.stdout);
}

export type RunOptions = { now?: Date; trigger?: 'cron' | 'manual'; method?: BackupMethod };

/** Takes one backup now (no schedule check): export, upload, update the index, prune, record the state. Never throws; returns the outcome. */
export async function runBackup(opts: RunOptions = {}): Promise<{ ok: true; entry: BackupEntry; pruned: number } | { ok: false; error: string }> {
  const now = opts.now ?? new Date();
  const trigger = opts.trigger ?? 'cron';
  await writeState({ lastAttemptAt: now.toISOString(), trigger });
  try {
    const db = await getDb();
    let method: BackupMethod = 'logical';
    let gz: Buffer | null = null;
    let rows: number | null = null;
    if (opts.method !== 'logical') {
      gz = pgDump();
      if (gz) method = 'pg_dump';
    }
    const state = await migrationState(db);
    if (!gz) {
      const out = await exportLogical(db, now);
      gz = out.gz;
      rows = out.rows;
    }
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const key = `backups/${BRAND.slug}-${stamp}.${method === 'pg_dump' ? 'sql.gz' : 'jsonl.gz'}`;
    const storage = await getStorage();
    await storage.put(key, gz, 'application/gzip');

    const settings = await getPlatformSettings();
    const index = await readIndex();
    const hasRecentWeekly = index.some((e) => e.weekly && now.getTime() - new Date(e.at).getTime() < 7 * 86_400_000);
    const entry: BackupEntry = { key, at: now.toISOString(), bytes: gz.length, method, weekly: istParts(now).weekday === 0 || !hasRecentWeekly, rows, schemaVersion: state.schemaVersion, migrationHash: state.migrationHash };
    const { keep, drop } = retain([...index, entry], settings.backupKeepDaily, settings.backupKeepWeekly);
    for (const d of drop) await storage.delete(d.key).catch(() => {});
    await writeIndex(keep);
    await writeState({ lastSuccessAt: now.toISOString(), lastSuccessDate: istDateString(now), ok: true, error: null, bytes: gz.length, method, key });
    log.info('backup.done', { method, bytes: gz.length, pruned: drop.length, trigger });
    return { ok: true, entry, pruned: drop.length };
  } catch (e) {
    const error = String((e as Error).message ?? e).slice(0, 200);
    await writeState({ ok: false, error }).catch(() => {});
    log.error('backup.failed', { err: e });
    return { ok: false, error };
  }
}

/** One instance at a time: a conditional upsert on a claim row (an expired claim can be taken over). */
async function claim(now: Date): Promise<boolean> {
  const db = await getDb();
  const until = new Date(now.getTime() + CLAIM_MS).toISOString();
  const { sql } = await import('drizzle-orm');
  const res = await db.execute(sql`insert into platform_config (key, value) values (${CLAIM_KEY}, ${until})
    on conflict (key) do update set value = excluded.value where platform_config.value < ${now.toISOString()} returning key`);
  const { rowsOf } = await import('@/lib/db');
  return rowsOf(res).length > 0;
}

export function backupIsDue(state: BackupState, now: Date): boolean {
  if (istParts(now).hour < BACKUP_DUE_HOUR_IST) return false;
  if (state.lastSuccessDate === istDateString(now)) return false;
  if (!state.ok && state.lastAttemptAt && now.getTime() - new Date(state.lastAttemptAt).getTime() < RETRY_AFTER_FAILURE_MS) return false;
  return true;
}

/** Called by every cron run: does nothing unless today's backup (after 03:00 IST) has not been taken yet. */
export async function runBackupIfDue(now: Date = new Date()): Promise<'ran' | 'not_due' | 'busy' | 'failed'> {
  if (!backupIsDue(await readBackupState(), now)) return 'not_due';
  if (!(await claim(now))) return 'busy';
  const r = await runBackup({ now, trigger: 'cron' });
  return r.ok ? 'ran' : 'failed';
}

/** Is there a backup problem worth alerting on: the last attempt failed, or the last good one is older than 26 hours. */
export function backupProblem(state: BackupState, now: Date): boolean {
  if (!state.ok && state.lastAttemptAt) return true;
  if (state.lastSuccessAt && now.getTime() - new Date(state.lastSuccessAt).getTime() > BACKUP_STALE_HOURS * 3_600_000) return true;
  return false;
}
