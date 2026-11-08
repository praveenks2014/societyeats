import { api, ApiError, ok } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { requireRecentMfa, requireSession } from '@/lib/auth';
import { readBackupState, readIndex, runBackup } from '@/lib/backup/run';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** The backup state and the list kept in Object Storage (newest first). */
export const GET = api(async () => {
  await requireSession(['admin']);
  return ok({ state: await readBackupState(), backups: (await readIndex()).sort((a, b) => b.at.localeCompare(a.at)) });
});

/** "Run backup now": needs a fresh 2FA check, is rate limited, and is written to the audit log. */
export const POST = api(async () => {
  const admin = await requireSession(['admin']);
  requireRecentMfa(admin);
  await rateLimit(`backup-now:${admin.uid}`, { limit: 6, windowMs: 60 * 60 * 1000 });
  const r = await runBackup({ trigger: 'manual' });
  await recordAudit({ actorId: admin.uid, action: 'backup.run', targetType: 'backup', targetId: r.ok ? r.entry.key : 'failed', meta: r.ok ? { method: r.entry.method, bytes: r.entry.bytes, pruned: r.pruned } : { error: r.error } });
  if (!r.ok) throw new ApiError(502, `The backup failed: ${r.error}`);
  return ok({ backup: r.entry, pruned: r.pruned });
});
