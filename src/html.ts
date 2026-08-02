/**
 * Shared HTML primitives and report-rendering functions for evidence reports.
 */

import { compact, escape, min, sumBy, upperFirst } from 'lodash-es';
import { Marked } from 'marked';

export interface StepRecord {
  title: string;
  status: 'pass' | 'fail';
  screenshotLabel: string | null;
  /** Set in html mode — base64-encoded PNG embedded directly in the HTML. */
  screenshotBase64: string | null;
  /** Set in pdf mode — relative path from the HTML file to the sidecar PNG. */
  screenshotPath: string | null;
}

export interface RequirementRecord {
  id: string;
  description: string;
  /** Feature IDs (keys into the `about` map) this requirement supports. Empty when the requirement declares none. */
  features: string[];
}

/**
 * A `requirements` map entry's object form — a plain string is still accepted
 * as shorthand for `{ description }` with no features (see `normalizeRequirementInput`).
 */
export interface RequirementInput {
  description: string;
  /** Feature IDs (keys into the `about` map) this requirement supports. */
  features?: string[];
}

export interface AboutFeature {
  title: string;
  /** Markdown prose, rendered via `marked`. Raw HTML in the source is escaped, not passed through. */
  body: string;
}

export interface TestRecord {
  title: string;
  /** 'flaky' means the test only passed after Playwright retried it, distinct from a clean first-try 'pass'. */
  status: 'pass' | 'fail' | 'skipped' | 'flaky';
  steps: StepRecord[];
  error: string | null;
  requirements: RequirementRecord[];
  /** Stable identifier from a `type: 'test-id'` annotation, or null if the test has none. */
  testId: string | null;
  /** Enclosing `test.describe(...)` title chain, joined with ' › ', or null if the test has no enclosing describe block. */
  describeTitle: string | null;
}

/**
 * Controls how page-number references render across the two Chromium print
 * passes used to resolve real page numbers (see evidence-reporter.ts):
 * - `undefined`: HTML mode — there's no such thing as a "page" in scrolling
 *   HTML, so no page reference or marker is rendered at all.
 * - `'reserve'`: print pass 1 — renders invisible markers (for pdfjs-dist to
 *   locate) and reserves a fixed-width blank space wherever a page number
 *   will eventually go, so pass 2's layout doesn't shift once real numbers
 *   are filled in.
 * - `Map<string, number>`: print pass 2 — resolved marker id -> 1-based page
 *   number, substituted into the same reserved space.
 */
export type PageNumbers = Map<string, number> | 'reserve' | undefined;

// Re-exported for callers outside this file — everything below calls lodash's
// `escape` directly. Wherever `upperFirst` also applies to the same string,
// it must run first — escaping first could corrupt an entity like `&amp;`
// into `&Amp;`.
export { escape as escapeHtml };

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Isolated instance, not the shared default — avoids mutating global
// markdown behavior for anything else that imports 'marked' in this process.
const markdownRenderer = new Marked({
  renderer: {
    html: ({ text }) => escape(text),
  },
});

/**
 * Renders `about`/`overview` Markdown to HTML, escaping any raw HTML in the
 * source — PDF mode navigates real headless Chromium to this HTML, so a
 * stray `<script>` in someone's markdown would otherwise execute for real.
 */
function renderMarkdown(markdown: string): string {
  return markdownRenderer.parse(markdown, { async: false });
}

export function badge(text: string, variant: 'pass' | 'fail' | 'skipped' | 'missed' | 'flaky'): string {
  return `<span class="badge badge-${variant}">${text}</span>`;
}

/** Maps a test's status to its badge label and color variant — shared so the Test Case Index and a test's own heading can't disagree. */
function statusBadge(status: TestRecord['status']): { variant: 'pass' | 'fail' | 'skipped' | 'flaky'; text: string } {
  switch (status) {
    case 'pass':
      return { variant: 'pass', text: 'PASS' };
    case 'flaky':
      return { variant: 'flaky', text: 'FLAKY' };
    case 'skipped':
      return { variant: 'skipped', text: 'SKIP' };
    case 'fail':
      return { variant: 'fail', text: 'FAIL' };
  }
}

/**
 * Invisible marker embedded at a section's anchor so print pass 1 can locate
 * its page via pdfjs-dist text extraction. Rendered only in `'reserve'` mode
 * — the final PDF has no use for it once page numbers are resolved.
 */
function pageMarker(markerId: string, pageNumbers: PageNumbers): string {
  if (pageNumbers !== 'reserve') return '';
  return `<div class="page-marker">[[page:${markerId}]]</div>`;
}

