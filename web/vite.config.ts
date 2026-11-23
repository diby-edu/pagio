import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Outils en ligne de pagio.site, servis sous /app/ (menu « Outils en ligne » et « Se connecter ») ; /api : même origine.
// En développement : npm run dev, avec relais vers https://pagio.site.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
  server: { proxy: { '/api': { target: 'https://pagio.site', changeOrigin: true } } },
});
