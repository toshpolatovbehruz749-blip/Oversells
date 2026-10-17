import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', worker: 'src/worker.ts', 'copy-storage': 'src/tools/copy-storage.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (shipped as TypeScript source).
  noExternal: ['@oversells/shared'],
});