/**
 * Digits to reserve for a page-number placeholder. Both print passes must
 * reserve the same width (see `pageReference`), so this has to over-estimate
 * up front rather than use the real count pass 1 discovers. Counts every
 * step, not just every test, since one screenshot-heavy test can span many
 * pages, plus each About feature and a fixed buffer for the pages ahead of
 * the first test.
 */
function estimateMaxPageDigits(tests: TestRecord[], aboutFeatureCount: number): number {
  const totalSteps = sumBy(tests, (test) => test.steps.length);
  return String(tests.length + totalSteps + aboutFeatureCount + 10).length;
}

const PAGE_REF_PREFIX = '— p. ';

/**
 * Renders an inline "— p. N" page reference, linking to the given section.
 * Fixed-width to the worst-case digit count so pass 1 (blank) and pass 2
 * (real number) wrap identically — a reflow between passes would invalidate
 * the very page numbers pass 1 was used to compute.
 *
 * The leading space is a sibling character, not inside the span:
 * `display:inline-block` collapses a leading space like the start of a
 * block, which would swallow the gap before the em dash.
 */
function pageReference(markerId: string, pageNumbers: PageNumbers, maxDigits: number): string {
  if (pageNumbers === undefined) return '';
  const width = `${PAGE_REF_PREFIX.length + maxDigits}ch`;
  if (pageNumbers === 'reserve') {
    return ` <span style="display:inline-block;min-width:${width};"></span>`;
  }
  const page = pageNumbers.get(markerId);
  const text = page === undefined ? '' : `${PAGE_REF_PREFIX}<a href="#${markerId}">${page}</a>`;
  return ` <span style="display:inline-block;min-width:${width};">${text}</span>`;
}

/**
 * Page-number cell for the Table of Contents / Test Case Index. Unlike
 * `pageReference`, no fixed-width trick needed — `col-status` already has a
 * fixed CSS width, so an empty vs. filled cell can't shift pagination.
 */
function pageCell(markerId: string, pageNumbers: PageNumbers): string {
  if (pageNumbers === undefined) return '';
  if (pageNumbers === 'reserve') return `<td class="col-status"></td>`;
  const page = pageNumbers.get(markerId);
  const content = page === undefined ? '' : `<a href="#${markerId}">${page}</a>`;
  return `<td class="col-status">${content}</td>`;
}

function pageColumnHeader(pageNumbers: PageNumbers): string {
  return pageNumbers === undefined ? '' : '<th>Page</th>';
}

