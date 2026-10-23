import { describe, expect, test } from 'vitest';
import { addMonthsIST, istDateString, istHour, istParts, istStartOfDay } from '@/lib/time';
import { currentSlot } from '@/lib/slots';

describe('IST maths (server runs with TZ=UTC)', () => {
  test('process TZ is UTC but IST helpers are exact', () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0);
    expect(istHour(new Date('2026-03-01T05:30:00Z'))).toBe(11);
    expect(istParts(new Date('2026-03-01T18:30:00Z'))).toMatchObject({ day: 2, hour: 0, minute: 0 });
  });

  test('currentSlot uses the IST hour, not the server hour', () => {
    expect(currentSlot(new Date('2026-03-01T00:29:00Z'))).toBeNull(); // 05:59 IST
    expect(currentSlot(new Date('2026-03-01T00:30:00Z'))).toBe('breakfast'); // 06:00 IST
    expect(currentSlot(new Date('2026-03-01T05:29:00Z'))).toBe('breakfast'); // 10:59 IST
    expect(currentSlot(new Date('2026-03-01T05:30:00Z'))).toBe('lunch'); // 11:00 IST
    expect(currentSlot(new Date('2026-03-01T12:30:00Z'))).toBe('dinner'); // 18:00 IST
    expect(currentSlot(new Date('2026-03-01T17:30:00Z'))).toBeNull(); // 23:00 IST
  });

  test('istStartOfDay and date string follow the IST calendar day', () => {
    const d = new Date('2026-03-01T20:00:00Z'); // 01:30 IST on 2 March
    expect(istDateString(d)).toBe('2026-03-02');
    expect(istStartOfDay(d).toISOString()).toBe('2026-03-01T18:30:00.000Z');
  });

  test('addMonthsIST clamps month ends and keeps time of day', () => {
    const jan31 = new Date('2026-01-31T06:00:00Z');
    expect(addMonthsIST(jan31, 1).toISOString()).toBe('2026-02-28T06:00:00.000Z');
    expect(addMonthsIST(new Date('2026-10-17T10:00:00Z'), 3).toISOString()).toBe('2027-01-17T10:00:00.000Z');
    expect(addMonthsIST(new Date('2026-11-30T10:00:00Z'), 12).toISOString()).toBe('2027-11-30T10:00:00.000Z');
  });
});
