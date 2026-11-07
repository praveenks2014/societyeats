/**
 * Next.js instrumentation hook (on by default since Next 15). register() runs
 * exactly once when the server process boots — before any request is handled —
 * for both `next dev` and `next start`. It's the one place we can fail the
 * whole process fast on bad config rather than have the first request that
 * touches a missing secret blow up.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateOnBoot } = await import('./instrumentation-node');
    await validateOnBoot();
  }
}
