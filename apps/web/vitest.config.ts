import { defineConfig } from 'vitest/config';

// Unit tests of pure client modules (tokenizer, dictionaries, transliteration).
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'] },
});
