import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Browser end-to-end tests. They need a running Oversells instance (API +
 * built web client + Docker compiler), e.g. `docker compose up` or the local
 * dev setup described in README.md. Override the URL with E2E_BASE_URL.
 */
// A Chromium installed next to Playwright (cloud machines); the first one that exists is used.
const preinstalledChromium = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p)) ?? '';
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
// The tests read the interface in Oʻzbekcha (official Latin); «Özbekça» (Ö Ğ Ş Ç) is the default
// for people and has its own test (letters.spec.ts).
const officialLatin = [baseURL, process.env.E2E_BASE_URL_2].filter((u): u is string => !!u).map((u) => ({
  origin: new URL(u).origin,
  localStorage: [{ name: 'oversells.lang', value: 'uz' }],
}));

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 90_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    storageState: { cookies: [], origins: officialLatin },
    // For a local HTTPS setup with a self-signed / internal CA certificate (Caddy on localhost).
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === '1',
    viewport: { width: 1500, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: preinstalledChromium ? { executablePath: preinstalledChromium } : {},
  },
});
