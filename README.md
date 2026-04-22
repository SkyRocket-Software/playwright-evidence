# @skyrocket-software/playwright-evidence

A Playwright reporter and step helpers that produce a single self-contained HTML evidence report — suitable for QA sign-off, client delivery, or compliance documentation. All screenshots are base64-embedded; the output is one portable file with no external dependencies.

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
      file: 'evidence-report.html',   // optional, default: evidence-report.html
      title: 'Test Evidence Report',  // optional, default: Test Evidence Report
    }],
  ],
});
```

| Option | Default | Description |
| --- | --- | --- |
| `file` | `evidence-report.html` | Output filename |
| `title` | `Test Evidence Report` | Report heading |

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

  await evidenceStep(page, testInfo, 'Confirm the contact email links to the correct mailto address', async () => {
    await expect(page.getByRole('link', { name: 'contact@example.com' }))
      .toHaveAttribute('href', 'mailto:contact@example.com');
  });
});
```

## Report format

- Cover page with overall PASS/FAIL status and test count
- One section per test with a step table
- Setup steps rendered as muted/italic rows with no badge
- Evidence steps rendered with PASS/FAIL badge and an embedded screenshot
- Error output shown inline for failing tests
- Print-friendly CSS included