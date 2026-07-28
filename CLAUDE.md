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
  html.ts              # HTML rendering: escapeHtml, stripAnsi, badge, htmlDocument, runDate, renderStep, renderTest, renderTestCaseIndex, renderTableOfContents, renderTraceabilityMatrix, renderReport
  evidence-reporter.ts # Playwright Reporter implementation — writes output on onEnd()
  step.ts              # setupStep() and evidenceStep() helpers for use in test files
  index.ts             # Public exports: setupStep, evidenceStep, EvidenceStepOptions, EvidenceReporter
e2e/
  fixture.html         # Local HTML fixture page used by the POC e2e tests
  example.spec.ts      # POC e2e tests demonstrating package usage
  requirements.json    # Example requirement ID -> description map for the POC's `requirements` option
playwright.config.ts   # Playwright config for the POC e2e tests (output: pdf)
```

## Key design decisions

- **Two output modes** — `output: 'html'` (default) produces a self-contained HTML file with screenshots base64-embedded; `output: 'pdf'` writes screenshots to a sidecar directory during the run, generates a PDF via headless Chromium, then deletes the HTML and sidecar directory — only the PDF is kept
- **PDF mode is CI-storage-friendly** — screenshots are never accumulated as base64 in memory; they're written to disk as PNGs during `onTestEnd` and loaded by Chromium at print time, keeping peak memory and transient disk use low
- **PDF includes headers and footers** — report title and run date in the header; "Skyrocket Software" and page X of Y in the footer, rendered via Chromium's `displayHeaderFooter` with inline-styled templates
- **Two step types** — `setupStep` (no screenshot, muted in report) vs `evidenceStep` (always screenshots, pass/fail badge)
- **Screenshot scale is configurable** — `evidenceStep` accepts `{ screenshotScale: 'css' | 'device' }` (default `'device'`); use `'css'` to halve screenshot dimensions on retina/HiDPI displays and reduce file size
- **Screenshot via body buffer** — `page.screenshot()` returns a Buffer passed directly to `testInfo.attach({ body })` in HTML mode, avoiding tmpdir writes; in PDF mode the buffer is written to the sidecar directory instead
- **Configurable via reporter options** — `output`, `file`, `title`, and `requirements` passed in `playwright.config.ts`
- **Requirements traceability** — an optional `requirements` map ties test tags to functional requirement IDs, surfacing a per-test "Requirements proven" list and a Requirements Traceability Matrix section with a rolled-up pass/fail/skipped/missed status per requirement
- **Stable test IDs, read from annotations, not tags or titles** — a test can carry a `{ type: 'test-id', description: 'TC-...' }` annotation. Tags are reserved for `--grep` filtering and requirement matching; annotations are Playwright's mechanism for arbitrary metadata, which fits an identifier meant only for display and cross-referencing. Shown as an eyebrow label above a test's section heading, in the Test Case Index's ID column, and ahead of the title in the Traceability Matrix's covering-test list — never invented or renumbered by the report itself, so it survives test reordering, sharding, and `--grep` filtering
- **Tests are displayed in test-id order, not run order** — `compareTestOrder` sorts id-carrying tests naturally by their test-id (reusing `compareNaturalIds`, the same numeric-suffix-aware comparator used for requirement IDs) ahead of any test with no test-id, which keeps its original relative position. This one sort is computed once in `renderReport` and reused for the Test Case Index, the Traceability Matrix, and the test sections themselves — so a Test Case Index row and the physical page it links to always agree, instead of the index being reordered while the underlying pages stay in run order
- **One consistent id style everywhere** — every identifier (test-id, requirement id) uses the same small, muted, monospace, never-bold `.id-tag` treatment, whether it's a table cell or inline/eyebrow text. Titles and descriptions next to an id are always plain body weight; bold is reserved for real headings, not for emphasizing one over the other
- **Enclosing `test.describe(...)` title shown as a kicker, not fused into the test's own sentence** — a leaf test title read alone can lose its subject (e.g. "shows the hero heading" reads as a fragment without knowing what "shows" it). `deriveDescribeTitle` walks `TestCase.parent` while `Suite.type === 'describe'` (suites form a strict `root -> project -> file -> describe -> ... -> test` chain, so this naturally excludes the file/project/root titles), joining nested describes outermost-first with `' › '`. Rendered as its own `.describe-label` line above the heading — plain body font, not the monospace `.id-tag` treatment, since it's authored prose, not an identifier — rather than concatenated into one sentence, because a describe block commonly wraps an entire file's worth of tests, and fusing it into every single test's heading would repeat the same prefix down the whole file instead of reading as one clean sentence per test. Not reflected in the Test Case Index or Traceability Matrix — both are sorted by test-id (see above), so a describe's tests aren't contiguous there anyway
- **Test and requirement titles are sentence-cased for display** — the first character is capitalized (a data-level transform, applied before `escapeHtml`, not a CSS trick) since Playwright test names are conventionally authored lowercase-first. Step titles and ids are left exactly as authored
- **PDF page numbers, resolved via a two-pass print** — real page numbers aren't knowable until Chromium has paginated once, so PDF mode prints twice: pass 1 renders with invisible `[[page:ID]]` markers and reserved-but-blank page-number space, then `pdfjs-dist` reads that draft PDF back to map each marker to its page; pass 2 re-renders with the resolved numbers substituted into the same reserved space (so the layout — and the numbers — don't shift between passes) and is the only PDF actually kept. Both passes share one Chromium launch. Page numbers only make sense in PDF mode — HTML mode never renders them. Every page reference is a clickable link to its section, not just a printed number
- **Report structure** — Cover and the master Table of Contents share page 1 (`#table-of-contents` overrides the usual per-section page break); the Table of Contents links/page-numbers to the Requirements Traceability Matrix (if `requirements` is set), the Test Case Index, and "Test Results" — there's no standalone Test Results section, that entry just links straight to the first test — followed by the individual test sections
- **Reporter is opt-in** — consumers add it explicitly to the `reporter` array in their own `playwright.config.ts`

