import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testDatabaseUrl } from './helpers/env.js';

/** Applies migrations to the test database once per test run (creates it if missing). */
export default function setup(): void {
  const url = testDatabaseUrl();
  if (!new URL(url).pathname.includes('test')) {
    throw new Error(`Refusing to run tests against a database without "test" in its name: ${url}`);
  }
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execSync('npx prisma migrate deploy', {
    cwd,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
