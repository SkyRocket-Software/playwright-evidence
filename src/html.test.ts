import { describe, expect, it } from 'vitest';
import {
  badge,
  compareRequirementIds,
  computeRequirementStatus,
  escapeHtml,
  htmlDocument,
  renderReport,
  renderRequirementsList,
  renderStep,
  renderTableOfContents,
  renderTest,
  renderTestCaseIndex,
  renderTraceabilityMatrix,
  runDate,
  stripAnsi,
} from './html.ts';
import type { RequirementRecord, StepRecord, TestRecord } from './html.ts';

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
  requirements: [],
  testId: null,
};

const failingTest: TestRecord = {
  title: 'Form submits data',
  status: 'fail',
  steps: [evidenceStepFail],
  error: 'Expected "success" but got "error"',
  requirements: [],
  testId: null,
};

const skippedTest: TestRecord = {
  title: 'Optional flow',
  status: 'skipped',
  steps: [],
  error: null,
  requirements: [],
  testId: null,
};

const flakyTest: TestRecord = {
  title: 'Passes on retry',
  status: 'flaky',
  steps: [evidenceStepPass],
  error: null,
  requirements: [],
  testId: null,
};

const requirementLogin: RequirementRecord = {
  id: 'FR-LOGIN-1',
  description: 'Users can log in with valid credentials',
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

  it('renders a flaky badge', () => {
    expect(badge('FLAKY', 'flaky')).toBe('<span class="badge badge-flaky">FLAKY</span>');
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

// ── renderRequirementsList ───────────────────────────────────────────────────

describe('renderRequirementsList', () => {
  it('returns an empty string when there are no requirements', () => {
    expect(renderRequirementsList([])).toBe('');
  });

  it('renders the requirement id and description', () => {
    const html = renderRequirementsList([requirementLogin]);
    expect(html).toContain('Requirements proven');
    expect(html).toContain('FR-LOGIN-1');
    expect(html).toContain('Users can log in with valid credentials');
  });

  it('styles the requirement id as a muted id-tag, not bold', () => {
    const html = renderRequirementsList([requirementLogin]);
    expect(html).toContain('<span class="id-tag">FR-LOGIN-1</span>');
    expect(html).not.toContain('<strong>');
  });

  it('capitalizes the first letter of the description', () => {
    const requirement: RequirementRecord = { id: 'FR-LOWER-1', description: 'users can log out' };
    const html = renderRequirementsList([requirement]);
    expect(html).toContain('Users can log out');
    expect(html).not.toContain('users can log out');
  });

  it('renders one list item per requirement', () => {
    const second: RequirementRecord = { id: 'FR-LOGIN-2', description: 'Users can log out' };
    const html = renderRequirementsList([requirementLogin, second]);
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
  });

  it('escapes special characters in id and description', () => {
    const requirement: RequirementRecord = { id: '<b>FR</b>', description: '<script>alert(1)</script>' };
    const html = renderRequirementsList([requirement]);
    expect(html).toContain('&lt;b&gt;FR&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });
});

// ── renderTest ────────────────────────────────────────────────────────────────

describe('renderTest', () => {
  it('includes the test title', () => {
    const html = renderTest(passingTest, 1, undefined);
    expect(html).toContain('User can log in');
  });

  it('does not prefix the heading with the section index — it is not a stable identifier', () => {
    const html = renderTest(passingTest, 2, undefined);
    expect(html).not.toContain('2. User can log in');
  });

  it('capitalizes the first letter of the title', () => {
    const test: TestRecord = { ...passingTest, title: 'page title reads Skyrocket' };
    const html = renderTest(test, 1, undefined);
    expect(html).toContain('<h2>Page title reads Skyrocket</h2>');
    expect(html).not.toContain('page title reads');
  });

  it('renders the test-id as an eyebrow label above the heading, not inside it', () => {
    const test: TestRecord = { ...passingTest, testId: 'TC-LOGIN-1' };
    const html = renderTest(test, 1, undefined);
    expect(html).toContain('<div class="id-tag" style="margin-bottom:4px;">TC-LOGIN-1</div>');
    expect(html).toContain('<h2>User can log in</h2>');
    expect(html.indexOf('TC-LOGIN-1')).toBeLessThan(html.indexOf('<h2>'));
  });

  it('renders just the title with no id-tag label when testId is null', () => {
    const html = renderTest(passingTest, 1, undefined);
    expect(html).not.toContain('id-tag');
  });

  it('renders a PASS badge for a passing test', () => {
    const html = renderTest(passingTest, 1, undefined);
    expect(html).toContain('badge-pass');
    expect(html).toContain('>PASS<');
  });

  it('renders a FAIL badge for a failing test', () => {
    const html = renderTest(failingTest, 1, undefined);
    expect(html).toContain('badge-fail');
    expect(html).toContain('>FAIL<');
  });

  it('renders a SKIP badge for a skipped test', () => {
    const html = renderTest(skippedTest, 1, undefined);
    expect(html).toContain('badge-skipped');
    expect(html).toContain('>SKIP<');
  });

  it('renders a FLAKY badge for a test that only passed on retry', () => {
    const html = renderTest(flakyTest, 1, undefined);
    expect(html).toContain('badge-flaky');
    expect(html).toContain('>FLAKY<');
  });

  it('shows "No recorded steps" when there are no steps', () => {
    const html = renderTest(skippedTest, 1, undefined);
    expect(html).toContain('No recorded steps');
    expect(html).not.toContain('<table');
  });

  it('renders a table when steps are present', () => {
    const html = renderTest(passingTest, 1, undefined);
    expect(html).toContain('<table');
    expect(html).not.toContain('No recorded steps');
  });

  it('renders an error block when there is an error', () => {
    const html = renderTest(failingTest, 1, undefined);
    expect(html).toContain('error-block');
    expect(html).toContain('Expected &quot;success&quot; but got &quot;error&quot;');
  });

  it('strips ANSI codes from error messages', () => {
    const test: TestRecord = { ...failingTest, error: '\x1b[31mred error\x1b[0m' };
    const html = renderTest(test, 1, undefined);
    expect(html).toContain('red error');
    expect(html).not.toContain('\x1b[');
  });

  it('escapes the test title', () => {
    const test: TestRecord = { ...passingTest, title: '<script>alert(1)</script>' };
    const html = renderTest(test, 1, undefined);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('renders no error block when error is null', () => {
    const html = renderTest(passingTest, 1, undefined);
    expect(html).not.toContain('error-block');
  });

  it('renders a requirements list when the test has matched requirements', () => {
    const test: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const html = renderTest(test, 1, undefined);
    expect(html).toContain('Requirements proven');
    expect(html).toContain('FR-LOGIN-1');
  });

  it('renders no requirements list when the test has none', () => {
    const html = renderTest(passingTest, 1, undefined);
    expect(html).not.toContain('Requirements proven');
  });

  it('embeds an invisible page marker in reserve mode', () => {
    const html = renderTest(passingTest, 3, 'reserve');
    expect(html).toContain('[[page:test-3]]');
  });

  it('omits the page marker in html mode', () => {
    const html = renderTest(passingTest, 3, undefined);
    expect(html).not.toContain('[[page:');
  });

  it('omits the page marker once page numbers are resolved — the final PDF has no use for it', () => {
    const html = renderTest(passingTest, 3, new Map([['test-3', 7]]));
    expect(html).not.toContain('[[page:');
  });
});

// ── renderTestCaseIndex ──────────────────────────────────────────────────────

describe('renderTestCaseIndex', () => {
  it('returns an empty string when there are no tests', () => {
    expect(renderTestCaseIndex([], undefined)).toBe('');
  });

  it('titles the section "Test Case Index"', () => {
    const html = renderTestCaseIndex([passingTest], undefined);
    expect(html).toContain('Test Case Index');
  });

  it('lists each test title', () => {
    const html = renderTestCaseIndex([passingTest, failingTest], undefined);
    expect(html).toContain('User can log in');
    expect(html).toContain('Form submits data');
  });

  it('capitalizes the first letter of each test title', () => {
    const test: TestRecord = { ...passingTest, title: 'page title reads Skyrocket' };
    const html = renderTestCaseIndex([test], undefined);
    expect(html).toContain('Page title reads Skyrocket');
  });

  it('does not render a bare ordinal "#" column — the id and page columns cover lookup', () => {
    const html = renderTestCaseIndex([passingTest], undefined);
    expect(html).not.toContain('<th>#</th>');
  });

  it('shows a test-id column entry styled as an id-tag when the test has one', () => {
    const test: TestRecord = { ...passingTest, testId: 'TC-LOGIN-1' };
    const html = renderTestCaseIndex([test], undefined);
    expect(html).toContain('<td class="id-tag">TC-LOGIN-1</td>');
  });

  it('links each row to its section anchor', () => {
    const html = renderTestCaseIndex([passingTest], undefined);
    expect(html).toContain('href="#test-1"');
  });

  it('renders a PASS badge for a passing test', () => {
    const html = renderTestCaseIndex([passingTest], undefined);
    expect(html).toContain('badge-pass');
    expect(html).toContain('>PASS<');
  });

  it('renders a FAIL badge for a failing test', () => {
    const html = renderTestCaseIndex([failingTest], undefined);
    expect(html).toContain('badge-fail');
    expect(html).toContain('>FAIL<');
  });

  it('renders a SKIP badge for a skipped test', () => {
    const html = renderTestCaseIndex([skippedTest], undefined);
    expect(html).toContain('badge-skipped');
    expect(html).toContain('>SKIP<');
  });

  it('renders a FLAKY badge for a test that only passed on retry', () => {
    const html = renderTestCaseIndex([flakyTest], undefined);
    expect(html).toContain('badge-flaky');
    expect(html).toContain('>FLAKY<');
  });

  it('escapes special characters in test titles', () => {
    const test: TestRecord = { ...passingTest, title: '<script>alert(1)</script>' };
    const html = renderTestCaseIndex([test], undefined);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('omits the Page column in html mode', () => {
    const html = renderTestCaseIndex([passingTest], undefined);
    expect(html).not.toContain('<th>Page</th>');
  });

  it('includes the Page column header once page numbers are in play', () => {
    const html = renderTestCaseIndex([passingTest], 'reserve');
    expect(html).toContain('<th>Page</th>');
  });

  it('links the resolved page number to the test\'s section', () => {
    const html = renderTestCaseIndex([passingTest], new Map([['test-1', 4]]));
    expect(html).toContain('<a href="#test-1">4</a>');
  });

  it('embeds an invisible page marker in reserve mode', () => {
    const html = renderTestCaseIndex([passingTest], 'reserve');
    expect(html).toContain('[[page:test-case-index]]');
  });
});

// ── renderTableOfContents ────────────────────────────────────────────────────

describe('renderTableOfContents', () => {
  it('returns an empty string when there is neither a matrix nor any tests', () => {
    expect(renderTableOfContents(false, false, undefined)).toBe('');
  });

  it('titles the section "Table of Contents"', () => {
    const html = renderTableOfContents(true, true, undefined);
    expect(html).toContain('Table of Contents');
  });

  it('lists the Requirements Traceability Matrix only when a matrix exists', () => {
    const withMatrix = renderTableOfContents(true, false, undefined);
    const withoutMatrix = renderTableOfContents(false, true, undefined);
    expect(withMatrix).toContain('Requirements Traceability Matrix');
    expect(withoutMatrix).not.toContain('Requirements Traceability Matrix');
  });

  it('lists the Test Case Index and Test Results only when there are tests', () => {
    const withTests = renderTableOfContents(false, true, undefined);
    const withoutTests = renderTableOfContents(true, false, undefined);
    expect(withTests).toContain('Test Case Index');
    expect(withTests).toContain('Test Results');
    expect(withoutTests).not.toContain('Test Case Index');
    expect(withoutTests).not.toContain('Test Results');
  });

  it('links each entry to its section anchor', () => {
    const html = renderTableOfContents(true, true, undefined);
    expect(html).toContain('href="#requirements-matrix"');
    expect(html).toContain('href="#test-case-index"');
  });

  it('links "Test Results" to the first test — there is no standalone Test Results section', () => {
    const html = renderTableOfContents(true, true, undefined);
    expect(html).toContain('<a href="#test-1">Test Results</a>');
    expect(html).not.toContain('#test-results');
  });

  it('omits the Page column in html mode', () => {
    const html = renderTableOfContents(true, true, undefined);
    expect(html).not.toContain('<th>Page</th>');
  });

  it('shows resolved page numbers, linked, for each entry', () => {
    const pageNumbers = new Map([
      ['requirements-matrix', 2],
      ['test-case-index', 3],
      ['test-1', 4],
    ]);
    const html = renderTableOfContents(true, true, pageNumbers);
    expect(html).toContain('<a href="#requirements-matrix">2</a>');
    expect(html).toContain('<a href="#test-case-index">3</a>');
    expect(html).toContain('<a href="#test-1">4</a>');
  });
});

// ── compareRequirementIds ────────────────────────────────────────────────────

describe('compareRequirementIds', () => {
  it('sorts numeric suffixes naturally rather than lexicographically', () => {
    const ids = ['FR-CHANNEL-10', 'FR-CHANNEL-2', 'FR-CHANNEL-1'];
    expect([...ids].sort(compareRequirementIds)).toEqual(['FR-CHANNEL-1', 'FR-CHANNEL-2', 'FR-CHANNEL-10']);
  });

  it('falls back to string comparison when prefixes differ', () => {
    expect(compareRequirementIds('FR-A-1', 'FR-B-1')).toBeLessThan(0);
  });

  it('falls back to string comparison when an id has no numeric suffix', () => {
    expect(compareRequirementIds('FR-ALPHA', 'FR-BETA')).toBeLessThan(0);
  });
});

// ── computeRequirementStatus ─────────────────────────────────────────────────

describe('computeRequirementStatus', () => {
  it('returns missed when no test covers the requirement', () => {
    expect(computeRequirementStatus([])).toBe('missed');
  });

  it('returns pass when every covering test passed', () => {
    expect(computeRequirementStatus([{ title: 'a', status: 'pass' }])).toBe('pass');
  });

  it('returns fail when any covering test failed', () => {
    expect(computeRequirementStatus([
      { title: 'a', status: 'pass' },
      { title: 'b', status: 'fail' },
    ])).toBe('fail');
  });

  it('returns skipped when every covering test was skipped', () => {
    expect(computeRequirementStatus([{ title: 'a', status: 'skipped' }])).toBe('skipped');
  });

  it('prioritizes fail over an otherwise-skipped set', () => {
    expect(computeRequirementStatus([
      { title: 'a', status: 'skipped' },
      { title: 'b', status: 'fail' },
    ])).toBe('fail');
  });

  it('returns flaky when no test failed but at least one needed a retry to pass', () => {
    expect(computeRequirementStatus([
      { title: 'a', status: 'pass' },
      { title: 'b', status: 'flaky' },
    ])).toBe('flaky');
  });

  it('prioritizes fail over a flaky covering test', () => {
    expect(computeRequirementStatus([
      { title: 'a', status: 'flaky' },
      { title: 'b', status: 'fail' },
    ])).toBe('fail');
  });
});

// ── renderTraceabilityMatrix ──────────────────────────────────────────────────

describe('renderTraceabilityMatrix', () => {
  it('returns an empty string when there are no requirements', () => {
    expect(renderTraceabilityMatrix([], undefined, undefined)).toBe('');
  });

  it('lists a requirement from the map with no covering test as missed', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined);
    expect(html).toContain('Requirements Traceability Matrix');
    expect(html).toContain('FR-LOGIN-1');
    expect(html).toContain('No test covers this requirement');
    expect(html).toContain('MISSED');
  });

  it('styles the requirement id as an id-tag', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined);
    expect(html).toContain('class="id-tag"');
    expect(html).toContain('>FR-LOGIN-1</td>');
  });

  it('places "Proven by" and the test list in a second real row, sharing the row with the requirement\'s own row rather than a guessed offset', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined);
    expect(html).toContain('class="detail-label"');
    expect(html).toContain('>Proven by</td>');
  });

  it('spans the Result badge across both of a requirement\'s rows', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined);
    expect(html).toContain('rowspan="2"');
  });

  it('wraps each requirement\'s two rows in their own tbody, to keep them together across a page break', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined);
    expect(html).toContain('<tbody class="requirement-group">');
  });

  it('capitalizes the first letter of the requirement description', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'users can log in' }, undefined);
    expect(html).toContain('Users can log in');
  });

  it('lists the covering test and rolled-up status for a requirement proven by a test', () => {
    const test: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], { 'FR-LOGIN-1': 'Users can log in with valid credentials' }, undefined);
    expect(html).toContain('User can log in');
    expect(html).toContain('PASS');
  });

  it('capitalizes the first letter of a covering test\'s title', () => {
    const test: TestRecord = { ...passingTest, title: 'user can log in', requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined);
    expect(html).toContain('User can log in');
  });

  it('includes a requirement referenced only by a test tag and missing from the map', () => {
    const test: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined);
    expect(html).toContain('FR-LOGIN-1');
  });

  it('sorts requirement rows using natural numeric ordering', () => {
    const html = renderTraceabilityMatrix([], {
      'FR-CHANNEL-10': 'Tenth',
      'FR-CHANNEL-2': 'Second',
    }, undefined);
    expect(html.indexOf('FR-CHANNEL-2')).toBeLessThan(html.indexOf('FR-CHANNEL-10'));
  });

  it('escapes special characters in the requirement id and description', () => {
    const html = renderTraceabilityMatrix([], { '<b>FR-1</b>': '<script>alert(1)</script>' }, undefined);
    expect(html).toContain('&lt;b&gt;FR-1&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('escapes special characters in a covering test title', () => {
    const test: TestRecord = { ...passingTest, title: '<script>alert(1)</script>', requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('rolls up FAIL when one of two covering tests fails', () => {
    const passing: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const failing: TestRecord = { ...failingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([passing, failing], { 'FR-LOGIN-1': 'Users can log in' }, undefined);
    expect(html).toContain('>FAIL<');
    expect(html).toContain('User can log in');
    expect(html).toContain('Form submits data');
  });

  it('colors each covering test\'s (PASS)/(FAIL) to match its actual status', () => {
    const passing: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const failing: TestRecord = { ...failingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([passing, failing], { 'FR-LOGIN-1': 'Users can log in' }, undefined);
    expect(html).toContain('<span class="badge-pass">(PASS)</span>');
    expect(html).toContain('<span class="badge-fail">(FAIL)</span>');
  });

  it('shows the covering test\'s test-id, styled as an id-tag, ahead of its title', () => {
    const test: TestRecord = { ...passingTest, testId: 'TC-LOGIN-1', requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined);
    expect(html).toContain('<span class="id-tag">TC-LOGIN-1</span>');
    expect(html.indexOf('TC-LOGIN-1')).toBeLessThan(html.indexOf('User can log in'));
  });

  it('shows no page reference in html mode', () => {
    const test: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined);
    expect(html).not.toContain('p. ');
  });

  it('links a resolved page reference to the covering test\'s section', () => {
    const test: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, new Map([['test-1', 5]]));
    expect(html).toContain('p. <a href="#test-1">5</a>');
  });

  it('reserves a wider page-number placeholder for a screenshot-heavy suite than test count alone would imply', () => {
    // A single test with many evidenceSteps can span far more pages than one
    // test "counts" as — the reserved width must account for that, not just
    // the number of tests.
    const shortTest: TestRecord = { ...passingTest, requirements: [requirementLogin], steps: [setupStep] };
    const longTest: TestRecord = { ...passingTest, requirements: [requirementLogin], steps: Array(95).fill(setupStep) };

    const shortHtml = renderTraceabilityMatrix([shortTest], { 'FR-LOGIN-1': 'Users can log in' }, 'reserve');
    const longHtml = renderTraceabilityMatrix([longTest], { 'FR-LOGIN-1': 'Users can log in' }, 'reserve');

    const shortWidth = Number(shortHtml.match(/min-width:(\d+)ch/)![1]);
    const longWidth = Number(longHtml.match(/min-width:(\d+)ch/)![1]);

    expect(longWidth).toBeGreaterThan(shortWidth);
  });

  it('id anchors the section for the Table of Contents to link to', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined);
    expect(html).toContain('id="requirements-matrix"');
  });

  it('embeds an invisible page marker in reserve mode', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, 'reserve');
    expect(html).toContain('[[page:requirements-matrix]]');
  });
});

