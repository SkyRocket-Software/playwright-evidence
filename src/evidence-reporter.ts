import type {
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import fs from 'fs';
import { escape, uniq } from 'lodash-es';
import os from 'os';
import path from 'path';
import { normalizeRequirementInput, renderReport } from './html.ts';
import type { AboutFeature, RequirementInput, RequirementRecord, StepRecord, TestRecord } from './html.ts';

/**
 * Formats a UTC date as a filesystem-safe, sortable timestamp (YYYYMMDD-HHmmssZ)
 * for output filenames. UTC avoids a DST transition producing the same
 * wall-clock time twice; the trailing `Z` marks it as UTC.
 */
export function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const datePart = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const timePart = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `${datePart}-${timePart}Z`;
}

/** Short random suffix so filenames stay unique even when two runs resolve within the same second (e.g. parallel CI shards). */
function randomSuffix(): string {
  return Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
}

/** Inserts a suffix before the extension of a file path, e.g. 'report.pdf' -> 'report-20260724-143005-a1b2c3.pdf'. */
function insertSuffix(filePath: string, suffix: string): string {
  const ext = path.extname(filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, ext);
  return path.join(dir, `${base}-${suffix}${ext}`);
}

interface EvidenceReporterOptions {
  /**
   * Output mode.
   * - 'html': self-contained HTML with screenshots embedded as base64 (default)
   * - 'pdf': screenshots written to a sidecar directory, PDF generated, then
   *          the HTML and sidecar directory are deleted. Only the PDF is kept.
   */
  output?: 'html' | 'pdf';
  /**
   * Output filename. Default: evidence-report.html (html mode) or evidence-report.pdf (pdf mode).
   * A run timestamp plus a short random suffix is always appended before the extension,
   * e.g. `file: 'report.pdf'` produces `report-20260724-143005-a1b2c3.pdf`, so repeated
   * runs — including ones that start within the same second — never overwrite each other.
   */
  file?: string;
  /**
   * When true, skips the timestamp and random suffix and always writes to the
   * exact `file` path (or the default 'evidence-report.<ext>') — each run
   * overwrites the last, giving a stable "latest" path instead of a unique
   * one per run. Default: false.
   */
  latest?: boolean;
  /** Report heading. Default: Test Evidence Report */
  title?: string;
  /**
   * Maps a functional requirement ID (matched against each test's tags, with any
   * leading "@" stripped — e.g. a test tagged `@FR-CHANNEL-1` matches the key
   * `'FR-CHANNEL-1'`) to that requirement's prose description — or, to also
   * declare which `about` feature(s) it supports, a `{ description, features }`
   * object instead of a bare string. When provided:
   * - Each test's section in the report lists the requirement(s) it proves, with
   *   their full text, so the report is readable without a separate requirements
   *   document open alongside it.
   * - A Requirements Traceability Matrix section is added, listing every
   *   requirement in this map (plus any requirement referenced by a test's tags
   *   but missing from the map), which test(s) cover it, a rolled-up
   *   pass/fail/skipped/flaky/missed status per requirement, and — when `about`
   *   is also set — which feature(s) it supports, linked to their About entry.
   * Default: undefined (no requirements list or matrix is rendered).
   */
  requirements?: Record<string, string | RequirementInput>;
  /**
   * Maps a feature ID to its title and Markdown body. When provided, renders
   * an About section between the cover and the Table of Contents — one entry
   * per feature, in the order given here, each with a rolled-up status badge
   * (pass/fail/skipped/flaky/missed) aggregated from every test whose matched
   * requirements list that feature ID in their `features` array. A feature
   * with no requirements pointing to it (or none of those covered yet) renders
   * missed, the same way an uncovered requirement does in the Traceability
   * Matrix. Default: undefined (no About section is rendered).
   *
   * @deprecated Use `features` instead — kept for backward compatibility.
   * Ignored when `features` is also set.
   */
  about?: Record<string, AboutFeature>;
  /**
   * Same shape and behavior as `about`. Takes precedence over `about` when
   * both are set. Named to match the `features` field `about.json` (see
   * `src/generate.ts`) is generated with.
   */
  features?: Record<string, AboutFeature>;
  /**
   * Markdown description of the application as a whole, rendered on the cover
   * page itself (between the run date and the pass/fail summary) — distinct
   * from `about`/`features`, which describe individual features one page
   * each. Same rendering as a feature body: raw HTML in the source is
   * escaped, not passed through. Default: undefined (no overview is rendered).
   */
  overview?: string;
  /**
   * Organization or product name shown on the left of the PDF page footer
   * (right side shows "Page X of Y"). PDF mode only — HTML mode has no
   * footer. Default: undefined (nothing is shown on the left).
   */
  footer?: string;
}

