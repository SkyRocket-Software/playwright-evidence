import { describe, expect, it } from 'vitest';
import {
  badge,
  escapeHtml,
  htmlDocument,
  renderReport,
  renderStep,
  renderTest,
  renderToc,
  runDate,
  stripAnsi,
} from './html.ts';
import type { StepRecord, TestRecord } from './html.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const setupStep: StepRecord = {
  title: 'Navigate to login page',
  status: 'pass',
  screenshotBase64: null,
  screenshotPath: null,
  screenshotLabel: null,
};

const evidenceStepPass: StepRecord = {
  title: 'Check dashboard loads',
  status: 'pass',
  screenshotBase64: 'abc123base64==',
  screenshotPath: null,
  screenshotLabel: 'Check dashboard loads',
};

const evidenceStepFail: StepRecord = {
  title: 'Submit form',
  status: 'fail',
  screenshotBase64: 'xyz789base64==',
  screenshotPath: null,
  screenshotLabel: 'Submit form',
};

const passingTest: TestRecord = {
  title: 'User can log in',
  status: 'pass',
  steps: [setupStep, evidenceStepPass],
  error: null,
};

const failingTest: TestRecord = {
  title: 'Form submits data',
  status: 'fail',
  steps: [evidenceStepFail],
  error: 'Expected "success" but got "error"',
};

const skippedTest: TestRecord = {
  title: 'Optional flow',
  status: 'skipped',
  steps: [],
  error: null,
};

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes multiple special characters in one string', () => {
    expect(escapeHtml('<a href="x&y">')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;');
  });

  it('returns plain strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });
});

// ── stripAnsi ─────────────────────────────────────────────────────────────────

describe('stripAnsi', () => {
  it('strips colour escape sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('strips bold sequences', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[22m')).toBe('bold');
  });

  it('passes plain strings through unchanged', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('strips multiple sequences in one string', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m and \x1b[31mred\x1b[0m')).toBe('green and red');
  });
});

// ── badge ─────────────────────────────────────────────────────────────────────

describe('badge', () => {
  it('renders a pass badge', () => {
    expect(badge('PASS', 'pass')).toBe('<span class="badge badge-pass">PASS</span>');
  });

  it('renders a fail badge', () => {
    expect(badge('FAIL', 'fail')).toBe('<span class="badge badge-fail">FAIL</span>');
  });

  it('renders a skipped badge', () => {
    expect(badge('SKIP', 'skipped')).toBe('<span class="badge badge-skipped">SKIP</span>');
  });

  it('renders a missed badge', () => {
    expect(badge('MISSED', 'missed')).toBe('<span class="badge badge-missed">MISSED</span>');
  });
});

// ── htmlDocument ──────────────────────────────────────────────────────────────

describe('htmlDocument', () => {
  it('includes the title in the <title> tag', () => {
    const html = htmlDocument('My Report', '<p>body</p>');
    expect(html).toContain('<title>My Report</title>');
  });

  it('escapes special characters in the title', () => {
    const html = htmlDocument('<Evil> & "Title"', '');
    expect(html).toContain('<title>&lt;Evil&gt; &amp; &quot;Title&quot;</title>');
  });

  it('includes the body content', () => {
    const html = htmlDocument('T', '<p>hello</p>');
    expect(html).toContain('<p>hello</p>');
  });

  it('produces valid HTML5 boilerplate', () => {
    const html = htmlDocument('T', '');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
  });
});

// ── runDate ───────────────────────────────────────────────────────────────────

