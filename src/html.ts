/**
 * Shared HTML primitives and report-rendering functions for evidence reports.
 */

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

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Uppercases only the first character — sentence case, not "Title Case" (that's
 * what CSS `text-transform: capitalize` does, which is a different thing
 * despite the similar name). Test titles and requirement descriptions are
 * typically authored lowercase-first (idiomatic for Playwright test names),
 * but should read as proper sentences in a report. Must run before
 * `escapeHtml` — capitalizing after escaping would corrupt an entity like
 * `&amp;` into `&Amp;` if the string happened to start with one.
 */
function capitalizeFirst(str: string): string {
  return str.length === 0 ? str : str.charAt(0).toUpperCase() + str.slice(1);
}

export function badge(text: string, variant: 'pass' | 'fail' | 'skipped' | 'missed' | 'flaky'): string {
  return `<span class="badge badge-${variant}">${text}</span>`;
}

/** Maps a test's status to its badge label and color variant — shared so the Test Case Index and a test's own section heading can't drift apart on what each status looks like. */
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
 * Invisible, zero-height marker embedded at a section's anchor so the first
 * print pass can locate — via pdfjs-dist text extraction on the resulting
 * PDF — which page that anchor landed on. Only rendered in `'reserve'` mode;
 * the final (second-pass) PDF has no use for it once page numbers are
 * resolved, so it's omitted there rather than shipping stray searchable text
 * in the delivered report.
 */
function pageMarker(markerId: string, pageNumbers: PageNumbers): string {
  if (pageNumbers !== 'reserve') return '';
  return `<div class="page-marker">[[page:${markerId}]]</div>`;
}

/**
 * Digits to reserve for a page-number placeholder — a generous upper bound on
 * total page count. Both print passes must reserve the exact same width (see
 * `pageReference`), so this can't be refined using the real page count pass 1
 * discovers; it has to over-estimate up front. Counting only tests would
 * undercount a screenshot-heavy suite, where a single test's evidenceSteps can
 * each force their own page — so this counts every step across every test as a
 * potential extra page, plus a fixed buffer for the cover/contents/matrix/index
 * pages ahead of the first test.
 */
function estimateMaxPageDigits(tests: TestRecord[]): number {
  const totalSteps = tests.reduce((sum, test) => sum + test.steps.length, 0);
  return String(tests.length + totalSteps + 10).length;
}

const PAGE_REF_PREFIX = '— p. ';