## Conventions

- **Build step required** — `tsup` compiles to `dist/` (ESM + `.d.ts`); run `pnpm run build` before publishing. The `prepare` script runs automatically on `pnpm install`.
- All exports go through `src/index.ts`; the reporter is also accessible via the `./reporter` export condition (maps to `dist/reporter.js`) for use as a Playwright reporter path
- ESLint (`eslint.config.js`) with `typescript-eslint` — run `pnpm run lint`
- Unit tests use Vitest (`src/**/*.test.ts`); e2e tests use Playwright (`e2e/**/*.spec.ts`)
- Scripts: `pnpm test` (unit), `pnpm run test:e2e` (e2e, builds first), `pnpm run lint`, `pnpm run typecheck`

## Reporter options

| Option | Default | Description |
| --- | --- | --- |
| `output` | `'html'` | `'html'` for self-contained HTML; `'pdf'` for PDF only (sidecar mode) |
| `file` | `evidence-report.html` / `evidence-report.pdf` | Output filename. A run timestamp plus a short random suffix is always appended before the extension |
| `latest` | `false` | When `true`, skips the timestamp/suffix and always writes to the exact `file` path (each run overwrites the last) |
| `title` | `'Test Evidence Report'` | Report heading |
| `requirements` | `undefined` | Requirement ID -> description map, matched against each test's tags. Adds a per-test "Requirements proven" list and a Requirements Traceability Matrix section, each covering test listed with its test-id (if tagged, see below) and — in PDF mode — a page reference |

## Usage for AI-assisted development

When generating Playwright tests for a project that uses this package, follow these rules exactly.

### Rules

