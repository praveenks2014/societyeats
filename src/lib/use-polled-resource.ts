'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createLatestLoader, type LatestLoader } from '@/lib/latest-loader';

/**
 * Loads a resource now and then every `intervalMs` while `enabled`. Only the most recently STARTED request may set the data
 * (see `createLatestLoader`), so a slow poll can never overwrite what an action's own reload just fetched.
 *   reload()        start a fresh load (aborts older ones); call it after an action completes
 *   abortInFlight() call when an action starts, so an old poll cannot land during or after it
 * `fetcher` may return null/undefined to mean "nothing new" (a transient error): the previous data stays.
 */
export function usePolledResource<T>(fetcher: (signal: AbortSignal) => Promise<T | null | undefined>, opts: { intervalMs: number; enabled?: boolean; /** checked on every tick with the latest data; return false to stop polling (e.g. the order is finished) */ pollWhile?: (data: T | null) => boolean; /** a new key (e.g. another order id) starts over with a fresh loader */ resetKey?: unknown }) {
  const [data, setData] = useState<T | null>(null);
  const fetcherRef = useRef(fetcher);
  const dataRef = useRef<T | null>(null);
  const pollWhileRef = useRef(opts.pollWhile);
  const loaderRef = useRef<LatestLoader | null>(null);

  useEffect(() => {
    fetcherRef.current = fetcher;
    pollWhileRef.current = opts.pollWhile;
    dataRef.current = data;
  });
  useEffect(() => {
    const loader = createLatestLoader<T>((s) => fetcherRef.current(s), setData);
    loaderRef.current = loader;
    void loader.run();
    return () => {
      loader.dispose();
      loaderRef.current = null;
    };
  }, [opts.resetKey]);

  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (pollWhileRef.current && !pollWhileRef.current(dataRef.current)) return;
      void loaderRef.current?.run();
    }, opts.intervalMs);
    return () => clearInterval(t);
  }, [enabled, opts.intervalMs]);

  const reload = useCallback(() => loaderRef.current?.run() ?? Promise.resolve(), []);
  const abortInFlight = useCallback(() => loaderRef.current?.abort(), []);
  return { data, setData, reload, abortInFlight };
}
