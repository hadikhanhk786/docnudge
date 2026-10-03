import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static files in /public (including _routes.json, _redirects, _headers) are copied to /dist.
// In development the browser talks to Vite (5173); /api is proxied to `wrangler pages dev` (8788).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
  server: { proxy: { '/api': 'http://127.0.0.1:8788' } },
});
