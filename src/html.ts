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

export interface TestRecord {
  title: string;
  status: 'pass' | 'fail' | 'skipped';
  steps: StepRecord[];
  error: string | null;
}

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

export function badge(text: string, variant: 'pass' | 'fail' | 'skipped' | 'missed'): string {
  return `<span class="badge badge-${variant}">${text}</span>`;
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
    .cover .summary-box .overall.pass-text { color: #1a6b2a; }
    .cover .summary-box .overall.fail-text { color: #a01010; }

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
      gap: 14px;
      margin-bottom: 16px;
    }
    .section-header h2 {
      font-size: 18px;
      font-weight: bold;
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
      margin-bottom: 12px;
    }

    /* ── Print ───────────────────────────────────────────── */
    @media print {
      body { font-size: 12px; }
      .cover {
        page-break-after: always;
        padding: 60px 40px;
      }
      .body { padding: 20px 40px; }
      .section { page-break-inside: avoid; }
      .screenshot-row { page-break-inside: avoid; }
      .screenshot-row img {
        max-width: 100%;
        max-height: 600px;
        object-fit: contain;
      }
      .cover .summary-box { background: none !important; }
      .error-block { background: none !important; }
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

export function runDate(date: Date): string {
  return date.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
}

/**
 * Renders a single step row (or setup row) as HTML table row(s).
 * Setup steps (no screenshot) are rendered muted. Evidence steps include a screenshot row.
 */
export function renderStep(step: StepRecord, index: number): string {
  const imgSrc = step.screenshotBase64
    ? `data:image/png;base64,${step.screenshotBase64}`
    : step.screenshotPath ?? null;

  if (imgSrc === null) {
    return `
      <tr style="opacity:0.5;">
        <td class="col-num">${index}</td>
        <td><em>${escapeHtml(step.title)}</em></td>
        <td class="col-status" style="font-size:11px;color:#888;">setup</td>
      </tr>`;
  }

  const screenshotRow = `<tr class="screenshot-row">
          <td colspan="3">
            <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(step.screenshotLabel ?? step.title)}" />
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

/**
 * Renders a single test section (header, step table, error block) as HTML.
 *
 * @param test  - The plain test record to render
 * @param index - 1-based position in the report, used for the section heading
 */
export function renderTest(test: TestRecord, index: number): string {
  const badgeVariant = test.status === 'pass' ? 'pass' : test.status === 'skipped' ? 'skipped' : 'fail';
  const badgeText = test.status === 'pass' ? 'PASS' : test.status === 'skipped' ? 'SKIP' : 'FAIL';

  const stepRows = test.steps
    .map((step, si) => renderStep(step, si + 1))
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

/**
 * Renders the full evidence report as a self-contained HTML string.
 *
 * @param title     - Report title (shown in cover and <title>)
 * @param tests     - Ordered list of test records to include
 * @param startTime - When the test run began, shown in the cover
 */
export function renderReport(title: string, tests: TestRecord[], startTime: Date): string {
  const passed = tests.filter((t) => t.status === 'pass').length;
  const failed = tests.filter((t) => t.status === 'fail').length;
  const total = tests.length;
  const overallStatus = failed === 0 ? 'PASS' : 'FAIL';

  const testSections = tests
    .map((t, i) => renderTest(t, i + 1))
    .join('\n');

  return htmlDocument(title, `
  <div class="cover">
    <h1>${title}</h1>
    <p class="meta">Generated: ${runDate(startTime)}</p>
    <div class="summary-box overall-${overallStatus.toLowerCase()}">
      <div class="overall ${overallStatus === 'PASS' ? 'pass-text' : 'fail-text'}">${overallStatus}</div>
      <div>${passed} of ${total} test${total !== 1 ? 's' : ''} passed</div>
    </div>
  </div>
  <div class="body">${testSections}</div>
`);
}