/**
 * Renders an inline "— p. N" page reference after a covering-test entry in
 * the Requirements Traceability Matrix, linking to that test's section.
 * Reserves a fixed-width box sized to the worst-case digit count so pass 1
 * (blank placeholder) and pass 2 (real number) wrap identically — otherwise
 * a line that fit before the page number was added could wrap differently
 * once it's filled in, throwing off the very page numbers pass 1 was used to
 * compute.
 *
 * The separating space is a plain sibling character, not part of the span's
 * own content — `display:inline-block` starts a new formatting context, and
 * a leading space *inside* it gets collapsed away like the start of a block,
 * silently swallowing the gap before the em dash.
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
 * Renders a page-number table cell for the Table of Contents / Test Case
 * Index, linking to the referenced section. Unlike `pageReference`, this
 * never needs the fixed-width reservation trick — table cells here sit in a
 * `col-status`-styled column with its own fixed CSS width, so an empty vs.
 * filled cell can't change row height enough to shift pagination between passes.
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
    /*
     * Shared styling for every identifier shown in the report (test-ids,
     * requirement ids) — always secondary to the title next to it and never
     * as bold as a real heading, whether it's a table cell in a listing
     * table or inline/eyebrow text next to a section heading or a
     * covering-test entry. A semibold weight (not the size) gives it enough
     * presence to read clearly without competing with titles/descriptions,
     * which stay plain body weight.
     */
    .id-tag {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      letter-spacing: 0.03em;
      color: #555;
      font-weight: 600;
      white-space: nowrap;
    }

    /*
     * A test's enclosing test.describe(...) title, shown as a kicker line
     * above its heading — restores the "subject" a leaf test title can lose
     * on its own (e.g. "shows the hero heading" reads as a fragment; with
     * this above it, the pairing reads as a complete statement). Plain body
     * font, not monospace like .id-tag — this is authored prose, not an
     * identifier — and sized between the id-tag and the heading it sits under.
     */
    .describe-label {
      font-size: 13px;
      color: #555;
      margin-bottom: 4px;
    }

    /*
     * Page-number markers (see pageMarker() / pageReference()). Deliberately
     * NOT height:0/overflow:hidden — Chromium's print pipeline appears to
     * skip painting (and thus never embeds as extractable PDF text) content
     * that occupies zero visual area, which silently defeats the whole
     * marker mechanism. A sliver of real, non-zero height keeps it painted
     * while staying visually and layout-wise negligible.
     */
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
      /* Tighter than the inherited body line-height (1.6) — at that size the
         extra leading above the first line visually pushes the description
         down relative to the smaller id-tag/badge text sharing its row,
         even though all three are vertical-align:top. */
      line-height: 1.3;
      margin-bottom: 12px;
    }

    /* ── Print ───────────────────────────────────────────── */
    @media print {
      body { font-size: 12px; }
      /* No page-break-after — the master contents page sits right below the
         cover on page 1 (see #table-of-contents override further down). */
      .cover {
        padding: 60px 40px;
      }
      .body { padding: 20px 40px; }

      /*
       * Sections are NOT marked page-break-inside: avoid. A section (a test
       * with several steps and screenshots) is often taller than one printed
       * page — asking the renderer to avoid breaking inside something that
       * can't fit on any single page makes it shove the whole section onto
       * the next page instead, leaving the previous page mostly blank.
       * Breaking is controlled at the step level instead (.step-group below),
       * which is always small enough to keep together.
       *
       * Each section DOES start on a fresh page. Without this, a short
       * section's header/setup rows land at the bottom of one page while its
       * screenshot (kept together as a step-group) gets bumped whole to the
       * next, leaving a wasted gap on both pages. Starting every test at the
       * top of its own page consolidates any leftover space into one place
       * per test instead of splitting it across two.
       */
      .section { page-break-before: always; }
      /* Overrides the rule above (id selectors beat class selectors) — the
         master contents page stays on page 1 with the cover instead of
         forcing its own page. */
      #table-of-contents { page-break-before: auto; }
      .section-header { page-break-after: avoid; }
      /* Each section now anchors a full page — a bit more weight than the 18px screen size. */
      .section-header h2 { font-size: 22px; }
      .step-group { page-break-inside: avoid; }
      .screenshot-row { page-break-inside: avoid; }
      /* Each requirement spans two real <tr>s (see .requirement-group below) —
         keep both together, the same way .step-group keeps a step's label and
         screenshot together, rather than letting them split across a page. */
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
  <title>${escapeHtml(title)}</title>
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
 * Renders a single step row (or setup row) as an HTML table row-group.
 * Setup steps (no screenshot) are rendered muted. Evidence steps include a screenshot row.
 *
 * Each step is wrapped in its own `<tbody class="step-group">` rather than
 * sharing one `<tbody>` for the whole test. That gives the print renderer a
 * small, always-fits-on-one-page unit to apply `page-break-inside: avoid` to,
 * keeping a step's label and its screenshot together without forcing the
 * entire (possibly multi-page) test section to avoid breaking too.
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
          <td><em>${escapeHtml(step.title)}</em></td>
          <td class="col-status" style="font-size:11px;color:#888;">setup</td>
        </tr>
      </tbody>`;
  }

  const screenshotRow = `<tr class="screenshot-row">
          <td colspan="3">
            <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(step.screenshotLabel ?? step.title)}" />
            <p class="screenshot-caption">Screenshot: ${escapeHtml(step.screenshotLabel ?? step.title)}</p>
          </td>
        </tr>`;

  return `
      <tbody class="step-group">
        <tr>
          <td class="col-num">${index}</td>
          <td>${escapeHtml(step.title)}</td>
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
    .map((requirement) => `<li><span class="id-tag">${escapeHtml(requirement.id)}</span> — ${escapeHtml(capitalizeFirst(requirement.description))}</li>`)
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
    ? `<div class="error-block">${escapeHtml(stripAnsi(test.error))}</div>`
    : '';

  const requirementsBlock = renderRequirementsList(test.requirements);

  const testIdEyebrow = test.testId
    ? `<div class="id-tag" style="margin-bottom:4px;">${escapeHtml(test.testId)}</div>`
    : '';

  const describeEyebrow = test.describeTitle
    ? `<div class="describe-label">${escapeHtml(capitalizeFirst(test.describeTitle))}</div>`
    : '';

  return `
    <div class="section" id="test-${index}">
      ${pageMarker(`test-${index}`, pageNumbers)}
      ${testIdEyebrow}
      ${describeEyebrow}
      <div class="section-header">
        <h2>${escapeHtml(capitalizeFirst(test.title))}</h2>
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
 * Renders the Test Case Index: every test with its stable test-id (from a
 * `type: 'test-id'` annotation, when present), title, page number (once
 * resolved, linked), and pass/fail status. Each row links to its section's
 * anchor (`#test-N`) — Chromium preserves same-document links as clickable
 * jumps when printing to PDF — and the page number gives the same lookup to
 * anyone reading a printed copy.
 */
