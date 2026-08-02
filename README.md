# @skyrocket-software/playwright-evidence

A Playwright reporter and step helpers that produce evidence reports — suitable for QA sign-off, client delivery, or compliance documentation.

Two output modes:

- **HTML** (default) — a single self-contained file with screenshots base64-embedded; no external dependencies
- **PDF** — screenshots written to a sidecar directory during the run, PDF generated via headless Chromium, then the HTML and sidecar directory are deleted; only the PDF is kept. Designed for CI environments where storage matters.

## Install

This package is distributed via GitHub Packages. You will need a GitHub personal access token with `read:packages` scope.

### 1. Configure the registry

Add a `.npmrc` file to the root of your project:

```text
@skyrocket-software:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Set the `GITHUB_TOKEN` environment variable to your personal access token, or add it to your CI secrets.

For pnpm, the same `.npmrc` format is supported. Alternatively, you can configure it in `.pnpmfile.cjs` or via `pnpm config`:

```bash
pnpm config set @skyrocket-software:registry https://npm.pkg.github.com
```

### 2. Install the package

PNPM -

```bash
pnpm add -D @skyrocket-software/playwright-evidence
```

NPM -

```bash
npm install --save-dev @skyrocket-software/playwright-evidence
```

Requires `@playwright/test >= 1.50.0` and `playwright-core >= 1.50.0` as peer dependencies. Both are satisfied automatically if you have `@playwright/test` installed.

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
| `file` | `evidence-report.html` / `.pdf` | Output filename. A run timestamp plus a short random suffix is always appended before the extension, e.g. `report.pdf` becomes `report-20260724-143005-a1b2c3.pdf`, so repeated runs — including ones that start within the same second — never overwrite each other |
| `latest` | `false` | When `true`, skips the timestamp/suffix and always writes to the exact `file` path, so each run overwrites the last — useful for a stable "latest" link instead of one file per run |
| `title` | `'Test Evidence Report'` | Report heading |
| `requirements` | `undefined` | Maps a functional requirement ID (matched against each test's tags, leading `@` stripped) to its prose description. When set, each test's section lists the requirement(s) it proves, and a Requirements Traceability Matrix section lists every requirement, its covering test(s), and a rolled-up pass/fail/skipped/missed status |

#### Flaky tests

If your `playwright.config.ts` sets `retries` (a common CI pattern, e.g. `retries: process.env.CI ? 2 : 0`), a test that fails on its first attempt but passes on a retry is reported as **FLAKY** rather than a plain PASS — its own badge and color, distinct from both PASS and FAIL. The report's overall cover-page status becomes FLAKY too whenever this happens with no other failures (a hard failure still takes priority over a flaky one). This is automatic — nothing needs to be configured or tagged. A flaky test still counts toward the "passed" tally, since it did pass; FLAKY is a visibility signal, not a failure.

#### Supplying `requirements` from a file

`requirements` is a plain `Record<string, string>` — this package has no opinion on where it comes from. A common case is stakeholders (including non-technical ones) maintaining the requirement list outside the codebase, in whatever file format they're comfortable with.

For example, from JSON:

```json
// requirements.json
{
  "FR-LOGIN-1": "Users can log in with valid credentials",
  "FR-LOGIN-2": "Users can log out"
}
```

```ts
// playwright.config.ts
import fs from 'fs';

const requirements: Record<string, string> = JSON.parse(fs.readFileSync('requirements.json', 'utf8'));

