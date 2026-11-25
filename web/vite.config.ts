import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Outils en ligne de pagio.site, servis sous /app/ (menu « Outils en ligne » et « Se connecter ») ; /api : même origine.
// En développement : npm run dev, avec relais vers https://pagio.site.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  // Deux entrées : l'appli (/app/ : compte, connexion) et l'outil intégré aux pages du site (src/embed.tsx).
  // Le manifeste (.vite/manifest.json) donne au générateur du site les noms des fichiers produits.
  build: {
    outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500, manifest: true,
    rollupOptions: { input: { app: 'index.html', embed: 'src/embed.tsx' } },
  },
  server: { proxy: { '/api': { target: 'https://pagio.site', changeOrigin: true } } },
});
