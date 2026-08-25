import { defineConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Content {
  title: string;
  overview: string;
  features: Record<string, { title: string; body: string }>;
  requirements: Record<string, string | { description: string; features?: string[] }>;
}

// A single content file drives the report's title, overview, about features,
// and requirements — this package has no opinion on where any of this comes
// from, or whether it's one file or several; README.md shows the same
// "bring your own parsed data" pattern for CSV/YAML/etc.
const content: Content = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'e2e/content.json'), 'utf8'),
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
        title: content.title,
        overview: content.overview,
        // FR-PRICING-1 (see e2e/content.json) is deliberately untagged by any
        // test — demonstrates the traceability matrix surfacing a MISSED
        // requirement, and — since it's the only requirement under the
        // "pricing" feature — an About section also showing MISSED.
        requirements: content.requirements,
        features: content.features,
      },
    ],
  ],
});
