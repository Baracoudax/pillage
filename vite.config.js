import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
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
