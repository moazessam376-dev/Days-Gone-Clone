import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site at /<repo-name>/
  base: '/Days-Gone-Clone/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
