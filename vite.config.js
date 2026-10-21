import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  // sous-dossier de publication (GitHub Pages : /<dépôt>/)
  base: process.env.BASE || '/',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2019',
    chunkSizeWarningLimit: 900,
  },
  server: {
    fs: { allow: ['..'] },
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
