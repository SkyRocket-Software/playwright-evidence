import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:4321',
  },
  webServer: {
    // Serve the fixture directory with npx serve — no install needed, it's in the node_modules bin
    command: 'npx serve e2e --listen 4321 --no-clipboard',
    url: 'http://localhost:4321',
    reuseExistingServer: false,
  },
  reporter: [
    ['list'],
    [
      path.resolve(__dirname, 'dist/reporter.js'),
      { output: 'pdf', file: 'e2e-output/evidence-report.pdf', title: 'Skyrocket POC Evidence' },
    ],
  ],
});
