/**
 * "Latest started wins". A poll that started before an action (rate, cancel, claim paid, confirm) can finish AFTER the action's own reload
 * and would overwrite fresh data with stale data. This loader numbers every run; a result is applied only if no newer run has started,
 * and starting a run (or an action) aborts whatever is still in flight, so an old response can never land on top of a new one.
 */
export type LatestLoader = {
  /** Start a load. Aborts any run still in flight; only the most recently started run may apply its result. */
  run(): Promise<void>;
  /** Abort what is in flight and drop its result (call when an action starts; reload when it finishes). */
  abort(): void;
  /** Stop for good (unmount). */
  dispose(): void;
};

export function createLatestLoader<T>(
  fetcher: (signal: AbortSignal) => Promise<T | null | undefined>,
  apply: (value: T) => void,
): LatestLoader {
  let seq = 0;
  let controller: AbortController | null = null;
  let disposed = false;
  return {
    async run() {
      if (disposed) return;
      const mine = ++seq;
      controller?.abort();
      const c = new AbortController();
      controller = c;
      try {
        const value = await fetcher(c.signal);
        if (disposed || mine !== seq || c.signal.aborted) return; // a newer run started: this result is stale
        if (value != null) apply(value);
      } catch {
        /* aborted or a transient network error: keep the last data */
      } finally {
        if (controller === c) controller = null;
      }
    },
    abort() {
      seq++; // invalidates every run started so far
      controller?.abort();
      controller = null;
    },
    dispose() {
      disposed = true;
      seq++;
      controller?.abort();
      controller = null;
    },
  };
}
