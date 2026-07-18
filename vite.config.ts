import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Stamped into the build so any screenshot/recording identifies its version
// (a stale cached bundle once cost us a bug hunt).
let buildId = 'dev';
try {
  buildId = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout (CI tarball etc.) — keep 'dev' */
}

export default defineConfig({
  // GitHub Pages serves the site at /<repo-name>/
  base: '/Days-Gone-Clone/',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
