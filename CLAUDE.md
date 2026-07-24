# playwright-evidence

| Field | Value |
| --- | --- |
| **Package name** | `@skyrocket-software/playwright-evidence` |
| **Description** | Playwright reporter and step helpers for producing evidence reports as self-contained HTML or PDF |
| **Language** | TypeScript (strict, ESM) |
| **Peer dependency** | `@playwright/test >= 1.50.0` |

## Structure

```text
src/
  html.ts              # HTML rendering: escapeHtml, stripAnsi, badge, htmlDocument, runDate, renderStep, renderTest, renderReport
  evidence-reporter.ts # Playwright Reporter implementation — writes output on onEnd()
  step.ts              # setupStep() and evidenceStep() helpers for use in test files
  index.ts             # Public exports: setupStep, evidenceStep, EvidenceStepOptions, EvidenceReporter
e2e/
  fixture.html         # Local HTML fixture page used by the POC e2e tests
  example.spec.ts      # POC e2e tests demonstrating package usage
playwright.config.ts   # Playwright config for the POC e2e tests (output: pdf)
```

## Key design decisions

- **Two output modes** — `output: 'html'` (default) produces a self-contained HTML file with screenshots base64-embedded; `output: 'pdf'` writes screenshots to a sidecar directory during the run, generates a PDF via headless Chromium, then deletes the HTML and sidecar directory — only the PDF is kept
- **PDF mode is CI-storage-friendly** — screenshots are never accumulated as base64 in memory; they're written to disk as PNGs during `onTestEnd` and loaded by Chromium at print time, keeping peak memory and transient disk use low
- **PDF includes headers and footers** — report title and run date in the header; "Skyrocket Software" and page X of Y in the footer, rendered via Chromium's `displayHeaderFooter` with inline-styled templates
- **Two step types** — `setupStep` (no screenshot, muted in report) vs `evidenceStep` (always screenshots, pass/fail badge)
- **Screenshot scale is configurable** — `evidenceStep` accepts `{ screenshotScale: 'css' | 'device' }` (default `'device'`); use `'css'` to halve screenshot dimensions on retina/HiDPI displays and reduce file size
- **Screenshot via body buffer** — `page.screenshot()` returns a Buffer passed directly to `testInfo.attach({ body })` in HTML mode, avoiding tmpdir writes; in PDF mode the buffer is written to the sidecar directory instead
- **Configurable via reporter options** — `output`, `file`, and `title` passed in `playwright.config.ts`
- **Reporter is opt-in** — consumers add it explicitly to the `reporter` array in their own `playwright.config.ts`

## Conventions

- **Build step required** — `tsup` compiles to `dist/` (ESM + `.d.ts`); run `npm run build` before publishing. The `prepare` script runs automatically on `npm install`.
- All exports go through `src/index.ts`; the reporter is also accessible via the `./reporter` export condition (maps to `dist/reporter.js`) for use as a Playwright reporter path
- ESLint (`eslint.config.js`) with `typescript-eslint` — run `npm run lint`
- Unit tests use Vitest (`src/**/*.test.ts`); e2e tests use Playwright (`e2e/**/*.spec.ts`)
- Scripts: `npm test` (unit), `npm run test:e2e` (e2e, builds first), `npm run lint`, `npm run typecheck`

## Reporter options

| Option | Default | Description |
| --- | --- | --- |
| `output` | `'html'` | `'html'` for self-contained HTML; `'pdf'` for PDF only (sidecar mode) |
| `file` | `evidence-report.html` / `evidence-report.pdf` | Output filename. A run timestamp plus a short random suffix is always appended before the extension |
| `latest` | `false` | When `true`, skips the timestamp/suffix and always writes to the exact `file` path (each run overwrites the last) |
| `title` | `'Test Evidence Report'` | Report heading |

## Usage for AI-assisted development

When generating Playwright tests for a project that uses this package, follow these rules exactly.

### Rules

- Always import `test` from `@playwright/test` and `setupStep`/`evidenceStep` from `@skyrocket-software/playwright-evidence`
- **One `evidenceStep` per test.** Each test makes exactly one assertion inside one `evidenceStep`. Do not put multiple `evidenceStep` calls in a single test.
- **`setupStep` is for navigation and preconditions only.** Never put an `expect()` inside a `setupStep`.
- **Step descriptions must be plain English** readable by a non-technical person. Write them as full sentences starting with a verb: "Confirm the...", "Scroll down to...", "Open the...".
- The `evidenceStep` description must precisely describe the assertion being made — it will be used as the screenshot label.
- Do not pass `screenshotScale` unless there is a specific reason to override the default.

### Canonical spec file

```ts
// tests/home.spec.ts
import { expect } from '@playwright/test';
import { test } from '@playwright/test';
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

### Canonical reporter config (PDF mode)

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['@skyrocket-software/playwright-evidence/reporter', {
      output: 'pdf',
      file: 'evidence-report.pdf',
      title: 'Test Evidence Report',
    }],
  ],
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
