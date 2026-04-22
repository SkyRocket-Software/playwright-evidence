# @skyrocket-software/playwright-evidence

A Playwright reporter and step helpers that produce a single self-contained HTML evidence report — suitable for QA sign-off, client delivery, or compliance documentation. All screenshots are base64-embedded; the output is one portable file with no external dependencies.

## Install

```bash
npm install --save-dev github:skyrocket-software/playwright-evidence
```

Requires `@playwright/test >= 1.50.0` as a peer dependency.

## Usage

### Reporter

Run tests with the evidence reporter to produce `evidence-report.html`:

```bash
npx playwright test --reporter=@skyrocket-software/playwright-evidence/reporter
```

Or wire it into a package.json script:

```json
"report": "playwright test --reporter=@skyrocket-software/playwright-evidence/reporter; open evidence-report.html"
```

Configure output via environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `EVIDENCE_REPORT_FILE` | `evidence-report.html` | Output filename |
| `EVIDENCE_REPORT_TITLE` | `Test Evidence Report` | Report heading |

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