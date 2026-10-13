import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // ws: true also proxies the real-time editing WebSocket (/api/collab/...).
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', ws: true } },
  },
  // PDF.js alone is ~1 MB; it is only loaded on the editor page.
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