/**
 * Playwright reporter that produces an evidence report.
 *
 * In 'html' mode (default): a single self-contained HTML file with all screenshots
 * embedded as base64.
 *
 * In 'pdf' mode: screenshots are written to a sidecar directory during the run
 * (avoiding large in-memory base64 blobs), the HTML is rendered referencing those
 * files, a PDF is generated from the HTML, then the HTML and sidecar directory are
 * deleted. Only the PDF is kept.
 *
 * Configure via reporter options in playwright.config.ts:
 *   reporter: [['@skyrocket-software/playwright-evidence/reporter', { output: 'pdf', file: 'report.pdf', title: 'My Report' }]]
 */
export default class EvidenceReporter implements Reporter {
  /**
   * Keyed by TestCase, not a push-only array — onTestEnd fires once per retry
   * attempt with the same TestCase reference, so keying on it lets a later
   * retry replace the earlier attempt instead of duplicating a section, while
   * Map preserves insertion order for rendering.
   */
  private testRecords = new Map<TestCase, TestRecord>();
  private startTime!: Date;
  private runId: string = randomSuffix();
  private options: EvidenceReporterOptions;
  private screenshotDir: string = '';
  private screenshotCount: number = 0;

  constructor(options: EvidenceReporterOptions = {}) {
    this.options = options;
  }

  private get tests(): TestRecord[] {
    return Array.from(this.testRecords.values());
  }

  /** `features` takes precedence over the deprecated `about` alias when both are set. */
  private get features(): Record<string, AboutFeature> | undefined {
    return this.options.features ?? this.options.about;
  }