// ── renderReport ──────────────────────────────────────────────────────────────

describe('renderReport', () => {
  it('uses the provided title in the <title> tag', () => {
    const html = renderReport('My Evidence Report', [], new Date());
    expect(html).toContain('<title>My Evidence Report</title>');
  });

  it('escapes special characters in the title on the cover page', () => {
    const html = renderReport('<Evil> & "Title"', [], new Date());
    expect(html).toContain('<h1>&lt;Evil&gt; &amp; &quot;Title&quot;</h1>');
    expect(html).not.toContain('<h1><Evil>');
  });

  it('shows PASS overall when all tests pass', () => {
    const html = renderReport('R', [passingTest], new Date());
    expect(html).toContain('class="summary-box overall-pass"');
    expect(html).toContain('>PASS<');
  });

  it('shows FAIL overall when any test fails', () => {
    const html = renderReport('R', [passingTest, failingTest], new Date());
    expect(html).toContain('class="summary-box overall-fail"');
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

  it('counts a flaky test as passed in the tally — it did pass, just not on the first try', () => {
    const html = renderReport('R', [passingTest, flakyTest], new Date());
    expect(html).toContain('2 of 2 tests passed');
  });

  it('shows FLAKY overall, not PASS, when a test only passed on retry and none failed', () => {
    const html = renderReport('R', [passingTest, flakyTest], new Date());
    expect(html).toContain('class="summary-box overall-flaky"');
    expect(html).toContain('>FLAKY<');
    expect(html).not.toContain('class="summary-box overall-pass"');
  });

  it('shows FAIL overall, not FLAKY, when a run has both a failure and a flaky test', () => {
    const html = renderReport('R', [failingTest, flakyTest], new Date());
    expect(html).toContain('class="summary-box overall-fail"');
    expect(html).toContain('>FAIL<');
    expect(html).not.toContain('class="summary-box overall-flaky"');
  });

  it('includes all test sections', () => {
    const html = renderReport('R', [passingTest, failingTest], new Date());
    expect(html).toContain('User can log in');
    expect(html).toContain('Form submits data');
  });

  it('shows PASS when there are zero tests', () => {
    // No failures means overall is PASS
    const html = renderReport('R', [], new Date());
    expect(html).toContain('class="summary-box overall-pass"');
  });

  it('renders no traceability matrix when requirementsMap is omitted', () => {
    const html = renderReport('R', [passingTest], new Date());
    expect(html).not.toContain('Requirements Traceability Matrix');
  });

  it('renders the table of contents, then the traceability matrix, then the test case index', () => {
    const html = renderReport('R', [passingTest], new Date(), { 'FR-LOGIN-1': 'Users can log in' });
    expect(html).toContain('<h2>Requirements Traceability Matrix</h2>');
    expect(html.indexOf('<h2>Table of Contents</h2>')).toBeLessThan(html.indexOf('<h2>Requirements Traceability Matrix</h2>'));
    expect(html.indexOf('<h2>Requirements Traceability Matrix</h2>')).toBeLessThan(html.indexOf('<h2>Test Case Index</h2>'));
  });

  it('does not render a standalone Test Results heading — individual tests follow the index directly', () => {
    const html = renderReport('R', [passingTest], new Date());
    expect(html).not.toContain('<h2>Test Results</h2>');
  });

  it('renders no page numbers or markers in html mode', () => {
    const html = renderReport('R', [passingTest], new Date(), { 'FR-LOGIN-1': 'Users can log in' });
    expect(html).not.toContain('[[page:');
    expect(html).not.toContain('<th>Page</th>');
  });

  it('propagates resolved page numbers through to the table of contents, matrix, and index', () => {
    const pageNumbers = new Map([
      ['requirements-matrix', 2],
      ['test-case-index', 3],
      ['test-1', 5],
    ]);
    const test: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const html = renderReport('R', [test], new Date(), { 'FR-LOGIN-1': 'Users can log in' }, pageNumbers);
    expect(html).toContain('<th>Page</th>');
    expect(html).not.toContain('[[page:');
    // Table of Contents' "Test Results" row links to the first test's resolved page.
    expect(html).toContain('<a href="#test-1">Test Results</a>');
    expect(html).toContain('<a href="#test-1">5</a>');
  });
});
