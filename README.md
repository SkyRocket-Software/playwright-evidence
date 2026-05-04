# @skyrocket-software/playwright-evidence

A Playwright reporter and step helpers that produce evidence reports — suitable for QA sign-off, client delivery, or compliance documentation.

Two output modes:

- **HTML** (default) — a single self-contained file with screenshots base64-embedded; no external dependencies
- **PDF** — screenshots written to a sidecar directory during the run, PDF generated via headless Chromium, then the HTML and sidecar directory are deleted; only the PDF is kept. Designed for CI environments where storage matters.

## Install

```bash
npm install --save-dev github:skyrocket-software/playwright-evidence
```

Requires `@playwright/test >= 1.50.0` as a peer dependency.

## Usage

### Reporter

Register the reporter in your `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['@skyrocket-software/playwright-evidence/reporter', {
      output: 'pdf',               // 'html' (default) or 'pdf'
      file: 'evidence-report.pdf', // default: evidence-report.html / evidence-report.pdf
      title: 'Test Evidence Report', // default: Test Evidence Report
    }],
  ],
});
```

| Option | Default | Description |
| --- | --- | --- |
| `output` | `'html'` | `'html'` for self-contained HTML; `'pdf'` for PDF only (sidecar mode) |
| `file` | `evidence-report.html` / `.pdf` | Output filename |
| `title` | `'Test Evidence Report'` | Report heading |

### Step helpers

Use `setupStep` for navigation and preconditions (rendered muted, no screenshot), and `evidenceStep` for assertions (always captures a screenshot, pass or fail).

```ts
import { expect } from '@playwright/test';
import { test } from '@playwright/test';
import { setupStep, evidenceStep } from '@skyrocket-software/playwright-evidence';

test('contact email links to the correct mailto address', async ({ page }, testInfo) => {
  await setupStep('Open the website', async () => {
    await page.goto('/');
  });

  await setupStep('Scroll down to the Contact section', async () => {
    await page.locator('#contact').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
  });

  await evidenceStep(page, testInfo, 'Confirm the contact email links to the correct mailto address', async () => {
    await expect(page.getByRole('link', { name: 'contact@example.com' }))
      .toHaveAttribute('href', 'mailto:contact@example.com');
  });
});
```

#### Screenshot scale

By default screenshots are captured at full device pixel ratio. Pass `{ screenshotScale: 'css' }` to capture at CSS pixels instead — this halves dimensions on retina/HiDPI displays and significantly reduces file size:

```ts
await evidenceStep(page, testInfo, 'Confirm the dashboard loads', async () => {
  await expect(page.locator('#dashboard')).toBeVisible();
}, { screenshotScale: 'css' });
```

## Report format

- Cover page with overall PASS/FAIL status and test count
- One section per test with a step table
- Setup steps rendered as muted/italic rows with no badge
- Evidence steps rendered with PASS/FAIL badge and an embedded screenshot
- Error output shown inline for failing tests
- PDF includes page headers (report title, run date) and footers (page X of Y)
- Print-friendly CSS included
