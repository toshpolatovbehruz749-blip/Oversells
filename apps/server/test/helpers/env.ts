import 'dotenv/config';

/**
 * Database used by the tests. It is wiped on every run, so it must never point
 * at real data. Defaults to the `oversells_test` database next to DATABASE_URL.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? 'postgresql://oversells:oversells@localhost:5432/oversells';
  const url = new URL(base);
  url.pathname = '/oversells_test';
  return url.toString();
}
