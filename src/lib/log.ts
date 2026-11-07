/**
 * Structured JSON logging with no PII. Anything that looks like a phone,
 * email, name, token or password key is redacted before it is written.
 */
const REDACT_KEYS = /phone|email|name|password|token|secret|otp|address|vpa|authorization|cookie|aadhaar|utr/i;

/** Free text can still carry a phone number or an email (an error message, a URL): mask those too. */
export function maskPii(text: string): string {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]').replace(/(?<![\w.])(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g, '[phone]');
}

function scrub(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value;
  if (value instanceof Error) return { message: maskPii(value.message), stack: maskPii(value.stack?.split('\n').slice(0, 4).join(' | ') ?? '') };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return maskPii(value.length > 300 ? value.slice(0, 300) + '…' : value);
  return value;
}

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(scrub(fields) as object) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
};