describe('runDate', () => {
  it('returns a non-empty string', () => {
    const result = runDate(new Date('2025-03-15T10:30:00'));
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes the year', () => {
    expect(runDate(new Date('2025-03-15T10:30:00'))).toContain('2025');
  });

  it('labels the date as UTC, so it is not misread as local time', () => {
    expect(runDate(new Date('2025-03-15T10:30:00Z'))).toContain('UTC');
  });

  it('formats in UTC rather than local time, so it always agrees with the filename timestamp', () => {
    // Pacific/Kiritimati is UTC+14 — far enough that this instant's UTC date
    // (Jan 1) and local date (Jan 2) fall on different calendar days. If
    // runDate used local formatting instead of UTC, this would read
    // 'January 2, 2026' instead.
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      const date = new Date(Date.UTC(2026, 0, 1, 23, 30, 0));
      expect(runDate(date)).toContain('January 1, 2026');
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});

// ── renderStep ────────────────────────────────────────────────────────────────

describe('renderStep', () => {
  it('renders a setup step (no screenshot) as muted with "setup" label', () => {
    const html = renderStep(setupStep, 1);
    expect(html).toContain('opacity:0.5');
    expect(html).toContain('setup');
    expect(html).toContain('Navigate to login page');
    expect(html).not.toContain('data:image/png');
  });

  it('renders the 1-based index for setup steps', () => {
    const html = renderStep(setupStep, 3);
    expect(html).toContain('>3<');
  });

  it('renders an evidence step with a pass badge', () => {
    const html = renderStep(evidenceStepPass, 1);
    expect(html).toContain('badge-pass');
    expect(html).toContain('>PASS<');
  });

  it('renders an evidence step with a fail badge', () => {
    const html = renderStep(evidenceStepFail, 1);
    expect(html).toContain('badge-fail');
    expect(html).toContain('>FAIL<');
  });

  it('embeds the screenshot as a base64 data URI', () => {
    const html = renderStep(evidenceStepPass, 1);
    expect(html).toContain(`data:image/png;base64,${evidenceStepPass.screenshotBase64}`);
  });

  it('uses screenshotLabel as the img alt text', () => {
    const html = renderStep(evidenceStepPass, 1);
    expect(html).toContain(`alt="Check dashboard loads"`);
  });

  it('falls back to title for alt text when screenshotLabel is null', () => {
    const step: StepRecord = { ...evidenceStepPass, screenshotLabel: null };
    const html = renderStep(step, 1);
    expect(html).toContain(`alt="${step.title}"`);
  });

  it('renders a sidecar path as an img src when screenshotPath is set', () => {
    const step: StepRecord = {
      ...evidenceStepPass,
      screenshotBase64: null,
      screenshotPath: 'screenshots/screenshot-1.png',
    };
    const html = renderStep(step, 1);
    expect(html).toContain('src="screenshots/screenshot-1.png"');
    expect(html).not.toContain('data:image/png');
  });

  it('treats a step as setup (no screenshot) when both screenshotBase64 and screenshotPath are null', () => {
    const step: StepRecord = { ...evidenceStepPass, screenshotBase64: null, screenshotPath: null };
    const html = renderStep(step, 1);
    expect(html).toContain('setup');
    expect(html).not.toContain('<img');
  });

  it('escapes special characters in the step title', () => {
    const step: StepRecord = { ...setupStep, title: '<Evil> & "Step"' };
    const html = renderStep(step, 1);
    expect(html).toContain('&lt;Evil&gt; &amp; &quot;Step&quot;');
    expect(html).not.toContain('<Evil>');
  });
});

// ── renderTest ────────────────────────────────────────────────────────────────

describe('renderTest', () => {
  it('includes the test title', () => {
    const html = renderTest(passingTest, 1);
    expect(html).toContain('User can log in');
  });

  it('prefixes the section heading with the 1-based index', () => {
    const html = renderTest(passingTest, 2);
    expect(html).toContain('2. User can log in');
  });

  it('renders a PASS badge for a passing test', () => {
    const html = renderTest(passingTest, 1);
    expect(html).toContain('badge-pass');
    expect(html).toContain('>PASS<');
  });

  it('renders a FAIL badge for a failing test', () => {
    const html = renderTest(failingTest, 1);
    expect(html).toContain('badge-fail');
    expect(html).toContain('>FAIL<');
  });

  it('renders a SKIP badge for a skipped test', () => {
    const html = renderTest(skippedTest, 1);
    expect(html).toContain('badge-skipped');
    expect(html).toContain('>SKIP<');
  });

  it('shows "No recorded steps" when there are no steps', () => {
    const html = renderTest(skippedTest, 1);
    expect(html).toContain('No recorded steps');
    expect(html).not.toContain('<table');
  });

  it('renders a table when steps are present', () => {
    const html = renderTest(passingTest, 1);
    expect(html).toContain('<table');
    expect(html).not.toContain('No recorded steps');
  });

  it('renders an error block when there is an error', () => {
    const html = renderTest(failingTest, 1);
    expect(html).toContain('error-block');
    expect(html).toContain('Expected &quot;success&quot; but got &quot;error&quot;');
  });

  it('strips ANSI codes from error messages', () => {
    const test: TestRecord = { ...failingTest, error: '\x1b[31mred error\x1b[0m' };
    const html = renderTest(test, 1);
    expect(html).toContain('red error');
    expect(html).not.toContain('\x1b[');
  });

  it('escapes the test title', () => {
    const test: TestRecord = { ...passingTest, title: '<script>alert(1)</script>' };
    const html = renderTest(test, 1);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('renders no error block when error is null', () => {
    const html = renderTest(passingTest, 1);
    expect(html).not.toContain('error-block');
  });
});

// ── renderToc ─────────────────────────────────────────────────────────────────

describe('renderToc', () => {
  it('returns an empty string when there are no tests', () => {
    expect(renderToc([])).toBe('');
  });

  it('lists each test title', () => {
    const html = renderToc([passingTest, failingTest]);
    expect(html).toContain('User can log in');
    expect(html).toContain('Form submits data');
  });

  it('numbers entries in order', () => {
    const html = renderToc([passingTest, failingTest]);
    expect(html).toContain('>1<');
    expect(html).toContain('>2<');
  });

  it('renders a PASS badge for a passing test', () => {
    const html = renderToc([passingTest]);
    expect(html).toContain('badge-pass');
    expect(html).toContain('>PASS<');
  });

  it('renders a FAIL badge for a failing test', () => {
    const html = renderToc([failingTest]);
    expect(html).toContain('badge-fail');
    expect(html).toContain('>FAIL<');
  });

  it('renders a SKIP badge for a skipped test', () => {
    const html = renderToc([skippedTest]);
    expect(html).toContain('badge-skipped');
    expect(html).toContain('>SKIP<');
  });

  it('escapes special characters in test titles', () => {
    const test: TestRecord = { ...passingTest, title: '<script>alert(1)</script>' };
    const html = renderToc([test]);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });
});

// ── renderReport ──────────────────────────────────────────────────────────────

describe('renderReport', () => {
  it('uses the provided title in the <title> tag', () => {
    const html = renderReport('My Evidence Report', [], new Date());
    expect(html).toContain('<title>My Evidence Report</title>');
  });

  it('shows PASS overall when all tests pass', () => {
    const html = renderReport('R', [passingTest], new Date());
    expect(html).toContain('overall-pass');
    expect(html).toContain('>PASS<');
  });

  it('shows FAIL overall when any test fails', () => {
    const html = renderReport('R', [passingTest, failingTest], new Date());
    expect(html).toContain('overall-fail');
    expect(html).toContain('>FAIL<');
  });

  it('counts passed and total correctly', () => {
    const html = renderReport('R', [passingTest, failingTest, passingTest], new Date());
    expect(html).toContain('2 of 3 tests passed');
  });

  it('uses singular "test" for exactly one test', () => {
    const html = renderReport('R', [passingTest], new Date());
    expect(html).toContain('1 of 1 test passed');
  });

  it('includes all test sections', () => {
    const html = renderReport('R', [passingTest, failingTest], new Date());
    expect(html).toContain('User can log in');
    expect(html).toContain('Form submits data');
  });

  it('numbers sections in order', () => {
    const html = renderReport('R', [passingTest, failingTest], new Date());
    expect(html).toContain('1. User can log in');
    expect(html).toContain('2. Form submits data');
  });

  it('shows PASS when there are zero tests', () => {
    // No failures means overall is PASS
    const html = renderReport('R', [], new Date());
    expect(html).toContain('overall-pass');
  });
});
