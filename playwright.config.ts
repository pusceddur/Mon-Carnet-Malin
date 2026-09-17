import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT, E2E_SETUP_TOKEN } from './e2e/support/env';

// End-to-end tests run against the production build (`npm run build` first) served by the bundled server.
const port = E2E_PORT;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL,
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The service worker would cache the app between tests; the offline mode is covered by unit tests.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'ipad-chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1024, height: 1366 },
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'node e2e/support/server.mjs',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      PORT: String(port),
      E2E_PORT: String(port),
      AI_PROVIDER: 'mock',
      SETUP_TOKEN: E2E_SETUP_TOKEN,
      WIKTIONARY_ENABLED: 'false',
    },
  },
});
