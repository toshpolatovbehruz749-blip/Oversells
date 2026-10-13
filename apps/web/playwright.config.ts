import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Browser end-to-end tests. They need a running Oversells instance (API +
 * built web client + Docker compiler), e.g. `docker compose up` or the local
 * dev setup described in README.md. Override the URL with E2E_BASE_URL.
 */
const preinstalledChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 90_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // For a local HTTPS setup with a self-signed / internal CA certificate (Caddy on localhost).
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === '1',
    viewport: { width: 1500, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: existsSync(preinstalledChromium) ? { executablePath: preinstalledChromium } : {},
  },
});
