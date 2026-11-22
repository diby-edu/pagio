import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Application web servie par Nginx sur app.pagio.site ; /api est relayé vers le serveur Pagio (même origine).
// En développement : npm run dev, avec relais vers https://pagio.site.
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
  server: { proxy: { '/api': { target: 'https://pagio.site', changeOrigin: true } } },
});
