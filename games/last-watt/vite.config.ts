import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// GitHub Pages serves this game from a per-game subpath so several games can share
// one Pages site. Override with LW_BASE=/ when serving from a host root.
const base = process.env.LW_BASE ?? '/YXHJ/last-watt/';

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    // three ships as a single ~580 kB chunk; that is the floor, not a smell.
    chunkSizeWarningLimit: 1200,
  },
});