  onBegin(_config: unknown, _suite: Suite): void {
    this.startTime = new Date();

    if (this.options.output === 'pdf') {
      this.screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-screenshots-'));
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const steps: StepRecord[] = [];

    const attachments = result.attachments.filter(
      (a) => a.contentType === 'image/png' && (a.body || a.path),
    );

    for (const step of result.steps) {
      if (step.category === 'test.step') {
        this.collectStep(step, attachments, steps);
      }
    }

    const status = this.deriveStatus(result);

    const error =
      result.errors.length > 0
        ? result.errors.map((e) => e.message ?? '').join('\n')
        : null;

    const requirements = this.deriveRequirements(test);
    const testId = this.deriveTestId(test);
    const describeTitle = this.deriveDescribeTitle(test);

    this.testRecords.set(test, { title: test.title, status, steps, error, requirements, testId, describeTitle });
  }

  /**
   * Maps a single attempt's result to this report's status vocabulary. A test
   * that only passed on retry (`result.retry > 0`) reports as 'flaky', not a
   * plain 'pass', so a reviewer can tell a clean pass from one that needed a
   * second attempt.
   */
  private deriveStatus(result: TestResult): TestRecord['status'] {
    if (result.status === 'skipped') return 'skipped';
    if (result.status !== 'passed') return 'fail';
    return result.retry > 0 ? 'flaky' : 'pass';
  }

  /**
   * Matches this test's tags (leading "@" stripped) against the `requirements`
   * map, keeping only tags with a known entry, deduped.
   */
  private deriveRequirements(test: TestCase): RequirementRecord[] {
    const map = this.options.requirements ?? {};
    const ids = uniq(test.tags.map((tag) => (tag.startsWith('@') ? tag.slice(1) : tag)).filter((id) => map[id]));
    return ids.map((id) => ({ id, ...normalizeRequirementInput(map[id]) }));
  }

  /**
   * Reads a test's stable id from a `type: 'test-id'` annotation, not a tag —
   * tags are reserved for `--grep` and requirement matching. Null if absent.
   */
  private deriveTestId(test: TestCase): string | null {
    const annotation = test.annotations.find((a) => a.type === 'test-id');
    return annotation?.description ?? null;
  }

  /**
   * Joins the titles of enclosing `test.describe(...)` suites, outermost
   * first. Stops at the first non-'describe' suite, which naturally excludes
   * the file/project/root suites. Null if there's no enclosing describe block.
   */
  private deriveDescribeTitle(test: TestCase): string | null {
    const titles: string[] = [];
    let suite: Suite | undefined = test.parent;
    while (suite && suite.type === 'describe') {
      titles.unshift(suite.title);
      suite = suite.parent;
    }
    return titles.length > 0 ? titles.join(' › ') : null;
  }

  private collectStep(
    step: TestStep,
    attachments: TestResult['attachments'],
    out: StepRecord[],
  ): void {
    const status = step.error ? 'fail' : 'pass';

    // Consumes the matched attachment so two steps sharing a title (e.g. a
    // loop) pair with successive attachments in order, instead of both
    // grabbing the first.
    const matchIndex = attachments.findIndex((a) => a.name === step.title);
    const match = matchIndex === -1 ? undefined : attachments.splice(matchIndex, 1)[0];
    let screenshotBase64: string | null = null;
    let screenshotPath: string | null = null;
    let screenshotLabel: string | null = null;

    if (match) {
      const buf = match.body ?? (match.path ? fs.readFileSync(match.path) : null);
      if (buf) {
        screenshotLabel = match.name;

        if (this.options.output === 'pdf') {
          // Write to sidecar dir — never accumulate base64 in memory
          const filename = `screenshot-${++this.screenshotCount}.png`;
          fs.writeFileSync(path.join(this.screenshotDir, filename), buf);
          screenshotPath = path.join(this.screenshotDir, filename);
        } else {
          screenshotBase64 = buf.toString('base64');
        }
      }
    }

    out.push({ title: step.title, status, screenshotBase64, screenshotPath, screenshotLabel });

    for (const child of step.steps ?? []) {
      if (child.category === 'test.step') {
        this.collectStep(child, attachments, out);
      }
    }
  }

  async onEnd(_result: FullResult): Promise<void> {
    const title = this.options.title ?? 'Test Evidence Report';

    if (this.options.output === 'pdf') {
      await this.generatePdf(title, this.options.footer);
    } else {
      this.generateHtml(title);
    }
  }

  private generateHtml(title: string): void {
    const html = renderReport(title, this.tests, this.startTime, this.options.requirements, this.features, this.options.overview);
    const outPath = this.resolveOutFile('html');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`\nEvidence report written to: ${outPath}`);
  }

  /**
   * Renders HTML with sidecar screenshot paths, prints to PDF via headless
   * Chromium, then deletes the temp directory. Only the PDF reaches the
   * output dir.
   *
   * Real page numbers aren't knowable until Chromium paginates once, so this
   * prints twice: pass 1 with placeholder reservations and invisible
   * `[[page:ID]]` markers (resolved via pdfjs-dist), pass 2 with those
   * numbers substituted into the same reserved space so layout doesn't shift.
   * Both passes share one browser launch.
   */
  private async generatePdf(title: string, footer: string | undefined): Promise<void> {
    const pdfPath = this.resolveOutFile('pdf');

    // Dynamic import keeps startup fast when PDF is not requested,
    // and avoids a hard import that would fail if playwright is absent.
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch();
    try {
      const draftHtml = renderReport(title, this.tests, this.startTime, this.options.requirements, this.features, this.options.overview, 'reserve');
      const draftHtmlPath = path.join(this.screenshotDir, 'report-draft.html');
      fs.writeFileSync(draftHtmlPath, draftHtml, 'utf8');
      const draftPdfPath = path.join(this.screenshotDir, 'report-draft.pdf');
      await this.printPdf(browser, draftHtmlPath, draftPdfPath, title, footer, this.startTime);

      const pageNumbers = await this.resolvePageNumbers(draftPdfPath);

      const finalHtml = renderReport(title, this.tests, this.startTime, this.options.requirements, this.features, this.options.overview, pageNumbers);
      const finalHtmlPath = path.join(this.screenshotDir, 'report.html');
      fs.writeFileSync(finalHtmlPath, finalHtml, 'utf8');
      await this.printPdf(browser, finalHtmlPath, pdfPath, title, footer, this.startTime);
    } finally {
      await browser.close();
    }

    // Remove the entire temp directory — both HTML passes, the draft PDF, and screenshots are transient
    fs.rmSync(this.screenshotDir, { recursive: true });

    console.log(`Evidence PDF written to: ${pdfPath}`);
  }

