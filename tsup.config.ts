import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    reporter: 'src/evidence-reporter.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['@playwright/test'],
});
