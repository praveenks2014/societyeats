import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    env: { TZ: 'UTC', JWT_SECRET: 'test-secret-test-secret-test-secret', MOCK_MODE: 'true' },
  },
});