  /**
   * Reads the draft PDF with pdfjs-dist and maps each invisible
   * `[[page:ID]]` marker (see `pageMarker` in html.ts) to its 1-based page
   * number. A marker not found is simply absent — callers render nothing
   * rather than a wrong number.
   */
  private async resolvePageNumbers(pdfPath: string): Promise<Map<string, number>> {
    // Dynamic import keeps startup fast in html mode, where it's never used.
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = getDocument({ data: pdfBytes });
    const pageNumbers = new Map<string, number>();

    try {
      const document = await loadingTask.promise;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join('');

        for (const match of pageText.matchAll(/\[\[page:([^\]]+)\]\]/g)) {
          if (!pageNumbers.has(match[1])) {
            pageNumbers.set(match[1], pageNumber);
          }
        }
      }
    } finally {
      await loadingTask.destroy();
    }

    return pageNumbers;
  }

  /**
   * Prints an HTML file to PDF in a fresh page of an already-launched browser.
   * Uses the file:// protocol so no local server is needed — safe for CI.
   *
   * @param browser   - Browser shared across both print passes (see generatePdf)
   * @param htmlPath  - Absolute path to the HTML file to print
   * @param pdfPath   - Absolute path for the PDF output
   * @param title     - Report title shown in the PDF page header
   * @param footer    - Organization/product name shown on the left of the PDF page footer; omitted when undefined
   * @param startTime - Run date shown in the PDF page header
   */
  private async printPdf(
    browser: import('playwright-core').Browser,
    htmlPath: string,
    pdfPath: string,
    title: string,
    footer: string | undefined,
    startTime: Date,
  ): Promise<void> {
    // UTC so this always agrees with the UTC timestamp in the output filename,
    // regardless of the local timezone of the machine generating the PDF.
    const dateStr = `${startTime.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })} UTC`;

    // Chromium renders header/footer templates in an isolated context — inline
    // styles only, font-size must be set explicitly (default is 0 = invisible).
    const headerTemplate = `
      <div style="width:100%;padding:0 15mm;display:flex;justify-content:space-between;
                  align-items:center;font-family:Georgia,serif;font-size:9px;color:#555;
                  border-bottom:1px solid #ddd;">
        <span>${escape(title)}</span>
        <span>${escape(dateStr)}</span>
      </div>`;

    // The left span stays in the template even when empty so space-between
    // keeps the page number right-aligned.
    const footerLabel = footer ? escape(footer) : '';
    const footerTemplate = `
      <div style="width:100%;padding:0 15mm;display:flex;justify-content:space-between;
                  align-items:center;font-family:Georgia,serif;font-size:9px;color:#555;
                  border-top:1px solid #ddd;">
        <span>${footerLabel}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`;

    const page = await browser.newPage();
    // 'networkidle' is generally discouraged for real websites (some pages
    // never go quiet), but this is a closed, self-contained local file with
    // no ongoing network activity, so it settles reliably here.
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      // Margins must be large enough to accommodate the header/footer bands.
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });
  }

  /**
   * Resolves the output path, honouring `file` (default `evidence-report.<ext>`).
   * Unless `latest` is set, appends a run timestamp + random suffix so
   * concurrent runs never overwrite each other.
   */
  private resolveOutFile(ext: 'html' | 'pdf'): string {
    const rawFile = this.options.file ?? `evidence-report.${ext}`;

    if (this.options.latest) {
      return path.resolve(rawFile);
    }

    return path.resolve(insertSuffix(rawFile, `${formatTimestamp(this.startTime)}-${this.runId}`));
  }
}
