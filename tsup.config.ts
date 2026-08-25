import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    reporter: 'src/evidence-reporter.ts',
    'generate-cli': 'src/generate-cli.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['@playwright/test'],
});
