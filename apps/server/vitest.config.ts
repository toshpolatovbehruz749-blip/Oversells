import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          globalSetup: ['test/global-setup.ts'],
          // Tests share one PostgreSQL test database.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          globalSetup: ['test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 180_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
