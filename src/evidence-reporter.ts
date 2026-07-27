import type {
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { escapeHtml, renderReport } from './html.ts';
import type { RequirementRecord, StepRecord, TestRecord } from './html.ts';

/**
 * Formats a date (in UTC) as a filesystem-safe, sortable timestamp (YYYYMMDD-HHmmssZ)
 * for use in output filenames. Uses UTC rather than local time so a DST transition
 * can't produce the same wall-clock time twice for two genuinely different instants.
 * The trailing `Z` marks the timestamp as UTC so it isn't misread as local time.
 */
export function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const datePart = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const timePart = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `${datePart}-${timePart}Z`;
}

/**
 * Short random suffix so filenames stay unique even when two runs resolve their
 * output path within the same second (e.g. parallel CI shards) — the timestamp
 * alone only has one-second resolution and can't disambiguate those on its own.
 */
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
   * `'FR-CHANNEL-1'`) to that requirement's prose description. When provided:
   * - Each test's section in the report lists the requirement(s) it proves, with
   *   their full text, so the report is readable without a separate requirements
   *   document open alongside it.
   * - A Requirements Traceability Matrix section is added, listing every
   *   requirement in this map (plus any requirement referenced by a test's tags
   *   but missing from the map), which test(s) cover it, and a rolled-up
   *   pass/fail/skipped/missed status per requirement.
   * Default: undefined (no requirements list or matrix is rendered).
   */
  requirements?: Record<string, string>;
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
  private tests: TestRecord[] = [];
  private startTime!: Date;
  private runId: string = randomSuffix();
  private options: EvidenceReporterOptions;
  private screenshotDir: string = '';
  private screenshotCount: number = 0;

  constructor(options: EvidenceReporterOptions = {}) {
    this.options = options;
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

    const status =
      result.status === 'passed'
        ? 'pass'
        : result.status === 'skipped'
          ? 'skipped'
          : 'fail';

    const error =
      result.errors.length > 0
        ? result.errors.map((e) => e.message ?? '').join('\n')
        : null;

    const requirements = this.deriveRequirements(test);

    this.tests.push({ title: test.title, status, steps, error, requirements });
  }

  /**
   * Matches this test's tags (with any leading "@" stripped) against the
   * `requirements` option map, returning the subset that has a known
   * requirement description. Tags with no matching map entry are ignored —
   * not every tag is necessarily a requirement ID. A duplicated tag (e.g. a
   * copy-paste mistake) yields one entry, not a repeated one.
   */
  private deriveRequirements(test: TestCase): RequirementRecord[] {
    const map = this.options.requirements ?? {};
    const seenIds = new Set<string>();
    const result: RequirementRecord[] = [];

    for (const tag of test.tags) {
      const id = tag.startsWith('@') ? tag.slice(1) : tag;
      if (map[id] && !seenIds.has(id)) {
        seenIds.add(id);
        result.push({ id, description: map[id] });
      }
    }

    return result;
  }

  private collectStep(
    step: TestStep,
    attachments: TestResult['attachments'],
    out: StepRecord[],
  ): void {
    const status = step.error ? 'fail' : 'pass';

    const match = attachments.find((a) => a.name === step.title);
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
      await this.generatePdf(title);
    } else {
      this.generateHtml(title);
    }
  }

  private generateHtml(title: string): void {
    const html = renderReport(title, this.tests, this.startTime, this.options.requirements);
    const outPath = this.resolveOutFile('html');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`\nEvidence report written to: ${outPath}`);
  }

  /**
   * PDF mode: renders HTML with sidecar screenshot references into the temp
   * directory, prints to PDF via headless Chromium, then removes the entire
   * temp directory (HTML + screenshots). Only the PDF is written to the output dir.
   */
  private async generatePdf(title: string): Promise<void> {
    const html = renderReport(title, this.tests, this.startTime, this.options.requirements);
    const htmlPath = path.join(this.screenshotDir, 'report.html');
    fs.writeFileSync(htmlPath, html, 'utf8');

    const pdfPath = this.resolveOutFile('pdf');
    await this.writePdf(htmlPath, pdfPath, title, this.startTime);

    // Remove the entire temp directory — HTML and screenshots are transient
    fs.rmSync(this.screenshotDir, { recursive: true });

    console.log(`Evidence PDF written to: ${pdfPath}`);
  }

  /**
   * Prints an HTML file to PDF using a headless Chromium browser.
   * Uses the file:// protocol so no local server is needed — safe for CI.
   *
   * @param htmlPath  - Absolute path to the HTML file to print
   * @param pdfPath   - Absolute path for the PDF output
   * @param title     - Report title shown in the PDF page header
   * @param startTime - Run date shown in the PDF page header
   */
  private async writePdf(
    htmlPath: string,
    pdfPath: string,
    title: string,
    startTime: Date,
  ): Promise<void> {
    // Dynamic import keeps startup fast when PDF is not requested,
    // and avoids a hard import that would fail if playwright is absent.
    const { chromium } = await import('playwright-core');

    // UTC so this always agrees with the UTC timestamp in the output filename,
    // regardless of the local timezone of the machine generating the PDF.
    const dateStr = `${startTime.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })} UTC`;

    // Chromium renders header/footer templates in an isolated context — inline
    // styles only, font-size must be set explicitly (default is 0 = invisible).
    const headerTemplate = `
      <div style="width:100%;padding:0 15mm;display:flex;justify-content:space-between;
                  align-items:center;font-family:Georgia,serif;font-size:9px;color:#555;
                  border-bottom:1px solid #ddd;">
        <span>${escapeHtml(title)}</span>
        <span>${escapeHtml(dateStr)}</span>
      </div>`;

    const footerTemplate = `
      <div style="width:100%;padding:0 15mm;display:flex;justify-content:space-between;
                  align-items:center;font-family:Georgia,serif;font-size:9px;color:#555;
                  border-top:1px solid #ddd;">
        <span>Skyrocket Software</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`;

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
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
    } finally {
      await browser.close();
    }
  }

  /**
   * Resolves the output file path for a given extension, honouring the `file`
   * option (defaulting to 'evidence-report.<ext>'). Unless `latest` is set,
   * always appends a run timestamp plus a random suffix before the extension
   * so repeated runs — even concurrent ones started within the same second —
   * don't overwrite each other.
   */
  private resolveOutFile(ext: 'html' | 'pdf'): string {
    const rawFile = this.options.file ?? `evidence-report.${ext}`;

    if (this.options.latest) {
      return path.resolve(rawFile);
    }

    return path.resolve(insertSuffix(rawFile, `${formatTimestamp(this.startTime)}-${this.runId}`));
  }
}
