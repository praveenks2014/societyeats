import { test as base, expect } from '@playwright/test';
import { guardContext, guardLog } from './helpers';

/**
 * `test` with a guard: any CSP violation, uncaught page error or console error in any browser context fails the test.
 * (Scenario 24: zero CSP violations and zero console errors across the whole journey.)
 */
export const test = base.extend<{ _guard: void }>({
  context: async ({ context }, run) => {
    guardContext(context);
    await run(context);
  },
  _guard: [
    async ({}, run) => {
      guardLog.length = 0;
      await run();
      expect(guardLog, 'CSP violations / console errors').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
