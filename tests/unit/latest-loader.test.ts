import { describe, expect, test } from 'vitest';
import { createLatestLoader } from '@/lib/latest-loader';

/** A fetch we resolve by hand, so the order of responses is under the test's control. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe('T1: latest started wins', () => {
  test('a slow poll that started before an action cannot overwrite what the action reload fetched', async () => {
    const calls = [deferred<string>(), deferred<string>()];
    let n = 0;
    const seen: string[] = [];
    const loader = createLatestLoader<string>(() => calls[n++].promise, (v) => seen.push(v));

    const poll = loader.run(); // poll starts: it will eventually return the OLD order (rating form still open)
    const afterAction = loader.run(); // the user rated: the action's own reload starts later
    calls[1].resolve('rated'); // the newer request answers first
    await afterAction;
    calls[0].resolve('old: not rated'); // the stale poll answers last
    await poll;

    expect(seen).toEqual(['rated']); // the stale answer was never applied
  });

  test('the same two requests resolving in start order apply in order, newest last', async () => {
    const calls = [deferred<string>(), deferred<string>()];
    let n = 0;
    const seen: string[] = [];
    const loader = createLatestLoader<string>(() => calls[n++].promise, (v) => seen.push(v));
    const a = loader.run();
    calls[0].resolve('first');
    await a;
    const b = loader.run();
    calls[1].resolve('second');
    await b;
    expect(seen).toEqual(['first', 'second']);
  });

  test('starting a run aborts the one still in flight', async () => {
    const signals: AbortSignal[] = [];
    const calls = [deferred<string>(), deferred<string>()];
    let n = 0;
    const loader = createLatestLoader<string>((s) => (signals.push(s), calls[n++].promise), () => {});
    void loader.run();
    void loader.run();
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  test('abort() (an action starts) drops the in-flight poll even if it resolves afterwards; the reload after the action applies', async () => {
    const calls = [deferred<string>(), deferred<string>()];
    let n = 0;
    const seen: string[] = [];
    const loader = createLatestLoader<string>(() => calls[n++].promise, (v) => seen.push(v));
    const poll = loader.run();
    loader.abort(); // the user clicks "Claim paid"
    calls[0].resolve('stale'); // the poll answers while the action is running
    await poll;
    expect(seen).toEqual([]);
    const reload = loader.run(); // the action finished
    calls[1].resolve('fresh');
    await reload;
    expect(seen).toEqual(['fresh']);
  });

  test('a transient error or an empty answer keeps the previous data; dispose() stops everything', async () => {
    const seen: string[] = [];
    let mode: 'ok' | 'throw' | 'null' = 'ok';
    const loader = createLatestLoader<string>(async () => {
      if (mode === 'throw') throw new Error('network');
      return mode === 'null' ? null : 'data';
    }, (v) => seen.push(v));
    await loader.run();
    mode = 'throw';
    await loader.run();
    mode = 'null';
    await loader.run();
    expect(seen).toEqual(['data']);
    loader.dispose();
    mode = 'ok';
    await loader.run();
    expect(seen).toEqual(['data']);
  });

  test('every polling page uses the hook instead of its own setInterval fetch', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.join(__dirname, '../../src');
    for (const f of ['app/orders/[id]/order-detail.tsx', 'app/seller/orders/page.tsx', 'app/admin/orders/page.tsx', 'app/admin/disputes/page.tsx', 'app/restaurant/page.tsx', 'components/chat-badge.tsx', 'components/header.tsx']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect(src, f).toContain('usePolledResource');
      expect(src, f).not.toMatch(/setInterval\(\s*load/);
    }
  });
});