- Always import `test` from `@playwright/test` and `setupStep`/`evidenceStep` from `@skyrocket-software/playwright-evidence`
- **One `evidenceStep` per test.** Each test makes exactly one assertion inside one `evidenceStep`. Do not put multiple `evidenceStep` calls in a single test.
- **`setupStep` is for navigation and preconditions only.** Never put an `expect()` inside a `setupStep`.
- **`evidenceStep` descriptions must be plain English** readable by a non-technical person, written as a full sentence starting with a verb: "Confirm the...".
- The `evidenceStep` description must precisely describe the assertion being made — it will be used as the screenshot label.
- **`setupStep` descriptions use "Given" framing, not an imperative instruction.** A setup step never gets a screenshot, so phrasing it as a command ("Open the website") reads like an instruction to the reader rather than a record of what the test did — and forcing plain past tense onto a *standing precondition* (as opposed to a discrete action) can read as if it's no longer true. "Given" sidesteps both problems: "Given the website is open", "Given the page has scrolled down to the Contact section", "Given the user has no existing appointments".
- Do not pass `screenshotScale` unless there is a specific reason to override the default.
- **Wrap each spec file's tests in one top-level `test.describe(...)` named for the page or feature under test** (e.g. `test.describe('The homepage', () => { ... })`). The report shows this title as a label above each test's own heading, restoring context a leaf test title can lose on its own — "shows the hero heading" reads as a fragment without it. Only nest additional `test.describe` blocks when a file covers more than one distinct sub-scenario worth its own label.
- **If the project's `playwright.config.ts` passes a `requirements` map to the reporter**, tag every test that proves one of those requirements with `{ tag: '@<requirement-id>' }` (the ID must match a key in the `requirements` map exactly, including case). A test can carry more than one tag if it proves more than one requirement. Do not invent a requirement ID that isn't already a key in the map — ask instead.
- **Whenever a test carries a requirement tag, also give it a stable ID** via `{ annotation: { type: 'test-id', description: 'TC-...' } }`. This is a separate mechanism from the tag: the tag says which requirement the test proves, the annotation says which test this is, independent of its title. Never put a test ID in a tag, a title, or a comment.
- If neither of the above applies (no `requirements` map in the project's reporter config), omit both the tag and the annotation — don't add them speculatively.

### Canonical spec file

```ts
// tests/home.spec.ts
import { expect } from '@playwright/test';
import { test } from '@playwright/test';
import { setupStep, evidenceStep } from '@skyrocket-software/playwright-evidence';

test.describe('The homepage', () => {
  test('page title reads "My App"', async ({ page }, testInfo) => {
    await setupStep('Given the website is open', async () => {
      await page.goto('/');
    });

    await evidenceStep(page, testInfo, 'Confirm the page title reads "My App"', async () => {
      await expect(page).toHaveTitle(/My App/);
    });
  });

  test('contact email links to the correct mailto address', async ({ page }, testInfo) => {
    await setupStep('Given the website is open', async () => {
      await page.goto('/');
    });

    await setupStep('Given the page has scrolled down to the Contact section', async () => {
      await page.locator('#contact').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    });

    await evidenceStep(page, testInfo, 'Confirm the contact email links to the correct mailto address', async () => {
      await expect(page.getByRole('link', { name: 'contact@example.com' }))
        .toHaveAttribute('href', 'mailto:contact@example.com');
    });
  });
});
```

### Canonical spec file — with requirements traceability

Use this shape instead when the project's reporter config passes a `requirements` map (see the Rules above):

```ts
// tests/home.spec.ts
import { expect } from '@playwright/test';
import { test } from '@playwright/test';
import { setupStep, evidenceStep } from '@skyrocket-software/playwright-evidence';

test('page title reads "My App"', {
  tag: '@FR-TITLE-1',
  annotation: { type: 'test-id', description: 'TC-TITLE-1' },
}, async ({ page }, testInfo) => {
  await setupStep('Given the website is open', async () => {
    await page.goto('/');
  });

  await evidenceStep(page, testInfo, 'Confirm the page title reads "My App"', async () => {
    await expect(page).toHaveTitle(/My App/);
  });
});
```

### Canonical reporter config (PDF mode)

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import fs from 'fs';

const requirements: Record<string, string> = JSON.parse(fs.readFileSync('requirements.json', 'utf8'));

export default defineConfig({
  reporter: [
    ['@skyrocket-software/playwright-evidence/reporter', {
      output: 'pdf',
      file: 'evidence-report.pdf',
      title: 'Test Evidence Report',
      requirements,
    }],
  ],
});
```

Omit `requirements` from the reporter config (and the `fs`/`JSON.parse` lines) for a project with no functional-requirements traceability need — in that case, write tests using the plain canonical spec file above, with no tag or annotation.

### What to test

Write one test per meaningful user-visible assertion. Good candidates:
- Page title
- Key headings or taglines visible on the page
- Link href values
- Visible text that is part of the product's identity or claims
- Form elements, CTA buttons, or navigation items
- Visible action results (toasts, form results, etc)

Do not write tests for anything not verifiable via a DOM assertion.
