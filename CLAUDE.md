# playwright-evidence

| Field | Value |
| --- | --- |
| **Package name** | `@skyrocket-software/playwright-evidence` |
| **Description** | Playwright reporter and step helpers for producing self-contained HTML evidence reports |
| **Language** | TypeScript (strict, ESM) |
| **Peer dependency** | `@playwright/test >= 1.50.0` |

## Structure

```
src/
  html.ts              # Shared HTML primitives: escapeHtml, badge, sharedStyles, htmlDocument, runDate
  evidence-reporter.ts # Playwright Reporter implementation — writes evidence-report.html on onEnd()
  step.ts              # setupStep() and evidenceStep() helpers for use in test files
  index.ts             # Public exports: setupStep, evidenceStep, EvidenceReporter
```

## Key design decisions

- **Self-contained output** — screenshots are base64-embedded in the HTML; no external files or assets
- **Two step types** — `setupStep` (no screenshot, muted in report) vs `evidenceStep` (always screenshots, pass/fail badge)
- **Screenshot via body buffer** — `page.screenshot()` returns a Buffer passed directly to `testInfo.attach({ body })`, avoiding tmpdir writes
- **Configurable via env vars** — `EVIDENCE_REPORT_FILE` and `EVIDENCE_REPORT_TITLE` allow the same reporter to produce differently named/titled reports (e.g. for gremlin runs)
- **Reporter is opt-in** — not registered in `playwright.config.ts` by default; consumers invoke it explicitly via `--reporter` flag so `npm test` uses Playwright's built-in HTML reporter and `npm run report` uses this one

## Conventions

- **Build step required** — `tsup` compiles to `dist/` (ESM + `.d.ts`); run `npm run build` before publishing. The `prepare` script runs automatically on `npm install`.
- All exports go through `src/index.ts`; the reporter is also accessible via the `./reporter` export condition (maps to `dist/reporter.js`) for use as a Playwright reporter path

## Usage for AI-assisted development

When generating Playwright tests for a project that uses this package, follow these rules exactly.

### Rules

- Always import `test` from `@playwright/test` and `setupStep`/`evidenceStep` from `@skyrocket-software/playwright-evidence`
- **One `evidenceStep` per test.** Each test makes exactly one assertion inside one `evidenceStep`. Do not put multiple `evidenceStep` calls in a single test.
- **`setupStep` is for navigation and preconditions only.** Never put an `expect()` inside a `setupStep`.
- **Step descriptions must be plain English** readable by a non-technical person. Write them as full sentences starting with a verb: "Confirm the...", "Scroll down to...", "Open the...".
- The `evidenceStep` description must precisely describe the assertion being made — it will be used as the screenshot label.

### Canonical spec file

```ts
// tests/home.spec.ts
import { expect } from '@playwright/test';
import { test } from '@playwright/test'
import { setupStep, evidenceStep } from '@skyrocket-software/playwright-evidence';

test('page title reads "My App"', async ({ page }, testInfo) => {
  await setupStep('Open the website', async () => {
    await page.goto('/');
  });

  await evidenceStep(page, testInfo, 'Confirm the page title reads "My App"', async () => {
    await expect(page).toHaveTitle(/My App/);
  });
});

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

### What to test

Write one test per meaningful user-visible assertion. Good candidates:
- Page title
- Key headings or taglines visible on the page
- Link href values
- Visible text that is part of the product's identity or claims
- Form elements, CTA buttons, or navigation items
- Visible action results (toasts, form results, etc)

Do not write tests for anything not verifiable via a DOM assertion.
