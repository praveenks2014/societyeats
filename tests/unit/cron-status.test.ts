import { beforeAll, describe, expect, test } from 'vitest';
import { useTestDb } from '../helpers/db';

beforeAll(async () => {
  process.env.MOCK_MODE = 'true';
  await useTestDb();
});

describe('cron heartbeat', () => {
  test('stale until a scheduled run is recorded; stale again after 3 hours', async () => {
    const { getCronStatus, recordCronRun } = await import('@/lib/cron-status');
    expect((await getCronStatus()).stale).toBe(true);
    const { runScheduledJobs } = await import('@/lib/jobs');
    await runScheduledJobs();
    const fresh = await getCronStatus();
    expect(fresh.stale).toBe(false);
    expect(fresh.lastRunAt).toBeInstanceOf(Date);
    expect((await getCronStatus(new Date(Date.now() + 2 * 3600_000))).stale).toBe(false);
    expect((await getCronStatus(new Date(Date.now() + 3 * 3600_000 + 60_000))).stale).toBe(true);
    await recordCronRun(new Date(Date.now() - 4 * 3600_000));
    expect((await getCronStatus()).stale).toBe(true);
  });
});
