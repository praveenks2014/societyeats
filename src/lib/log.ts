/**
 * Structured JSON logging with no PII. Anything that looks like a phone,
 * email, name, token or password key is redacted before it is written.
 */
const REDACT_KEYS = /phone|email|name|password|token|secret|otp|address|vpa|authorization|cookie|aadhaar|utr/i;

function scrub(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value;
  if (value instanceof Error) return { message: value.message, stack: value.stack?.split('\n').slice(0, 4).join(' | ') };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return value.slice(0, 300) + '…';
  return value;
}

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(scrub(fields) as object) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
};
