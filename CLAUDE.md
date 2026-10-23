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
- **PDF includes headers and footers** — report title and run date in the header; the optional `footer` (org/product name, left side) and page X of Y in the footer, rendered via Chromium's `displayHeaderFooter` with inline-styled templates
- **Two step types** — `setupStep` (no screenshot, muted in report) vs `evidenceStep` (always screenshots, pass/fail badge)
- **Screenshot scale is configurable** — `evidenceStep` accepts `{ screenshotScale: 'css' | 'device' }` (default `'device'`); use `'css'` to halve screenshot dimensions on retina/HiDPI displays and reduce file size
- **Screenshot via body buffer** — `page.screenshot()` returns a Buffer passed directly to `testInfo.attach({ body })` in HTML mode, avoiding tmpdir writes; in PDF mode the buffer is written to the sidecar directory instead
- **Configurable via reporter options** — `output`, `file`, `title`, and `requirements` passed in `playwright.config.ts`
- **Requirements traceability** — an optional `requirements` map ties test tags to functional requirement IDs, surfacing a per-test "Requirements proven" list and a Requirements Traceability Matrix section with a rolled-up pass/fail/skipped/missed status per requirement
- **Stable test IDs, read from annotations, not tags or titles** — a test can carry a `{ type: 'test-id', description: 'TC-...' }` annotation. Tags are reserved for `--grep` filtering and requirement matching; annotations are Playwright's mechanism for arbitrary metadata, which fits an identifier meant only for display and cross-referencing. Shown as an eyebrow label above a test's section heading, in the Test Case Index's ID column, and ahead of the title in the Traceability Matrix's covering-test list — never invented or renumbered by the report itself, so it survives test reordering, sharding, and `--grep` filtering
- **Tests are displayed in feature → requirement → test-id order, not run order** — ordering by test-id alone was jarring when a project's test-id scheme and its requirement/feature scheme don't share a vocabulary: the first test on the page had no guaranteed relationship to the first requirement of the first feature. `computeRequirementOrder` ranks every requirement id by the index of its first `about` feature (in the order `about` was authored), falling back to `compareNaturalIds` within a feature and for any requirement with no feature — so with no `about` configured this reduces to a plain natural-id sort. `collectRequirementFeatures` gathers each requirement's `features` (from `requirementsMap` plus any tag-only requirement referenced only by a test) so a requirement never declared in the map still ranks correctly. `compareTestOrder` then ranks each test by the lowest rank among the requirements it proves, ties broken by test-id (`compareNaturalIds`) and finally original run order — so a test proving no ranked requirement, or a project with no `requirements`/`about` configured at all, sees exactly the old test-id-only ordering. This test sort is computed once in `renderReport` and reused for the Test Case Index and the test sections themselves — so a Test Case Index row and the physical page it links to always agree — and `renderTraceabilityMatrix` runs `computeRequirementOrder` over its own (potentially larger) requirement set, so its rows land in the same feature → requirement order as the tests that prove them, instead of drifting to a separately natural-id-sorted requirement order
- **One consistent id style everywhere** — every identifier (test-id, requirement id) uses the same small, muted, monospace, never-bold `.id-tag` treatment, whether it's a table cell or inline/eyebrow text. Titles and descriptions next to an id are always plain body weight; bold is reserved for real headings, not for emphasizing one over the other
- **Enclosing `test.describe(...)` title shown as a kicker, not fused into the test's own sentence** — a leaf test title read alone can lose its subject (e.g. "shows the hero heading" reads as a fragment without knowing what "shows" it). `deriveDescribeTitle` walks `TestCase.parent` while `Suite.type === 'describe'` (suites form a strict `root -> project -> file -> describe -> ... -> test` chain, so this naturally excludes the file/project/root titles), joining nested describes outermost-first with `' › '`. Rendered as its own `.describe-label` line above the heading — plain body font, not the monospace `.id-tag` treatment, since it's authored prose, not an identifier — rather than concatenated into one sentence, because a describe block commonly wraps an entire file's worth of tests, and fusing it into every single test's heading would repeat the same prefix down the whole file instead of reading as one clean sentence per test. Not reflected in the Test Case Index or Traceability Matrix — both are sorted by feature/requirement/test-id (see above), not by describe block, so a describe's tests aren't contiguous there anyway
- **Test and requirement titles are sentence-cased for display** — the first character is capitalized (a data-level transform, applied before `escapeHtml`, not a CSS trick) since Playwright test names are conventionally authored lowercase-first. Step titles and ids are left exactly as authored
- **PDF page numbers, resolved via a two-pass print** — real page numbers aren't knowable until Chromium has paginated once, so PDF mode prints twice: pass 1 renders with invisible `[[page:ID]]` markers and reserved-but-blank page-number space, then `pdfjs-dist` reads that draft PDF back to map each marker to its page; pass 2 re-renders with the resolved numbers substituted into the same reserved space (so the layout — and the numbers — don't shift between passes) and is the only PDF actually kept. Both passes share one Chromium launch. Page numbers only make sense in PDF mode — HTML mode never renders them. Every page reference is a clickable link to its section, not just a printed number
- **Report structure** — Cover and the master Table of Contents always share page 1 (`#table-of-contents` overrides the usual per-section page break) — About (if `about` is set) comes right after the Table of Contents, not before it, so the Table of Contents is never pushed off page 1. The Table of Contents links/page-numbers to About, the Requirements Traceability Matrix (if `requirements` is set), "Test Results", and the Test Case Index — there's no standalone Test Results (or About) heading, those entries just link straight to the first test (or first feature) — followed by the individual test sections, with the Test Case Index rendered last of all: it's a navigation aid, not primary content, so it doesn't bloat the front of the report ahead of the tests it indexes
- **Feature-level traceability via `about`** — an optional `about` map (feature ID -> `{ title, body }`) renders an About section right after the Table of Contents, one shared section for every feature (like the Traceability Matrix's rows share one section) rather than a full page each — feature bodies are usually short prose, and a full page per feature the way a test gets would waste far more space than it's worth; `.section-header`'s existing page-break-after:avoid keeps a feature's heading from being orphaned away from its own body without forcing a break between features. Each `requirements` entry can declare which feature(s) it supports via `features: string[]` (a plain string entry is still accepted, meaning no features); a feature's status is the same rollup used for a single requirement, one level up — `computeRollupStatus` over every test whose matched requirements list that feature, so a feature with nothing pointing to it (or nothing covered yet) reads MISSED exactly like an uncovered requirement does. The Traceability Matrix cross-references each requirement's feature(s) back to its About entry inline with the description (not a separate labeled block — keeps a requirement with features exactly as compact as one without), skipping any feature ID with no matching `about` entry rather than rendering a dead link. The link goes both ways: each Matrix requirement row is itself anchored (`id="requirement-${id}"`, with its own page marker), and each About feature lists the requirements that point to it, naturally sorted and linked back to that anchor — without this, a feature's requirements could only be found by scanning the whole Matrix for matches, since the Matrix->feature link alone has no inverse. `body` is Markdown, rendered via an isolated `marked` instance with raw HTML escaped rather than passed through — PDF mode navigates a real headless Chromium to this HTML, so a stray `<script>` in someone's markdown would otherwise actually execute during report generation
- **Application-level summary via `overview`** — a separate, simpler sibling to `about`: one Markdown string describing the application as a whole (not broken into features, no status rollup, since it isn't tied to any requirement), rendered directly on the cover page between the run date and the pass/fail summary. Same escaped-raw-HTML `marked` rendering as an `about` body
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
| `requirements` | `undefined` | Requirement ID -> description map, matched against each test's tags. A plain string entry is description-only; `{ description, features }` also declares which `about` feature(s) it supports. Adds a per-test "Requirements proven" list and a Requirements Traceability Matrix section, each covering test listed with its test-id (if tagged, see below) and — in PDF mode — a page reference |
| `about` | `undefined` | Feature ID -> `{ title, body }` map (`body` is Markdown). Adds an About section between the cover and the Table of Contents, one page per feature, each with a status rolled up from every test whose matched requirements list that feature |
| `overview` | `undefined` | Markdown description of the application as a whole. Rendered on the cover page itself, between the run date and the pass/fail summary — distinct from `about`, which describes individual features one page each |

## Consumer-facing documentation

Guidance for writing tests in a project that depends on this package — traceability tagging, `setupStep`/`evidenceStep` conventions, canonical spec-file examples — lives in `README.md` and `docs/TEST_WRITING_BEST_PRACTICES.md`, not here. Both ship with the published package (see `files` in `package.json`), so a consuming project's developers and coding agents can actually find them. This file isn't published, so anything consumer-facing added here is invisible to the audience it would be written for.
