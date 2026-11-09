import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' : le tableau de bord fonctionne servi par le serveur Pagio ou depuis n'importe quel dossier statique.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
});
