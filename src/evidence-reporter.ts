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

interface EvidenceReporterOptions {
  /**
   * Output mode.
   * - 'html': self-contained HTML with screenshots embedded as base64 (default)
   * - 'pdf': screenshots written to a sidecar directory, PDF generated, then
   *          the HTML and sidecar directory are deleted. Only the PDF is kept.
   */
  output?: 'html' | 'pdf';
  /** Output filename. Default: evidence-report.html (html mode) or evidence-report.pdf (pdf mode) */
  file?: string;
  /** Report heading. Default: Test Evidence Report */
  title?: string;
  /**
   * PDF mode only. CDP endpoint (e.g. 'http://localhost:9222') of an already-running
   * Chromium instance to connect to via chromium.connectOverCDP(), instead of launching
   * a new browser process via chromium.launch(). Useful in environments where launching
   * a fresh browser process is restricted (e.g. a locked-down sandbox) but connecting to
   * an externally-managed instance is not. Must be a URL with an http:, https:, ws:, or
   * wss: scheme — validated at construction time. Default: undefined (launches a new browser).
   */
  cdpEndpoint?: string;
  /**
   * PDF mode only, ignored unless `cdpEndpoint` is set. Maximum time in milliseconds to
   * wait for the CDP connection to be established, passed through to
   * chromium.connectOverCDP(). Default: undefined (Playwright's own default of 30000ms).
   */
  cdpTimeout?: number;
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
  private startTime: Date = new Date();
  private options: EvidenceReporterOptions;
  private screenshotDir: string = '';
  private screenshotCount: number = 0;

  constructor(options: EvidenceReporterOptions = {}) {
    this.options = options;
    this.validateCdpEndpoint();
  }

  /**
   * Fails fast at construction time — before the test run starts — when
   * `cdpEndpoint` is set but is not a URL with a scheme Chromium's CDP
   * transport actually supports. Without this, a typo (e.g. a bare
   * 'localhost:9222' with no scheme, which `new URL()` alone accepts) would
   * only surface as an opaque connection failure after the whole suite ran.
   */
  private validateCdpEndpoint(): void {
    const { cdpEndpoint } = this.options;
    if (cdpEndpoint === undefined) return;

    if (cdpEndpoint.trim() === '') {
      throw new Error(
        "Invalid cdpEndpoint: expected a non-empty URL (e.g. 'http://localhost:9222'), got an empty string.",
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(cdpEndpoint);
    } catch {
      throw new Error(
        `Invalid cdpEndpoint "${cdpEndpoint}": expected a valid URL (e.g. 'http://localhost:9222' or 'ws://127.0.0.1:9222/devtools/browser/<id>').`,
      );
    }

    const supportedProtocols = ['http:', 'https:', 'ws:', 'wss:'];
    if (!supportedProtocols.includes(parsed.protocol)) {
      throw new Error(
        `Invalid cdpEndpoint "${cdpEndpoint}": scheme "${parsed.protocol}" is not supported — use http:, https:, ws:, or wss:.`,
      );
    }
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
   * If `options.cdpEndpoint` is set, connects to that already-running Chromium
   * instance via connectOverCDP() instead of launching a new browser process —
   * for environments where launching a fresh browser is restricted but
   * connecting to an externally-managed one is not. That instance is long-lived
   * and shared, so the page's browser context is explicitly closed before
   * disconnecting — browser.close() alone only disconnects (rather than killing
   * the process) for a CDP-connected browser, and would otherwise leave the
   * context behind for the lifetime of that shared instance.
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

    const dateStr = startTime.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

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

    const browser = await this.connectOrLaunch(chromium);
    try {
      const page = await browser.newPage();
      try {
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
        // Explicit even in launch mode (where it's a no-op ahead of the process
        // teardown below) so CDP mode never leaves a context behind.
        await page.context().close();
      }
    } finally {
      await browser.close();
    }
  }

  /**
   * Connects to `options.cdpEndpoint` via connectOverCDP() when set, otherwise
   * launches a fresh browser. Connection failures against a CDP endpoint are
   * rewrapped with the endpoint and a remediation hint — Playwright's raw
   * error (e.g. a bare ECONNREFUSED) doesn't say which endpoint failed or what
   * to do about it.
   */
  private async connectOrLaunch(
    chromium: typeof import('playwright-core').chromium,
  ): Promise<import('playwright-core').Browser> {
    if (!this.options.cdpEndpoint) {
      return chromium.launch();
    }

    const connectOptions =
      this.options.cdpTimeout !== undefined ? { timeout: this.options.cdpTimeout } : undefined;

    try {
      return connectOptions
        ? await chromium.connectOverCDP(this.options.cdpEndpoint, connectOptions)
        : await chromium.connectOverCDP(this.options.cdpEndpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to connect to CDP endpoint "${this.options.cdpEndpoint}": ${message}. ` +
          'Ensure a Chromium instance is listening for CDP connections at this address.',
        { cause: error },
      );
    }
  }

  /**
   * Resolves the output file path for a given extension, honouring the `file`
   * option and defaulting to 'evidence-report.<ext>'.
   */
  private resolveOutFile(ext: 'html' | 'pdf'): string {
    if (this.options.file) {
      // If file was given, honour it as-is for the primary output mode,
      // or swap the extension for intermediate files in pdf mode.
      return path.resolve(
        ext === this.options.output || this.options.output === undefined
          ? this.options.file
          : this.options.file.replace(/\.[^.]+$/, `.${ext}`),
      );
    }
    return path.resolve(`evidence-report.${ext}`);
  }
}