export default defineConfig({
  reporter: [
    ['@skyrocket-software/playwright-evidence/reporter', { output: 'pdf', requirements }],
  ],
});
```

The same pattern works for CSV, YAML, or anything else — read the file and parse it into a `Record<string, string>` before passing it to `requirements`. CSV and YAML both need a parsing library (e.g. `csv-parse`, `yaml`) to handle escaping correctly (quoted fields, embedded commas/colons); JSON needs none, since `JSON.parse` is built in.

#### Tagging a test with the requirement it proves

Tag a test with `@` plus the requirement ID from the `requirements` map (Playwright's [`tag` option](https://playwright.dev/docs/test-annotations#tag-tests), not a comment or a title prefix):

```ts
test('users can log in with valid credentials', { tag: '@FR-LOGIN-1' }, async ({ page }, testInfo) => {
  // ...
});
```

A test can carry more than one tag if it proves more than one requirement. Any test whose tags include no matching requirement ID is left off the Traceability Matrix entirely; any requirement with no matching test is listed with a `MISSED` status.

#### Giving a test a stable ID

Independently of requirement tags, a test can carry a stable identifier via Playwright's [`annotation` option](https://playwright.dev/docs/test-annotations#annotations):

```ts
test('users can log in with valid credentials', {
  tag: '@FR-LOGIN-1',
  annotation: { type: 'test-id', description: 'TC-LOGIN-1' },
}, async ({ page }, testInfo) => {
  // ...
});
```

Unlike a tag (which drives `--grep` filtering and requirement matching) or the test title (which can be reworded freely), a `test-id` annotation exists only to identify the test itself. The report shows it — never invented or renumbered — as an eyebrow above the test's section heading, in the Test Case Index's ID column, and ahead of the title in the Traceability Matrix's covering-test list, so the reference survives the test being renamed, reordered, or resharded. It's optional, but recommended for any test tagged with a requirement.

#### Grouping tests with `test.describe`

Wrapping related tests in a [`test.describe`](https://playwright.dev/docs/api/class-test#test-describe) block adds its title as a label above each test's own heading in the report:

```ts
test.describe('The homepage', () => {
  test('shows the hero heading', async ({ page }, testInfo) => {
    // ...
  });
});
```

A leaf test title read on its own can lose its subject — "shows the hero heading" reads as a fragment without knowing what shows it. The describe title restores that context without repeating it inside every test's own title. Nested `test.describe` blocks join outermost-first (`Parent title › Child title`); a test with no enclosing `test.describe` gets no label. This label only appears on the test's own section — the Test Case Index and Traceability Matrix are sorted by test-id (see above), so a describe's tests aren't grouped together there anyway.

### Step helpers

Use `setupStep` for navigation and preconditions (rendered muted, no screenshot), and `evidenceStep` for assertions (always captures a screenshot, pass or fail).

Phrase a `setupStep` description as a "Given ..." precondition, not an imperative instruction — it never gets a screenshot, so "Open the website" reads like a command to the reader rather than a record of what happened, and plain past tense ("Opened the website") can read oddly for a *standing* precondition rather than a one-off action (e.g. "Given the user has no existing appointments" holds for the whole test; "Had no existing appointments" implies it might not anymore). `evidenceStep` descriptions stay full imperative-style sentences ("Confirm the...") since they double as the screenshot's caption.

```ts
import { expect } from '@playwright/test';
import { test } from '@playwright/test';
import { setupStep, evidenceStep } from '@skyrocket-software/playwright-evidence';

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
```

#### Screenshot scale

By default screenshots are captured at full device pixel ratio. Pass `{ screenshotScale: 'css' }` to capture at CSS pixels instead — this halves dimensions on retina/HiDPI displays and significantly reduces file size:

```ts
await evidenceStep(page, testInfo, 'Confirm the dashboard loads', async () => {
  await expect(page.locator('#dashboard')).toBeVisible();
}, { screenshotScale: 'css' });
```

Leave this at the default unless you have a specific reason to override it — most projects never need to.

### Full example

A complete spec file, wrapped in one top-level `test.describe` per the convention above:

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
});
```

If the project's `playwright.config.ts` passes a `requirements` map to the reporter, tag the test with the requirement it proves and give it a stable ID instead:

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

Omit the `tag` and `annotation` entirely for a project with no `requirements` map configured — don't add them speculatively.

## Test writing conventions

See [`docs/TEST_WRITING_BEST_PRACTICES.md`](docs/TEST_WRITING_BEST_PRACTICES.md) for the full set of conventions — setup vs. evidence steps, tagging, describe grouping, and more — that make a generated report readable as a standalone validation record. It ships with the published package, so it's available at `node_modules/@skyrocket-software/playwright-evidence/docs/TEST_WRITING_BEST_PRACTICES.md` for developers and coding agents working in a consuming project.

## Generating the evidence PDF on every PR

The PDF can be published as a GitHub Actions artifact so reviewers can download it directly from the PR checks page.

### Minimal workflow

```yaml
# .github/workflows/evidence.yml
name: Evidence Report

on:
  pull_request:

jobs:
  evidence:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.5.0

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: Run tests and generate evidence PDF
        run: pnpm exec playwright test

      - name: Upload evidence report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: evidence-report
          path: evidence-report-*.pdf   # timestamp suffix added at runtime — glob against the 'file' option's base name
          if-no-files-found: warn
          retention-days: 90
```

A few things to note:

- **`if: always()`** — uploads the report even when tests fail, which is when you most need it.
- **`--with-deps chromium`** — installs the system libraries Chromium needs on Ubuntu; required for PDF generation.
- **`retention-days`** — set to whatever matches your compliance requirements; GitHub's maximum is 90 days.
- The `path` in the upload step must glob against the `file` option's base name — the run timestamp appended to the actual filename means it never matches exactly.

After the workflow runs, the PDF appears under **Artifacts** at the bottom of the Actions run summary page. Anyone with read access to the repository can download it.

### If you already have a CI workflow

Add the two steps — `Install Playwright browsers` and `Upload evidence report` — to your existing job. The upload step is the only addition required if Chromium is already installed.

## Report format

- Cover page with overall PASS/FAIL/FLAKY status and test count
- Table of Contents linking to the Requirements Traceability Matrix (if `requirements` is set) and every test
- Requirements Traceability Matrix listing each requirement, its covering test(s), and a rolled-up PASS/FAIL/SKIPPED/MISSED/FLAKY status (if `requirements` is set)
- One section per test with a step table, headed by its `test-id` (if annotated), its enclosing `test.describe` title (if any), and the requirement(s) it proves (if tagged)
- Setup steps rendered as muted/italic rows with no badge
- Evidence steps rendered with PASS/FAIL badge and an embedded screenshot
- A test that only passed after a retry is marked FLAKY rather than PASS
- Error output shown inline for failing tests
- Test Case Index listing every test's ID (if annotated), title, and result, at the end of the report — sorted by test-id, with any test that has no test-id following after, in run order
- In PDF mode, every page reference (Table of Contents, Test Case Index, Traceability Matrix) is a real, resolved page number and a clickable link to its target
- PDF includes page headers (report title, run date) and footers (page X of Y)
- Print-friendly CSS included
