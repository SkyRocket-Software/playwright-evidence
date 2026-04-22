import type {
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import fs from 'fs';
import path from 'path';
import { escapeHtml, stripAnsi, badge, htmlDocument, runDate } from './html.ts';

interface StepRecord {
  title: string;
  status: 'pass' | 'fail';
  screenshotBase64: string | null;
  screenshotLabel: string | null;
}

interface TestRecord {
  title: string;
  status: 'pass' | 'fail' | 'skipped';
  steps: StepRecord[];
  error: string | null;
}

/**
 * Playwright reporter that produces a single self-contained HTML evidence report.
 * All screenshots are embedded as base64. No external dependencies in the output.
 *
 * Configure via environment variables:
 *   EVIDENCE_REPORT_FILE  — output filename (default: evidence-report.html)
 *   EVIDENCE_REPORT_TITLE — report title (default: Test Evidence Report)
 */
export default class EvidenceReporter implements Reporter {
  private tests: TestRecord[] = [];
  private startTime: Date = new Date();

  onBegin(_config: unknown, _suite: Suite): void {
    this.startTime = new Date();
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

    this.tests.push({ title: test.title, status, steps, error });
  }

  private collectStep(
    step: TestStep,
    attachments: TestResult['attachments'],
    out: StepRecord[],
  ): void {
    const status = step.error ? 'fail' : 'pass';

    const match = attachments.find((a) => a.name === step.title);
    let screenshotBase64: string | null = null;
    let screenshotLabel: string | null = null;

    if (match) {
      const buf = match.body ?? (match.path ? fs.readFileSync(match.path) : null);
      if (buf) {
        screenshotBase64 = buf.toString('base64');
        screenshotLabel = match.name;
      }
    }

    out.push({ title: step.title, status, screenshotBase64, screenshotLabel });

    for (const child of step.steps ?? []) {
      if (child.category === 'test.step') {
        this.collectStep(child, attachments, out);
      }
    }
  }

  onEnd(): void {
    const passed = this.tests.filter((t) => t.status === 'pass').length;
    const failed = this.tests.filter((t) => t.status === 'fail').length;
    const total = this.tests.length;
    const overallStatus = failed === 0 ? 'PASS' : 'FAIL';

    const title = process.env['EVIDENCE_REPORT_TITLE'] ?? 'Test Evidence Report';

    const testSections = this.tests
      .map((t, i) => this.renderTest(t, i + 1))
      .join('\n');

    const html = htmlDocument(title, `
  <div class="cover">
    <h1>${title}</h1>
    <p class="meta">Generated: ${runDate(this.startTime)}</p>
    <div class="summary-box overall-${overallStatus.toLowerCase()}">
      <div class="overall ${overallStatus === 'PASS' ? 'pass-text' : 'fail-text'}">${overallStatus}</div>
      <div>${passed} of ${total} test${total !== 1 ? 's' : ''} passed</div>
    </div>
  </div>
  <div class="body">${testSections}</div>
`);

    const filename = process.env['EVIDENCE_REPORT_FILE'] ?? 'evidence-report.html';
    const outPath = path.resolve(filename);
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`\nEvidence report written to: ${outPath}`);
  }

  private renderTest(test: TestRecord, index: number): string {
    const badgeVariant = test.status === 'pass' ? 'pass' : test.status === 'skipped' ? 'skipped' : 'fail';
    const badgeText = test.status === 'pass' ? 'PASS' : test.status === 'skipped' ? 'SKIP' : 'FAIL';

    const stepRows = test.steps
      .map((step, si) => this.renderStep(step, si + 1))
      .join('\n');

    const errorBlock = test.error
      ? `<div class="error-block">${escapeHtml(stripAnsi(test.error))}</div>`
      : '';

    return `
    <div class="section">
      <div class="section-header">
        <h2>${index}. ${escapeHtml(test.title)}</h2>
        ${badge(badgeText, badgeVariant)}
      </div>
      ${stepRows
        ? `<table class="data-table">
          <thead><tr><th>#</th><th>Step</th><th>Result</th></tr></thead>
          <tbody>${stepRows}</tbody>
        </table>`
        : '<p style="color:#888;font-size:13px;">No recorded steps.</p>'
      }
      ${errorBlock}
    </div>`;
  }

  private renderStep(step: StepRecord, index: number): string {
    const isSetup = step.screenshotBase64 === null;

    if (isSetup) {
      return `
      <tr style="opacity:0.5;">
        <td class="col-num">${index}</td>
        <td><em>${escapeHtml(step.title)}</em></td>
        <td class="col-status" style="font-size:11px;color:#888;">setup</td>
      </tr>`;
    }

    const screenshotRow = `<tr class="screenshot-row">
          <td colspan="3">
            <img src="data:image/png;base64,${step.screenshotBase64}" alt="${escapeHtml(step.screenshotLabel ?? step.title)}" />
            <p class="screenshot-caption">Screenshot: ${escapeHtml(step.screenshotLabel ?? step.title)}</p>
          </td>
        </tr>`;

    return `
      <tr>
        <td class="col-num">${index}</td>
        <td>${escapeHtml(step.title)}</td>
        <td class="col-status">${badge(step.status === 'pass' ? 'PASS' : 'FAIL', step.status)}</td>
      </tr>
      ${screenshotRow}`;
  }
}
