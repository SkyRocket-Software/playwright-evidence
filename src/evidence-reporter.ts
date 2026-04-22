import type {
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import fs from 'fs';
import path from 'path';
import { renderReport } from './html.ts';
import type { StepRecord, TestRecord } from './html.ts';

interface EvidenceReporterOptions {
  /** Output filename. Default: evidence-report.html */
  file?: string;
  /** Report heading. Default: Test Evidence Report */
  title?: string;
}

/**
 * Playwright reporter that produces a single self-contained HTML evidence report.
 * All screenshots are embedded as base64. No external dependencies in the output.
 *
 * Configure via reporter options in playwright.config.ts:
 *   reporter: [['@skyrocket-software/playwright-evidence/reporter', { file: 'my-report.html', title: 'My Report' }]]
 */
export default class EvidenceReporter implements Reporter {
  private tests: TestRecord[] = [];
  private startTime: Date = new Date();
  private options: EvidenceReporterOptions;

  constructor(options: EvidenceReporterOptions = {}) {
    this.options = options;
  }

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
    const title = this.options.title ?? 'Test Evidence Report';
    const html = renderReport(title, this.tests, this.startTime);

    const filename = this.options.file ?? 'evidence-report.html';
    const outPath = path.resolve(filename);
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`\nEvidence report written to: ${outPath}`);
  }
}