export function renderTestCaseIndex(tests: TestRecord[], pageNumbers: PageNumbers): string {
  if (tests.length === 0) return '';

  const rows = tests.map((test, i) => {
    const num = i + 1;
    const { variant: badgeVariant, text: badgeText } = statusBadge(test.status);
    return `
      <tr>
        <td class="id-tag">${test.testId ? escapeHtml(test.testId) : ''}</td>
        <td><a href="#test-${num}">${escapeHtml(capitalizeFirst(test.title))}</a></td>
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
 * Renders the top-level Table of Contents shown on page 1, right below the
 * cover — linking (and, once resolved, page-numbering) the report's major
 * parts: the Requirements Traceability Matrix, the Test Case Index, and Test
 * Results. There's no standalone "Test Results" section to point to — it's
 * just where the individual test pages begin — so that entry links directly
 * to the first test instead. Returns an empty string when there is nothing
 * to list.
 */
export function renderTableOfContents(
  hasMatrix: boolean,
  hasTests: boolean,
  pageNumbers: PageNumbers,
): string {
  if (!hasMatrix && !hasTests) return '';

  const rows = [
    hasMatrix
      ? `<tr><td><a href="#requirements-matrix">Requirements Traceability Matrix</a></td>${pageCell('requirements-matrix', pageNumbers)}</tr>`
      : '',
    hasTests
      ? `<tr><td><a href="#test-case-index">Test Case Index</a></td>${pageCell('test-case-index', pageNumbers)}</tr>`
      : '',
    hasTests
      ? `<tr><td><a href="#test-1">Test Results</a></td>${pageCell('test-1', pageNumbers)}</tr>`
      : '',
  ].filter((row) => row !== '').join('\n');

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
 * Orders tests for display: those with a `test-id` first, sorted naturally by
 * that id (see `compareNaturalIds`) so the Test Case Index reads top-to-bottom
 * in id order instead of requiring a scan to find one — then any tests with
 * no test-id, left in their original relative order (Array.prototype.sort is
 * stable, so returning 0 for that pair is enough to preserve it).
 */
export function compareTestOrder(a: TestRecord, b: TestRecord): number {
  if (a.testId !== null && b.testId !== null) return compareNaturalIds(a.testId, b.testId);
  if (a.testId !== null) return -1;
  if (b.testId !== null) return 1;
  return 0;
}

/**
 * Rolls up a requirement's status from the tests that cover it: 'missed' when
 * no test covers it, 'fail' if any covering test failed, 'skipped' if every
 * covering test was skipped, 'flaky' if none failed but at least one covering
 * test needed a retry to pass, otherwise a clean 'pass'.
 */
export function computeRequirementStatus(
  coveringTests: Array<{ title: string; status: TestRecord['status'] }>,
): 'pass' | 'fail' | 'skipped' | 'missed' | 'flaky' {
  if (coveringTests.length === 0) return 'missed';
  if (coveringTests.some((test) => test.status === 'fail')) return 'fail';
  if (coveringTests.every((test) => test.status === 'skipped')) return 'skipped';
  if (coveringTests.some((test) => test.status === 'flaky')) return 'flaky';
  return 'pass';
}

/**
 * Renders the Requirements Traceability Matrix section: every requirement from
 * `requirementsMap` plus any requirement referenced only by a test's tags,
 * its description, which test(s) cover it — each with its test-id (when
 * present) and a page reference (once resolved) so a reader can go straight
 * to that test without hunting through the Test Case Index — and a rolled-up
 * status. Returns an empty string when there are no requirements to list.
 */
export function renderTraceabilityMatrix(
  tests: TestRecord[],
  requirementsMap: Record<string, string> | undefined,
  pageNumbers: PageNumbers,
): string {
  const map = requirementsMap ?? {};
  const entries = new Map<string, {
    description: string;
    tests: Array<{ title: string; status: TestRecord['status']; testId: string | null; markerId: string }>;
  }>();

  for (const id of Object.keys(map)) {
    entries.set(id, { description: map[id], tests: [] });
  }

  tests.forEach((test, i) => {
    const markerId = `test-${i + 1}`;
    for (const requirement of test.requirements) {
      if (!entries.has(requirement.id)) {
        entries.set(requirement.id, { description: requirement.description, tests: [] });
      }
      entries.get(requirement.id)!.tests.push({ title: test.title, status: test.status, testId: test.testId, markerId });
    }
  });

  const ids = Array.from(entries.keys()).sort(compareNaturalIds);
  if (ids.length === 0) return '';

  const maxDigits = estimateMaxPageDigits(tests);

  const rows = ids.map((id) => {
    const entry = entries.get(id)!;
    const status = computeRequirementStatus(entry.tests);
    const testList = entry.tests.length
      ? entry.tests.map((test) => {
          const title = escapeHtml(capitalizeFirst(test.title));
          const label = test.testId
            ? `<span class="id-tag">${escapeHtml(test.testId)}</span> — ${title}`
            : title;
          // Reuses the badge-pass/badge-fail/badge-skipped color classes (they set only
          // color, not the border/padding of the full .badge pill) for a lightweight
          // colored status inline, consistent with every other pass/fail indicator.
          const statusText = `<span class="badge-${test.status}">(${test.status.toUpperCase()})</span>`;
          return `${label} ${statusText}${pageReference(test.markerId, pageNumbers, maxDigits)}`;
        }).join('<br/>')
      : '<span style="color:#a01010;">No test covers this requirement</span>';

    // Two real <tr>s, not one row with stacked divs — "Proven by" and the
    // test list need to share an actual row with the description's own row
    // so their vertical position is governed by the table itself, not a
    // guessed margin that only lines up for single-line descriptions.
    // Each <tr> gets its own top+bottom cell padding from .data-table td, so
    // the seam between the two rows is tightened explicitly (padding-bottom
    // on row 1, padding-top on row 2) — otherwise the gap between the
    // description and "Proven by" doubles up and reads as too much space.
    return `
      <tbody class="requirement-group">
        <tr>
          <td class="id-tag" style="border-bottom:none;padding-bottom:2px;">${escapeHtml(id)}</td>
          <td style="border-bottom:none;padding-bottom:2px;">
            <div class="detail-value">${escapeHtml(capitalizeFirst(entry.description))}</div>
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
 * Renders the full evidence report as a self-contained HTML string.
 *
 * @param title            - Report title (shown in cover and <title>)
 * @param tests            - Ordered list of test records to include
 * @param startTime        - When the test run began, shown in the cover
 * @param requirementsMap  - Optional requirement ID -> description map. When
 *                           set, a Requirements Traceability Matrix section is
 *                           rendered after the Table of Contents.
 * @param pageNumbers      - See `PageNumbers`. Omit for HTML mode (no page
 *                           numbers); `'reserve'` for print pass 1;
 *                           the resolved marker -> page map for print pass 2.
 */
export function renderReport(
  title: string,
  tests: TestRecord[],
  startTime: Date,
  requirementsMap?: Record<string, string>,
  pageNumbers?: PageNumbers,
): string {
  // Sorted once and used for everything below (matrix, index, sections) so a
  // test's Test Case Index row and its actual section land at the same
  // position — id-sorted tests read top-to-bottom by id in both places,
  // rather than the index being reordered while pages stay in run order.
  const orderedTests = [...tests].sort(compareTestOrder);

  const passed = orderedTests.filter((t) => t.status === 'pass' || t.status === 'flaky').length;
  const failed = orderedTests.filter((t) => t.status === 'fail').length;
  const total = orderedTests.length;
  // A flaky test did pass, but only after a retry — that's not the same
  // guarantee as a clean run, so it isn't allowed to read as an unqualified
  // PASS overall. FAIL still takes priority over flaky.
  const overallStatus: 'PASS' | 'FAIL' | 'FLAKY' =
    failed > 0 ? 'FAIL' : orderedTests.some((t) => t.status === 'flaky') ? 'FLAKY' : 'PASS';

  const matrix = renderTraceabilityMatrix(orderedTests, requirementsMap, pageNumbers);
  const index = renderTestCaseIndex(orderedTests, pageNumbers);
  const tableOfContents = renderTableOfContents(matrix !== '', orderedTests.length > 0, pageNumbers);
  const testSections = orderedTests
    .map((t, i) => renderTest(t, i + 1, pageNumbers))
    .join('\n');

  return htmlDocument(title, `
  <div class="cover">
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">Generated: ${runDate(startTime)}</p>
    <div class="summary-box overall-${overallStatus.toLowerCase()}">
      <div class="overall ${overallStatus === 'PASS' ? 'pass-text' : overallStatus === 'FLAKY' ? 'flaky-text' : 'fail-text'}">${overallStatus}</div>
      <div>${passed} of ${total} test${total !== 1 ? 's' : ''} passed</div>
    </div>
  </div>
  <div class="body">
    ${tableOfContents}
    ${matrix}
    ${index}
    ${testSections}
  </div>
`);
}
