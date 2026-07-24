import { defineConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The reporter's `requirements` option is a plain Record<string, string> —
// build it however you like. This demo reads it from JSON; README.md shows
// the same pattern for CSV/YAML/etc.
const requirements: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'e2e/requirements.json'), 'utf8'),
);

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
      {
        output: 'pdf',
        file: 'e2e-output/evidence-report.pdf',
        title: 'Skyrocket POC Evidence',
        // FR-PRICING-1 (see e2e/requirements.json) is deliberately untagged
        // by any test — demonstrates the traceability matrix surfacing a
        // MISSED requirement, not just covered ones.
        requirements,
      },
    ],
  ],
});
