import { describe, expect, test } from 'vitest';
import { daysLeft, effectiveStatus, isSubscribed, nextPeriod, overallStatus } from '@/lib/subscriptions/status';
import { DAY_MS } from '@/lib/time';

const T0 = new Date('2026-01-10T06:00:00Z');
const sub = (status: string, start: Date, end: Date) => ({ status, startsAt: start, endsAt: end });

describe('period stacking', () => {
  test('first purchase starts now', () => {
    const p = nextPeriod([], 3, T0);
    expect(p.startsAt.toISOString()).toBe(T0.toISOString());
    expect(p.endsAt.toISOString()).toBe('2026-04-10T06:00:00.000Z');
  });
  test('early renewal starts at the current end, not now', () => {
    const current = sub('active', T0, new Date('2026-04-10T06:00:00Z'));
    const p = nextPeriod([current], 3, new Date('2026-02-01T00:00:00Z'));
    expect(p.startsAt.toISOString()).toBe('2026-04-10T06:00:00.000Z');
    expect(p.endsAt.toISOString()).toBe('2026-07-10T06:00:00.000Z');
  });
  test('renewing after the end starts now; cancelled/pending rows are ignored', () => {
    const old = sub('active', T0, new Date('2026-02-10T06:00:00Z'));
    const p = nextPeriod([old, sub('cancelled', T0, new Date('2027-01-01T00:00:00Z')), { status: 'pending_payment', startsAt: null, endsAt: null }], 1, new Date('2026-03-01T00:00:00Z'));
    expect(p.startsAt.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
  test('stacks again on top of a stacked period', () => {
    const a = sub('active', T0, new Date('2026-04-10T06:00:00Z'));
    const b = sub('active', new Date('2026-04-10T06:00:00Z'), new Date('2026-07-10T06:00:00Z'));
    expect(nextPeriod([a, b], 1, new Date('2026-02-01T00:00:00Z')).startsAt.toISOString()).toBe('2026-07-10T06:00:00.000Z');
  });
});

describe('active → grace → expired', () => {
  const s = sub('active', T0, new Date('2026-04-10T06:00:00Z'));
  const grace = 3;
  test('transitions at the right instants', () => {
    expect(effectiveStatus(s, new Date('2026-04-10T05:59:59Z'), grace)).toBe('active');
    expect(effectiveStatus(s, new Date('2026-04-10T06:00:00Z'), grace)).toBe('grace');
    expect(effectiveStatus(s, new Date(s.endsAt.getTime() + 3 * DAY_MS - 1), grace)).toBe('grace');
    expect(effectiveStatus(s, new Date(s.endsAt.getTime() + 3 * DAY_MS), grace)).toBe('expired');
  });
  test('listing visibility: subscribed while active, waived or in grace only', () => {
    expect(isSubscribed([s], new Date('2026-03-01T00:00:00Z'), grace)).toBe(true);
    expect(isSubscribed([s], new Date('2026-04-11T00:00:00Z'), grace)).toBe(true); // grace
    expect(isSubscribed([s], new Date('2026-04-14T00:00:00Z'), grace)).toBe(false); // expired
    expect(isSubscribed([sub('waived', T0, new Date('2026-04-10T06:00:00Z'))], new Date('2026-03-01T00:00:00Z'), grace)).toBe(true);
    expect(isSubscribed([{ status: 'pending_payment', startsAt: null, endsAt: null }], T0, grace)).toBe(false);
    expect(isSubscribed([sub('cancelled', T0, new Date('2027-01-01T00:00:00Z'))], T0, grace)).toBe(false);
  });
  test('renewal restores: a new stacked period after expiry makes the kitchen subscribed again', () => {
    const now = new Date('2026-05-01T00:00:00Z');
    expect(isSubscribed([s], now, grace)).toBe(false);
    const p = nextPeriod([s], 1, now);
    expect(isSubscribed([s, sub('active', p.startsAt, p.endsAt)], now, grace)).toBe(true);
  });
  test('overall status and days left', () => {
    expect(overallStatus([s], new Date('2026-04-11T00:00:00Z'), grace)).toBe('grace');
    expect(overallStatus([], T0, grace)).toBe('none');
    expect(daysLeft([s], new Date('2026-04-01T06:00:00Z'))).toBe(9);
  });
  test('a stacked future period is not yet running', () => {
    const future = sub('active', new Date('2026-04-10T06:00:00Z'), new Date('2026-07-10T06:00:00Z'));
    expect(effectiveStatus(future, new Date('2026-03-01T00:00:00Z'), grace)).toBe('pending_payment');
  });
});
