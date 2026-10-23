/**
 * All slot, cut-off, window and subscription-date maths is done in
 * Asia/Kolkata (IST, UTC+05:30, no DST) regardless of the server's TZ.
 * Implemented with a fixed offset so it is exact, dependency-free and
 * behaves identically under TZ=UTC (Replit) and TZ=Asia/Kolkata (dev).
 */
export const IST_OFFSET_MS = 330 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type IstParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
};

export function istParts(d: Date = new Date()): IstParts {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
    weekday: s.getUTCDay(),
  };
}

/** Hour of day (0-23) in IST. */
export function istHour(d: Date = new Date()): number {
  return istParts(d).hour;
}

/** The instant of IST midnight at the start of `d`'s IST calendar day. */
export function istStartOfDay(d: Date = new Date()): Date {
  const p = istParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - IST_OFFSET_MS);
}

/** The instant of `hour`:00 IST on `d`'s IST calendar day. */
export function istAtHour(d: Date, hour: number): Date {
  return new Date(istStartOfDay(d).getTime() + hour * 60 * 60 * 1000);
}

/** "YYYY-MM-DD" in IST. */
export function istDateString(d: Date = new Date()): string {
  const p = istParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Add calendar months in IST, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsIST(d: Date, months: number): Date {
  const p = istParts(d);
  const total = p.year * 12 + (p.month - 1) + months;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(p.day, lastDay);
  const msIntoDay = d.getTime() + IST_OFFSET_MS - Date.UTC(p.year, p.month - 1, p.day);
  return new Date(Date.UTC(y, m, day) + msIntoDay - IST_OFFSET_MS);
}

/** Whole days from `a` to `b` (floor), may be negative. */
export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function formatIST(d: Date, withTime = false): string {
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  });
}