export function sharedStyles(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 14px;
      line-height: 1.6;
      color: #111;
      background: #fff;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Cover ───────────────────────────────────────────── */
    .cover {
      padding: 80px 60px;
      border-bottom: 3px solid #111;
      min-height: 260px;
    }
    .cover h1 {
      font-size: 28px;
      font-weight: bold;
      letter-spacing: 0.02em;
      margin-bottom: 8px;
    }
    .cover .meta {
      font-size: 13px;
      color: #555;
      margin-bottom: 32px;
    }
    .cover .overview {
      max-width: 640px;
      font-size: 14px;
      line-height: 1.5;
      color: #333;
      margin-bottom: 24px;
    }
    .cover .overview p {
      margin-bottom: 10px;
    }
    .cover .overview p:last-child {
      margin-bottom: 0;
    }
    .cover .summary-box {
      display: inline-block;
      border: 2px solid #111;
      padding: 16px 28px;
      font-size: 16px;
      font-weight: bold;
    }
    .cover .summary-box .overall {
      font-size: 22px;
      margin-bottom: 4px;
    }
    .cover .summary-box.overall-pass { border-color: #1a6b2a; }
    .cover .summary-box.overall-fail { border-color: #a01010; }
    .cover .summary-box.overall-flaky { border-color: #a86a00; }
    .cover .summary-box .overall.pass-text { color: #1a6b2a; }
    .cover .summary-box .overall.fail-text { color: #a01010; }
    .cover .summary-box .overall.flaky-text { color: #a86a00; }

    /* ── Sections ────────────────────────────────────────── */
    .body {
      padding: 40px 60px;
    }
    .section {
      margin-bottom: 48px;
      border-top: 2px solid #ddd;
      padding-top: 24px;
    }
    .section-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 16px;
    }
    .section-header h2 {
      font-size: 18px;
      font-weight: bold;
    }
    /* Shared identifier styling (test-ids, requirement ids) everywhere in the
       report — always secondary to the title next to it, never as bold as a
       real heading. */
    .id-tag {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      letter-spacing: 0.03em;
      color: #555;
      font-weight: 600;
      white-space: nowrap;
    }

    /* Kicker line above a test's heading, restoring the subject a bare leaf
       title can lose (e.g. "shows the hero heading" reads as a fragment).
       Plain body font, not monospace like .id-tag — this is prose, not an id. */
    .describe-label {
      font-size: 13px;
      color: #555;
      margin-bottom: 4px;
    }

    /* Not height:0 — Chromium skips painting (and extracting as PDF text)
       zero-area content. A hairline height keeps it real but negligible. */
    .page-marker {
      font-size: 1px;
      line-height: 1;
      color: transparent;
      user-select: none;
    }

    /* ── Badges ──────────────────────────────────────────── */
    .badge {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      font-weight: bold;
      padding: 2px 8px;
      border: 1.5px solid currentColor;
      border-radius: 2px;
      white-space: nowrap;
      letter-spacing: 0.08em;
    }
    .badge-pass    { color: #1a6b2a; }
    .badge-fail    { color: #a01010; }
    .badge-skipped { color: #666; }
    .badge-missed  { color: #a01010; }
    .badge-flaky   { color: #a86a00; }

    /* ── Tables ──────────────────────────────────────────── */
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th {
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #555;
      border-bottom: 1px solid #ccc;
      padding: 4px 8px;
    }
    .data-table td {
      padding: 10px 8px;
      vertical-align: top;
      border-bottom: 1px solid #eee;
    }
    .col-num    { color: #888; font-size: 12px; width: 32px; }
    .col-status { width: 80px; text-align: center; }

    /* ── Screenshots ─────────────────────────────────────── */
    .screenshot-row td {
      padding: 0 8px 16px 40px;
      border-bottom: none;
    }
    .screenshot-row img {
      max-width: 100%;
      border: 1px solid #ccc;
      display: block;
    }
    .screenshot-caption {
      font-size: 11px;
      color: #777;
      margin-top: 4px;
      font-style: italic;
    }

    /* ── Links ───────────────────────────────────────────── */
    a {
      color: inherit;
      text-decoration: none;
    }

    /* ── Error block ─────────────────────────────────────── */
    .error-block {
      background: #fff8f8;
      border-left: 3px solid #a01010;
      padding: 10px 14px;
      margin-top: 12px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      white-space: pre-wrap;
      color: #a01010;
    }

    /* ── Detail label ────────────────────────────────────── */
    .detail-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #888;
      margin-bottom: 2px;
    }
    .detail-value {
      font-size: 13px;
      /* Tighter than the inherited body line-height — otherwise the extra
         leading pushes this below the smaller id-tag/badge sharing its row. */
      line-height: 1.3;
      margin-bottom: 12px;
    }

    /* ── Print ───────────────────────────────────────────── */
    @media print {
      body { font-size: 12px; }
      /* The contents page shares page 1 with the cover — see the
         #table-of-contents override below. */
      .cover {
        padding: 60px 40px;
      }
      .body { padding: 20px 40px; }

      /* Not page-break-inside: avoid — a section (test + steps + screenshots)
         is often taller than one page, so avoiding a mid-section break would
         shove the whole thing onto the next page instead. Breaking is
         controlled at the step level (.step-group) instead. Every section
         still starts on a fresh page, so a short section's leftover space
         lands in one place instead of splitting across two pages. */
      .section { page-break-before: always; }
      /* id beats class — keeps the contents page on page 1 with the cover. */
      #table-of-contents { page-break-before: auto; }
      .section-header { page-break-after: avoid; }
      /* Each section now anchors a full page — more weight than the 18px screen size. */
      .section-header h2 { font-size: 22px; }
      .step-group { page-break-inside: avoid; }
      .screenshot-row { page-break-inside: avoid; }
      /* A requirement's two <tr>s (see .requirement-group below) stay together, same as .step-group. */
      .requirement-group { page-break-inside: avoid; }
      .screenshot-row img {
        max-width: 100%;
        max-height: 600px;
        object-fit: contain;
      }
      .cover .summary-box { background: none !important; }
      .error-block { background: none !important; }

      /* Keep at least a few lines of a paragraph/error block together at a page edge. */
      p, .error-block, .detail-value { orphans: 3; widows: 3; }
    }
  `;
}

export function htmlDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escape(title)}</title>
  <style>${sharedStyles()}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Formats a run date for display in the report. Uses UTC so this always agrees
 * with the UTC timestamp embedded in the output filename (see `formatTimestamp`
 * in evidence-reporter.ts) regardless of the machine's local timezone.
 */
export function runDate(date: Date): string {
  return `${date.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
}

/**
 * Renders a step (or setup row) as a table row-group. Setup steps render
 * muted with no screenshot; evidence steps include one. Each step gets its
 * own `<tbody class="step-group">` so print can apply `page-break-inside:
 * avoid` per step, without forcing the whole (possibly multi-page) section
 * to avoid breaking too.
 */
export function renderStep(step: StepRecord, index: number): string {
  const imgSrc = step.screenshotBase64
    ? `data:image/png;base64,${step.screenshotBase64}`
    : step.screenshotPath ?? null;

  if (imgSrc === null) {
    return `
      <tbody class="step-group">
        <tr style="opacity:0.5;">
          <td class="col-num">${index}</td>
          <td><em>${escape(step.title)}</em></td>
          <td class="col-status" style="font-size:11px;color:#888;">setup</td>
        </tr>
      </tbody>`;
  }

  const screenshotRow = `<tr class="screenshot-row">
          <td colspan="3">
            <img src="${escape(imgSrc)}" alt="${escape(step.screenshotLabel ?? step.title)}" />
            <p class="screenshot-caption">Screenshot: ${escape(step.screenshotLabel ?? step.title)}</p>
          </td>
        </tr>`;

  return `
      <tbody class="step-group">
        <tr>
          <td class="col-num">${index}</td>
          <td>${escape(step.title)}</td>
          <td class="col-status">${badge(step.status === 'pass' ? 'PASS' : 'FAIL', step.status)}</td>
        </tr>
        ${screenshotRow}
      </tbody>`;
}

/**
 * Renders the "Requirements proven" list shown under a test's section heading.
 * Returns an empty string when the test has no matched requirements.
 */
export function renderRequirementsList(requirements: RequirementRecord[]): string {
  if (requirements.length === 0) return '';

  const items = requirements
    .map((requirement) => `<li><span class="id-tag">${escape(requirement.id)}</span> — ${escape(upperFirst(requirement.description))}</li>`)
    .join('');

  return `
      <div class="detail-label">Requirements proven</div>
      <ul style="margin:0 0 16px 20px;font-size:13px;">${items}</ul>`;
}

/**
 * Renders a single test section (header, requirements list, step table, error block) as HTML.
 *
 * @param test        - The plain test record to render
 * @param index       - 1-based position in the report, used for the section anchor
 * @param pageNumbers - See `PageNumbers` — controls whether an invisible page marker is embedded
 */
export function renderTest(test: TestRecord, index: number, pageNumbers: PageNumbers): string {
  const { variant: badgeVariant, text: badgeText } = statusBadge(test.status);

  const stepRows = test.steps
    .map((step, si) => renderStep(step, si + 1))
    .join('\n');

  const errorBlock = test.error
    ? `<div class="error-block">${escape(stripAnsi(test.error))}</div>`
    : '';

  const requirementsBlock = renderRequirementsList(test.requirements);

  const testIdEyebrow = test.testId
    ? `<div class="id-tag" style="margin-bottom:4px;">${escape(test.testId)}</div>`
    : '';

  const describeEyebrow = test.describeTitle
    ? `<div class="describe-label">${escape(upperFirst(test.describeTitle))}</div>`
    : '';

  return `
    <div class="section" id="test-${index}">
      ${pageMarker(`test-${index}`, pageNumbers)}
      ${testIdEyebrow}
      ${describeEyebrow}
      <div class="section-header">
        <h2>${escape(upperFirst(test.title))}</h2>
        ${badge(badgeText, badgeVariant)}
      </div>
      ${requirementsBlock}
      ${stepRows
        ? `<table class="data-table">
          <thead><tr><th>#</th><th>Step</th><th>Result</th></tr></thead>
          ${stepRows}
        </table>`
        : '<p style="color:#888;font-size:13px;">No recorded steps.</p>'
      }
      ${errorBlock}
    </div>`;
}

/**
 * Renders the Test Case Index: each test's stable test-id (if any), title,
 * page number (once resolved), and status, linked to its section anchor —
 * Chromium keeps same-document links clickable when printing to PDF.
 */
export function renderTestCaseIndex(tests: TestRecord[], pageNumbers: PageNumbers): string {
  if (tests.length === 0) return '';

  const rows = tests.map((test, i) => {
    const num = i + 1;
    const { variant: badgeVariant, text: badgeText } = statusBadge(test.status);
    return `
      <tr>
        <td class="id-tag">${test.testId ? escape(test.testId) : ''}</td>
        <td><a href="#test-${num}">${escape(upperFirst(test.title))}</a></td>
        ${pageCell(`test-${num}`, pageNumbers)}
        <td class="col-status">${badge(badgeText, badgeVariant)}</td>
      </tr>`;
  }).join('\n');

  return `
    <div class="section toc" id="test-case-index" style="page-break-after:always;">
      ${pageMarker('test-case-index', pageNumbers)}
      <div class="section-header">
        <h2>Test Case Index</h2>
      </div>
      <table class="data-table">
        <thead><tr><th>ID</th><th>Test</th>${pageColumnHeader(pageNumbers)}<th>Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * Renders the page-1 Table of Contents, linking to About (if set), the
 * Traceability Matrix, the Test Case Index, and Test Results. About and Test
 * Results link straight to their first anchor since neither has its own
 * wrapping section. Empty string when there's nothing to list.
 */
export function renderTableOfContents(
  hasMatrix: boolean,
  hasTests: boolean,
  firstAboutFeatureId: string | null,
  pageNumbers: PageNumbers,
): string {
  if (!hasMatrix && !hasTests && !firstAboutFeatureId) return '';

  const rows = compact([
    firstAboutFeatureId
      ? `<tr><td><a href="#about-${firstAboutFeatureId}">About</a></td>${pageCell(`about-${firstAboutFeatureId}`, pageNumbers)}</tr>`
      : '',
    hasMatrix
      ? `<tr><td><a href="#requirements-matrix">Requirements Traceability Matrix</a></td>${pageCell('requirements-matrix', pageNumbers)}</tr>`
      : '',
    hasTests
      ? `<tr><td><a href="#test-case-index">Test Case Index</a></td>${pageCell('test-case-index', pageNumbers)}</tr>`
      : '',
    hasTests
      ? `<tr><td><a href="#test-1">Test Results</a></td>${pageCell('test-1', pageNumbers)}</tr>`
      : '',
  ]).join('\n');

  return `
    <div class="section toc" id="table-of-contents" style="page-break-after:always;">
      <div class="section-header">
        <h2>Table of Contents</h2>
      </div>
      <table class="data-table">
        <thead><tr><th>Section</th>${pageColumnHeader(pageNumbers)}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * Natural-sort comparator for IDs (requirement or test) sharing a common
 * prefix ending in a number (e.g. 'FR-CHANNEL-2' before 'FR-CHANNEL-10') —
 * plain string comparison would otherwise put 'FR-CHANNEL-10' right after
 * 'FR-CHANNEL-1'. Falls back to a plain string comparison when the prefixes
 * differ or either ID doesn't end in a number.
 */
export function compareNaturalIds(a: string, b: string): number {
  const matchA = a.match(/^(.*-)(\d+)$/);
  const matchB = b.match(/^(.*-)(\d+)$/);
  if (matchA && matchB && matchA[1] === matchB[1]) {
    return Number(matchA[2]) - Number(matchB[2]);
  }
  return a.localeCompare(b);
}

/**
 * A test's sort rank: the lowest `computeRequirementOrder` rank among the
 * requirements it proves, or +Infinity if it proves none.
 */
function testRequirementRank(test: TestRecord, requirementRank: Map<string, number>): number {
  return min(test.requirements.map((requirement) => requirementRank.get(requirement.id) ?? Number.POSITIVE_INFINITY)) ?? Number.POSITIVE_INFINITY;
}

/**
 * Orders tests by `requirementRank` (see `computeRequirementOrder`) first, so
 * the first test on the page proves the highest-priority requirement — then
 * by test-id (`compareNaturalIds`), then original order for a tie.
 * `requirementRank` defaults to empty, which ranks every test equally and
 * reduces this to plain test-id ordering.
 */
export function compareTestOrder(
  a: TestRecord,
  b: TestRecord,
  requirementRank: Map<string, number> = new Map(),
): number {
  const rankA = testRequirementRank(a, requirementRank);
  const rankB = testRequirementRank(b, requirementRank);
  if (rankA !== rankB) return rankA - rankB;
  if (a.testId !== null && b.testId !== null) return compareNaturalIds(a.testId, b.testId);
  if (a.testId !== null) return -1;
  if (b.testId !== null) return 1;
  return 0;
}

/**
 * Orders requirement ids by their first `about` feature's position (in
 * authored order), then naturally by id (`compareNaturalIds`) among
 * requirements sharing a feature or sharing "no feature". A requirement with
 * no feature in `about` (or no `about` at all) sorts last, by natural id.
 */
export function computeRequirementOrder(
  requirementIds: Iterable<string>,
  requirementFeatures: Map<string, string[]>,
  about: Record<string, AboutFeature> | undefined,
): string[] {
  const featureIndex = new Map((about ? Object.keys(about) : []).map((featureId, index) => [featureId, index]));

  const firstFeatureIndex = (id: string): number => {
    const indexes = (requirementFeatures.get(id) ?? [])
      .map((featureId) => featureIndex.get(featureId))
      .filter((index): index is number => index !== undefined);
    return min(indexes) ?? Number.POSITIVE_INFINITY;
  };

  return Array.from(requirementIds).sort((a, b) => {
    const indexA = firstFeatureIndex(a);
    const indexB = firstFeatureIndex(b);
    return indexA !== indexB ? indexA - indexB : compareNaturalIds(a, b);
  });
}

/**
 * Collects every requirement id's `features`, including ids referenced only
 * by a test's tags and missing from `requirementsMap`, so
 * `computeRequirementOrder` can rank those too.
 */
export function collectRequirementFeatures(
  tests: TestRecord[],
  requirementsMap: Record<string, string | RequirementInput> | undefined,
): Map<string, string[]> {
  const map = requirementsMap ?? {};
  const features = new Map<string, string[]>();
  for (const id of Object.keys(map)) {
    features.set(id, normalizeRequirementInput(map[id]).features);
  }
  for (const test of tests) {
    for (const requirement of test.requirements) {
      if (!features.has(requirement.id)) features.set(requirement.id, requirement.features);
    }
  }
  return features;
}

/**
 * Rolls up a status from covering tests: 'missed' if none, 'fail' if any
 * failed, 'skipped' if all skipped, 'flaky' if none failed but one needed a
 * retry, else 'pass'. Used for both a requirement's and a feature's covering
 * tests.
 */
export function computeRollupStatus(
  coveringTests: Array<{ status: TestRecord['status'] }>,
): 'pass' | 'fail' | 'skipped' | 'missed' | 'flaky' {
  if (coveringTests.length === 0) return 'missed';
  if (coveringTests.some((test) => test.status === 'fail')) return 'fail';
  if (coveringTests.every((test) => test.status === 'skipped')) return 'skipped';
  if (coveringTests.some((test) => test.status === 'flaky')) return 'flaky';
  return 'pass';
}

/** Normalizes a `requirements` map entry — a bare string is shorthand for `{ description }` with no features. */
export function normalizeRequirementInput(entry: string | RequirementInput): { description: string; features: string[] } {
  return typeof entry === 'string'
    ? { description: entry, features: [] }
    : { description: entry.description, features: entry.features ?? [] };
}

/**
 * Renders the Requirements Traceability Matrix: every requirement (from
 * `requirementsMap` plus any tag-only id), its description, covering test(s)
 * with test-id and page reference, and a rolled-up status. Empty string when
 * there's nothing to list.
 */
export function renderTraceabilityMatrix(
  tests: TestRecord[],
  requirementsMap: Record<string, string | RequirementInput> | undefined,
  about: Record<string, AboutFeature> | undefined,
  pageNumbers: PageNumbers,
): string {
  const map = requirementsMap ?? {};
  const entries = new Map<string, {
    description: string;
    features: string[];
    tests: Array<{ title: string; status: TestRecord['status']; testId: string | null; markerId: string }>;
  }>();

  for (const id of Object.keys(map)) {
    const normalized = normalizeRequirementInput(map[id]);
    entries.set(id, { description: normalized.description, features: normalized.features, tests: [] });
  }

  tests.forEach((test, i) => {
    const markerId = `test-${i + 1}`;
    for (const requirement of test.requirements) {
      if (!entries.has(requirement.id)) {
        entries.set(requirement.id, { description: requirement.description, features: requirement.features, tests: [] });
      }
      entries.get(requirement.id)!.tests.push({ title: test.title, status: test.status, testId: test.testId, markerId });
    }
  });

  const requirementFeatures = new Map(Array.from(entries, ([id, entry]) => [id, entry.features]));
  const ids = computeRequirementOrder(entries.keys(), requirementFeatures, about);
  if (ids.length === 0) return '';

  const maxDigits = estimateMaxPageDigits(tests, Object.keys(about ?? {}).length);

  const rows = ids.map((id) => {
    const entry = entries.get(id)!;
    const status = computeRollupStatus(entry.tests);
    const testList = entry.tests.length
      ? entry.tests.map((test) => {
          const title = escape(upperFirst(test.title));
          const label = test.testId
            ? `<span class="id-tag">${escape(test.testId)}</span> — ${title}`
            : title;
          // Reuses the badge-* color classes (no border/padding) for a lightweight inline status.
          const statusText = `<span class="badge-${test.status}">(${test.status.toUpperCase()})</span>`;
          return `${label} ${statusText}${pageReference(test.markerId, pageNumbers, maxDigits)}`;
        }).join('<br/>')
      : '<span style="color:#a01010;">No test covers this requirement</span>';

    // Skips a feature id with no `about` entry rather than a broken link.
    // Inline with the description, not a separate block, so a requirement
    // with features stays as compact as one without.
    const featureLinks = about
      ? entry.features
          .filter((featureId) => about[featureId])
          .map((featureId) => `<a href="#about-${featureId}">${escape(about[featureId].title)}</a>${pageReference(`about-${featureId}`, pageNumbers, maxDigits)}`)
          .join(', ')
      : '';
    const featureSuffix = featureLinks
      ? ` <span style="color:#888;font-size:11px;">— ${featureLinks}</span>`
      : '';

    // Two real <tr>s, not stacked divs, so "Proven by" lines up with the
    // table's own row height rather than a guessed margin. Padding is split
    // across the seam (bottom on row 1, top on row 2) to avoid doubling the gap.
    return `
      <tbody class="requirement-group" id="requirement-${id}">
        <tr>
          <td class="id-tag" style="border-bottom:none;padding-bottom:2px;">${pageMarker(`requirement-${id}`, pageNumbers)}${escape(id)}</td>
          <td style="border-bottom:none;padding-bottom:2px;">
            <div class="detail-value">${escape(upperFirst(entry.description))}${featureSuffix}</div>
          </td>
          <td class="col-status" rowspan="2">${badge(status.toUpperCase(), status)}</td>
        </tr>
        <tr>
          <td class="detail-label" style="padding-top:2px;">Proven by</td>
          <td style="padding-top:2px;"><div style="font-size:12px;">${testList}</div></td>
        </tr>
      </tbody>`;
  }).join('\n');

  return `
    <div class="section traceability" id="requirements-matrix" style="page-break-after:always;">
      ${pageMarker('requirements-matrix', pageNumbers)}
      <div class="section-header">
        <h2>Requirements Traceability Matrix</h2>
      </div>
      <table class="data-table">
        <thead><tr><th>Requirement</th><th>Description &amp; Covering Tests</th><th>Result</th></tr></thead>
        ${rows}
      </table>
    </div>`;
}

/**
 * Renders the About section: one entry per `about` feature, in authored
 * order (deliberate prose ordering, not re-sorted), each with a status
 * rolled up from every test whose requirements list that feature. Each
 * feature also lists (and links to) the requirements pointing to it — the
 * inverse of the Matrix's requirement -> feature link, so a reader isn't
 * stuck scanning the whole Matrix to find a feature's requirements.
 *
 * All features share one section rather than a page each, since feature
 * bodies are short prose. There's no standalone "About" heading — the Table
 * of Contents links straight to the first feature, same as it does for the
 * first test. Empty string when `about` is unset or empty.
 */
export function renderAboutSection(
  about: Record<string, AboutFeature> | undefined,
  requirementsMap: Record<string, string | RequirementInput> | undefined,
  tests: TestRecord[],
  pageNumbers: PageNumbers,
): string {
  if (!about) return '';
  const featureIds = Object.keys(about);
  if (featureIds.length === 0) return '';

  const map = requirementsMap ?? {};
  const maxDigits = estimateMaxPageDigits(tests, featureIds.length);

  const features = featureIds.map((featureId) => {
    const feature = about[featureId];
    const coveringTests = tests.filter((test) =>
      test.requirements.some((requirement) => requirement.features.includes(featureId)),
    );
    const status = computeRollupStatus(coveringTests);

    const matchingRequirementIds = Object.keys(map)
      .filter((id) => normalizeRequirementInput(map[id]).features.includes(featureId))
      .sort(compareNaturalIds);

    const requirementsList = matchingRequirementIds.length
      ? `<ul style="margin:0 0 16px 20px;font-size:13px;">${matchingRequirementIds.map((id) => {
          const description = escape(upperFirst(normalizeRequirementInput(map[id]).description));
          return `<li><span class="id-tag"><a href="#requirement-${id}">${escape(id)}</a></span> — ${description}${pageReference(`requirement-${id}`, pageNumbers, maxDigits)}</li>`;
        }).join('')}</ul>`
      : '<p style="color:#a01010;font-size:13px;margin:0 0 16px;">No requirements are tied to this feature yet.</p>';

    return `
      <div id="about-${featureId}" style="margin-bottom:32px;">
        ${pageMarker(`about-${featureId}`, pageNumbers)}
        <div class="section-header">
          <h2>${escape(feature.title)}</h2>
          ${badge(status.toUpperCase(), status)}
        </div>
        ${renderMarkdown(feature.body)}
        <div class="detail-label">Requirements</div>
        ${requirementsList}
      </div>`;
  }).join('\n');

  return `
    <div class="section" id="about" style="page-break-after:always;">
      ${features}
    </div>`;
}

/**
 * Renders the full evidence report as a self-contained HTML string.
 *
 * @param title            - Report title (shown in cover and <title>)
 * @param tests            - Ordered list of test records to include
 * @param startTime        - When the test run began, shown in the cover
 * @param requirementsMap  - Optional requirement ID -> description map. When
 *                           set, a Requirements Traceability Matrix section is
 *                           rendered after the Table of Contents.
 * @param about            - Optional feature ID -> title/body map. When set,
 *                           an About section is rendered between the cover and
 *                           the Table of Contents, one entry per feature.
 * @param overview         - Optional Markdown description of the application
 *                           as a whole, rendered on the cover page itself,
 *                           between the run date and the pass/fail summary.
 * @param pageNumbers      - See `PageNumbers`. Omit for HTML mode (no page
 *                           numbers); `'reserve'` for print pass 1;
 *                           the resolved marker -> page map for print pass 2.
 */
export function renderReport(
  title: string,
  tests: TestRecord[],
  startTime: Date,
  requirementsMap?: Record<string, string | RequirementInput>,
  about?: Record<string, AboutFeature>,
  overview?: string,
  pageNumbers?: PageNumbers,
): string {
  // Sorted once, in feature -> requirement -> test-id order (see
  // `compareTestOrder`), and reused below for the matrix, index, and
  // sections, so a Test Case Index row always matches its section's
  // position. `renderTraceabilityMatrix` ranks its own (possibly larger)
  // requirement set the same way, via `computeRequirementOrder`.
  const requirementFeatures = collectRequirementFeatures(tests, requirementsMap);
  const requirementRank = new Map(
    computeRequirementOrder(requirementFeatures.keys(), requirementFeatures, about).map((id, index) => [id, index]),
  );
  const orderedTests = [...tests].sort((a, b) => compareTestOrder(a, b, requirementRank));

  const passed = orderedTests.filter((t) => t.status === 'pass' || t.status === 'flaky').length;
  const failed = orderedTests.filter((t) => t.status === 'fail').length;
  const total = orderedTests.length;
  // A flaky test did pass, but only after a retry — that's not the same
  // guarantee as a clean run, so it isn't allowed to read as an unqualified
  // PASS overall. FAIL still takes priority over flaky.
  const overallStatus: 'PASS' | 'FAIL' | 'FLAKY' =
    failed > 0 ? 'FAIL' : orderedTests.some((t) => t.status === 'flaky') ? 'FLAKY' : 'PASS';

  const aboutSection = renderAboutSection(about, requirementsMap, orderedTests, pageNumbers);
  const firstAboutFeatureId = about ? (Object.keys(about)[0] ?? null) : null;
  const matrix = renderTraceabilityMatrix(orderedTests, requirementsMap, about, pageNumbers);
  const index = renderTestCaseIndex(orderedTests, pageNumbers);
  const tableOfContents = renderTableOfContents(matrix !== '', orderedTests.length > 0, firstAboutFeatureId, pageNumbers);
  const testSections = orderedTests
    .map((t, i) => renderTest(t, i + 1, pageNumbers))
    .join('\n');
  const overviewBlock = overview ? `<div class="overview">${renderMarkdown(overview)}</div>` : '';

  return htmlDocument(title, `
  <div class="cover">
    <h1>${escape(title)}</h1>
    <p class="meta">Generated: ${runDate(startTime)}</p>
    ${overviewBlock}
    <div class="summary-box overall-${overallStatus.toLowerCase()}">
      <div class="overall ${overallStatus === 'PASS' ? 'pass-text' : overallStatus === 'FLAKY' ? 'flaky-text' : 'fail-text'}">${overallStatus}</div>
      <div>${passed} of ${total} test${total !== 1 ? 's' : ''} passed</div>
    </div>
  </div>
  <div class="body">
    ${tableOfContents}
    ${aboutSection}
    ${matrix}
    ${index}
    ${testSections}
  </div>
`);
}
