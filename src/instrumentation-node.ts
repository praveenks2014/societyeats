/** Node-only startup validation, imported from instrumentation.ts (kept separate so the Edge bundle never sees process.exit). */
export async function validateOnBoot() {
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
