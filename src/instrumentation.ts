/**
 * Next.js instrumentation hook (requires experimental.instrumentationHook
 * in next.config.mjs). register() runs exactly once when the server
 * process boots — before any request is handled — for both `next dev` and
 * `next start`. It's the one place we can fail the whole process fast on
 * bad config rather than have the first request that touches a missing
 * secret blow up.
 */
export async function register() {
  const { validateEnv } = await import('@/lib/env');
  try {
    validateEnv();
  } catch {
    // validateEnv() already printed the formatted report. Next.js's own
    // handling of a thrown instrumentation error doesn't crash the process —
    // it leaves the server bound to its port, failing every request with a
    // 500 forever. That's not "refuses to start", so exit hard here instead:
    // a crashed process is an unambiguous, impossible-to-miss signal in
    // Replit's (or any host's) deploy logs and health checks.
    process.exit(1);
  }
}
