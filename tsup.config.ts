import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// The CLI's --version is injected from the manifest at build time. Keeping a
// literal in the source let 0.1.0 ship reporting 0.0.1, in a version that can
// never be edited.
const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  define: { __BLASTPROOF_VERSION__: JSON.stringify(version) },
});
