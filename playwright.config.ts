import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
// Outside the project: Next 16's Turbopack dev server watches the tree and full-reloads pages when files under it change (PGlite writes constantly).
const E2E_DIR = path.join(os.tmpdir(), 'padosiplate-e2e');
const chromium = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

/**
 * End-to-end tests run the real app (next dev) against a throw-away embedded
 * PGlite database with MOCK_MODE=true — no external services. The webServer
 * command wipes the DB, runs the production bootstrap (migrations, plans,
 * admin accounts) plus two test societies, then starts the server.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: chromium ? { executablePath: chromium, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] },
  },
  projects: [
    { name: 'desktop', testMatch: /flows\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-390', testMatch: /mobile\.spec\.ts/, use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `sh -c "rm -rf ${E2E_DIR} && mkdir -p ${E2E_DIR} && tsx scripts/e2e-bootstrap.ts && next dev -p ${PORT}"`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NODE_ENV: 'development',
      E2E: 'true',
      MOCK_MODE: 'true',
      JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123',
      PGLITE_DIR: path.join(E2E_DIR, 'pglite'),
      LOCAL_UPLOAD_DIR: path.join(E2E_DIR, 'uploads'),
      STORAGE_ADAPTER: 'local',
      SKIP_DEMO_SEED: 'true',
      ADMIN_EMAILS: 'e2e-admin@example.com',
      ADMIN_BOOTSTRAP_PASSWORD: 'E2e-first-pass-1',
      SITE_URL: `http://localhost:${PORT}`,
      CRON_SECRET: 'e2e-cron-secret',
      PLATFORM_FSSAI_FOR_E2E: '1',
    },
  },
});
