import { describe, expect, it } from 'vitest';
import { upperFirst } from 'lodash-es';
import {
  badge,
  collectRequirementFeatures,
  compareNaturalIds,
  compareTestOrder,
  computeRequirementOrder,
  computeRollupStatus,
  escapeHtml,
  htmlDocument,
  normalizeRequirementInput,
  renderAboutSection,
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
import type { AboutFeature, RequirementRecord, StepRecord, TestRecord } from './html.ts';

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
  describeTitle: null,
};

const failingTest: TestRecord = {
  title: 'Form submits data',
  status: 'fail',
  steps: [evidenceStepFail],
  error: 'Expected "success" but got "error"',
  requirements: [],
  testId: null,
  describeTitle: null,
};

const skippedTest: TestRecord = {
  title: 'Optional flow',
  status: 'skipped',
  steps: [],
  error: null,
  requirements: [],
  testId: null,
  describeTitle: null,
};

const flakyTest: TestRecord = {
  title: 'Passes on retry',
  status: 'flaky',
  steps: [evidenceStepPass],
  error: null,
  requirements: [],
  testId: null,
  describeTitle: null,
};

const requirementLogin: RequirementRecord = {
  id: 'FR-LOGIN-1',
  description: 'Users can log in with valid credentials',
  features: [],
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
    const requirement: RequirementRecord = { id: 'FR-LOWER-1', description: 'users can log out', features: [] };
    const html = renderRequirementsList([requirement]);
    expect(html).toContain('Users can log out');
    expect(html).not.toContain('users can log out');
  });

  it('renders one list item per requirement', () => {
    const second: RequirementRecord = { id: 'FR-LOGIN-2', description: 'Users can log out', features: [] };
    const html = renderRequirementsList([requirementLogin, second]);
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
  });

  it('escapes special characters in id and description', () => {
    const requirement: RequirementRecord = { id: '<b>FR</b>', description: '<script>alert(1)</script>', features: [] };
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

  it('renders the enclosing describe title as a label above the heading, restoring the sentence\'s subject', () => {
    const test: TestRecord = { ...passingTest, describeTitle: 'the homepage' };
    const html = renderTest(test, 1, undefined);
    expect(html).toContain('<div class="describe-label">The homepage</div>');
    expect(html.indexOf('The homepage')).toBeLessThan(html.indexOf('<h2>'));
  });

  it('renders no describe label when the test has no enclosing describe block', () => {
    const html = renderTest(passingTest, 1, undefined);
    expect(html).not.toContain('describe-label');
  });

  it('renders the test-id eyebrow above the describe label, above the heading', () => {
    const test: TestRecord = { ...passingTest, testId: 'TC-LOGIN-1', describeTitle: 'the homepage' };
    const html = renderTest(test, 1, undefined);
    expect(html.indexOf('TC-LOGIN-1')).toBeLessThan(html.indexOf('The homepage'));
    expect(html.indexOf('The homepage')).toBeLessThan(html.indexOf('<h2>'));
  });

  it('escapes special characters in the describe label', () => {
    const test: TestRecord = { ...passingTest, describeTitle: '<script>alert(1)</script>' };
    const html = renderTest(test, 1, undefined);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
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
    expect(renderTableOfContents(false, false, null, undefined)).toBe('');
  });

  it('titles the section "Table of Contents"', () => {
    const html = renderTableOfContents(true, true, null, undefined);
    expect(html).toContain('Table of Contents');
  });

  it('lists the Requirements Traceability Matrix only when a matrix exists', () => {
    const withMatrix = renderTableOfContents(true, false, null, undefined);
    const withoutMatrix = renderTableOfContents(false, true, null, undefined);
    expect(withMatrix).toContain('Requirements Traceability Matrix');
    expect(withoutMatrix).not.toContain('Requirements Traceability Matrix');
  });

  it('lists the Test Case Index and Test Results only when there are tests', () => {
    const withTests = renderTableOfContents(false, true, null, undefined);
    const withoutTests = renderTableOfContents(true, false, null, undefined);
    expect(withTests).toContain('Test Case Index');
    expect(withTests).toContain('Test Results');
    expect(withoutTests).not.toContain('Test Case Index');
    expect(withoutTests).not.toContain('Test Results');
  });

  it('links each entry to its section anchor', () => {
    const html = renderTableOfContents(true, true, null, undefined);
    expect(html).toContain('href="#requirements-matrix"');
    expect(html).toContain('href="#test-case-index"');
  });

  it('links "Test Results" to the first test — there is no standalone Test Results section', () => {
    const html = renderTableOfContents(true, true, null, undefined);
    expect(html).toContain('<a href="#test-1">Test Results</a>');
    expect(html).not.toContain('#test-results');
  });

  it('omits the Page column in html mode', () => {
    const html = renderTableOfContents(true, true, null, undefined);
    expect(html).not.toContain('<th>Page</th>');
  });

  it('shows resolved page numbers, linked, for each entry', () => {
    const pageNumbers = new Map([
      ['requirements-matrix', 2],
      ['test-case-index', 3],
      ['test-1', 4],
    ]);
    const html = renderTableOfContents(true, true, null, pageNumbers);
    expect(html).toContain('<a href="#requirements-matrix">2</a>');
    expect(html).toContain('<a href="#test-case-index">3</a>');
    expect(html).toContain('<a href="#test-1">4</a>');
  });

  it('lists "About" linked to the first feature\'s anchor when one is given', () => {
    const html = renderTableOfContents(false, false, 'login', undefined);
    expect(html).toContain('<a href="#about-login">About</a>');
  });

  it('omits "About" when there is no first feature id', () => {
    const html = renderTableOfContents(true, true, null, undefined);
    expect(html).not.toContain('>About<');
  });

  it('does not return an empty string when only About is present', () => {
    expect(renderTableOfContents(false, false, 'login', undefined)).not.toBe('');
  });
});

// ── compareNaturalIds ────────────────────────────────────────────────────────

describe('compareNaturalIds', () => {
  it('sorts numeric suffixes naturally rather than lexicographically', () => {
    const ids = ['FR-CHANNEL-10', 'FR-CHANNEL-2', 'FR-CHANNEL-1'];
    expect([...ids].sort(compareNaturalIds)).toEqual(['FR-CHANNEL-1', 'FR-CHANNEL-2', 'FR-CHANNEL-10']);
  });

  it('falls back to string comparison when prefixes differ', () => {
    expect(compareNaturalIds('FR-A-1', 'FR-B-1')).toBeLessThan(0);
  });

  it('falls back to string comparison when an id has no numeric suffix', () => {
    expect(compareNaturalIds('FR-ALPHA', 'FR-BETA')).toBeLessThan(0);
  });
});

// ── compareTestOrder ─────────────────────────────────────────────────────────

describe('compareTestOrder', () => {
  it('sorts two id-carrying tests naturally by their test-id', () => {
    const a: TestRecord = { ...passingTest, testId: 'TC-LOGIN-10' };
    const b: TestRecord = { ...passingTest, testId: 'TC-LOGIN-2' };
    expect([a, b].sort(compareTestOrder)).toEqual([b, a]);
  });

  it('orders a test with a test-id ahead of one without', () => {
    const withId: TestRecord = { ...passingTest, testId: 'TC-LOGIN-1' };
    const withoutId: TestRecord = { ...passingTest, testId: null };
    expect([withoutId, withId].sort(compareTestOrder)).toEqual([withId, withoutId]);
  });

  it('leaves the relative order of two id-less tests unchanged', () => {
    const first: TestRecord = { ...passingTest, title: 'Runs first', testId: null };
    const second: TestRecord = { ...passingTest, title: 'Runs second', testId: null };
    expect([first, second].sort(compareTestOrder)).toEqual([first, second]);
  });

  it('ranks a test by its lowest-ranked requirement ahead of test-id order', () => {
    const requirementRank = new Map([['FR-LOGIN-1', 0], ['FR-CHECKOUT-1', 1]]);
    // Test-id order alone would put provesCheckout first; the requirement rank should win instead.
    const provesCheckout: TestRecord = { ...passingTest, testId: 'TC-A-1', requirements: [{ id: 'FR-CHECKOUT-1', description: '', features: [] }] };
    const provesLogin: TestRecord = { ...passingTest, testId: 'TC-Z-1', requirements: [{ id: 'FR-LOGIN-1', description: '', features: [] }] };
    expect([provesCheckout, provesLogin].sort((a, b) => compareTestOrder(a, b, requirementRank))).toEqual([provesLogin, provesCheckout]);
  });

  it('ranks a test proving any requirement ahead of one proving none, even if the latter\'s test-id sorts first', () => {
    const requirementRank = new Map([['FR-LOGIN-1', 0]]);
    const provesRequirement: TestRecord = { ...passingTest, testId: 'TC-Z-1', requirements: [{ id: 'FR-LOGIN-1', description: '', features: [] }] };
    const provesNothing: TestRecord = { ...passingTest, testId: 'TC-A-1' };
    expect([provesNothing, provesRequirement].sort((a, b) => compareTestOrder(a, b, requirementRank))).toEqual([provesRequirement, provesNothing]);
  });

  it('falls back to test-id order for two tests tied on requirement rank', () => {
    const requirementRank = new Map([['FR-LOGIN-1', 0]]);
    const first: TestRecord = { ...passingTest, testId: 'TC-LOGIN-1', requirements: [{ id: 'FR-LOGIN-1', description: '', features: [] }] };
    const second: TestRecord = { ...passingTest, testId: 'TC-LOGIN-2', requirements: [{ id: 'FR-LOGIN-1', description: '', features: [] }] };
    expect([second, first].sort((a, b) => compareTestOrder(a, b, requirementRank))).toEqual([first, second]);
  });
});

// ── computeRequirementOrder ──────────────────────────────────────────────────

describe('computeRequirementOrder', () => {
  it('falls back to natural id order when about is undefined', () => {
    const features = new Map([['FR-CHANNEL-10', []], ['FR-CHANNEL-2', []]]);
    expect(computeRequirementOrder(['FR-CHANNEL-10', 'FR-CHANNEL-2'], features, undefined)).toEqual(['FR-CHANNEL-2', 'FR-CHANNEL-10']);
  });

  it('orders requirements by their feature\'s position in about, ahead of natural id', () => {
    const about: Record<string, AboutFeature> = {
      login: { title: 'Logging in', body: '' },
      checkout: { title: 'Checking out', body: '' },
    };
    const features = new Map([
      ['FR-CHECKOUT-1', ['checkout']],
      ['FR-LOGIN-1', ['login']],
    ]);
    // 'FR-CHECKOUT-1' sorts first naturally, but 'login' is declared before 'checkout' in about.
    expect(computeRequirementOrder(['FR-CHECKOUT-1', 'FR-LOGIN-1'], features, about)).toEqual(['FR-LOGIN-1', 'FR-CHECKOUT-1']);
  });

  it('sorts requirements sharing a feature naturally by id', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: '' } };
    const features = new Map([
      ['FR-LOGIN-10', ['login']],
      ['FR-LOGIN-2', ['login']],
    ]);
    expect(computeRequirementOrder(['FR-LOGIN-10', 'FR-LOGIN-2'], features, about)).toEqual(['FR-LOGIN-2', 'FR-LOGIN-10']);
  });

  it('sorts a requirement with no matching feature after every featured requirement', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: '' } };
    const features = new Map([
      ['FR-OTHER-1', []],
      ['FR-LOGIN-1', ['login']],
    ]);
    expect(computeRequirementOrder(['FR-OTHER-1', 'FR-LOGIN-1'], features, about)).toEqual(['FR-LOGIN-1', 'FR-OTHER-1']);
  });

  it('treats a feature id absent from about as unfeatured, rather than erroring', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: '' } };
    const features = new Map([
      ['FR-GHOST-1', ['not-a-real-feature']],
      ['FR-LOGIN-1', ['login']],
    ]);
    expect(computeRequirementOrder(['FR-GHOST-1', 'FR-LOGIN-1'], features, about)).toEqual(['FR-LOGIN-1', 'FR-GHOST-1']);
  });
});

// ── collectRequirementFeatures ───────────────────────────────────────────────

describe('collectRequirementFeatures', () => {
  it('reads features from an object-form requirements map entry', () => {
    const result = collectRequirementFeatures([], { 'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] } });
    expect(result.get('FR-LOGIN-1')).toEqual(['login']);
  });

  it('defaults a bare string map entry to no features', () => {
    const result = collectRequirementFeatures([], { 'FR-LOGIN-1': 'Users can log in' });
    expect(result.get('FR-LOGIN-1')).toEqual([]);
  });

  it('includes a requirement referenced only by a test\'s tags and missing from the map', () => {
    const test: TestRecord = { ...passingTest, requirements: [{ id: 'FR-LOGIN-1', description: 'Users can log in', features: ['login'] }] };
    const result = collectRequirementFeatures([test], undefined);
    expect(result.get('FR-LOGIN-1')).toEqual(['login']);
  });

  it('prefers the map\'s features over a test\'s when a requirement id appears in both', () => {
    const test: TestRecord = { ...passingTest, requirements: [{ id: 'FR-LOGIN-1', description: 'x', features: ['from-test'] }] };
    const result = collectRequirementFeatures([test], { 'FR-LOGIN-1': { description: 'x', features: ['from-map'] } });
    expect(result.get('FR-LOGIN-1')).toEqual(['from-map']);
  });
});

// ── computeRollupStatus ──────────────────────────────────────────────────────

describe('computeRollupStatus', () => {
  it('returns missed when no test covers the requirement', () => {
    expect(computeRollupStatus([])).toBe('missed');
  });

  it('returns pass when every covering test passed', () => {
    expect(computeRollupStatus([{ status: 'pass' }])).toBe('pass');
  });

  it('returns fail when any covering test failed', () => {
    expect(computeRollupStatus([
      { status: 'pass' },
      { status: 'fail' },
    ])).toBe('fail');
  });

  it('returns skipped when every covering test was skipped', () => {
    expect(computeRollupStatus([{ status: 'skipped' }])).toBe('skipped');
  });

  it('prioritizes fail over an otherwise-skipped set', () => {
    expect(computeRollupStatus([
      { status: 'skipped' },
      { status: 'fail' },
    ])).toBe('fail');
  });

  it('returns flaky when no test failed but at least one needed a retry to pass', () => {
    expect(computeRollupStatus([
      { status: 'pass' },
      { status: 'flaky' },
    ])).toBe('flaky');
  });

  it('prioritizes fail over a flaky covering test', () => {
    expect(computeRollupStatus([
      { status: 'flaky' },
      { status: 'fail' },
    ])).toBe('fail');
  });
});

// ── normalizeRequirementInput ────────────────────────────────────────────────

describe('normalizeRequirementInput', () => {
  it('treats a bare string as a description with no features', () => {
    expect(normalizeRequirementInput('Users can log in')).toEqual({
      description: 'Users can log in',
      features: [],
    });
  });

  it('reads description and features from an object entry', () => {
    expect(normalizeRequirementInput({ description: 'Users can log in', features: ['login'] })).toEqual({
      description: 'Users can log in',
      features: ['login'],
    });
  });

  it('defaults features to an empty array when an object entry omits it', () => {
    expect(normalizeRequirementInput({ description: 'Users can log in' })).toEqual({
      description: 'Users can log in',
      features: [],
    });
  });
});

// ── renderTraceabilityMatrix ──────────────────────────────────────────────────

describe('renderTraceabilityMatrix', () => {
  it('returns an empty string when there are no requirements', () => {
    expect(renderTraceabilityMatrix([], undefined, undefined, undefined)).toBe('');
  });

  it('lists a requirement from the map with no covering test as missed', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined, undefined);
    expect(html).toContain('Requirements Traceability Matrix');
    expect(html).toContain('FR-LOGIN-1');
    expect(html).toContain('No test covers this requirement');
    expect(html).toContain('MISSED');
  });

  it('styles the requirement id as an id-tag', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined, undefined);
    expect(html).toContain('class="id-tag"');
    expect(html).toContain('>FR-LOGIN-1</td>');
  });

  it('places "Proven by" and the test list in a second real row, sharing the row with the requirement\'s own row rather than a guessed offset', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined, undefined);
    expect(html).toContain('class="detail-label"');
    expect(html).toContain('>Proven by</td>');
  });

  it('spans the Result badge across both of a requirement\'s rows', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined, undefined);
    expect(html).toContain('rowspan="2"');
  });

  it('wraps each requirement\'s two rows in their own tbody, to keep them together across a page break', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined, undefined);
    expect(html).toContain('class="requirement-group"');
  });

  it('capitalizes the first letter of the requirement description', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'users can log in' }, undefined, undefined);
    expect(html).toContain('Users can log in');
  });

  it('lists the covering test and rolled-up status for a requirement proven by a test', () => {
    const test: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], { 'FR-LOGIN-1': 'Users can log in with valid credentials' }, undefined, undefined);
    expect(html).toContain('User can log in');
    expect(html).toContain('PASS');
  });

  it('capitalizes the first letter of a covering test\'s title', () => {
    const test: TestRecord = { ...passingTest, title: 'user can log in', requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined, undefined);
    expect(html).toContain('User can log in');
  });

  it('includes a requirement referenced only by a test tag and missing from the map', () => {
    const test: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined, undefined);
    expect(html).toContain('FR-LOGIN-1');
  });

  it('sorts requirement rows using natural numeric ordering', () => {
    const html = renderTraceabilityMatrix([], {
      'FR-CHANNEL-10': 'Tenth',
      'FR-CHANNEL-2': 'Second',
    }, undefined, undefined);
    expect(html.indexOf('FR-CHANNEL-2')).toBeLessThan(html.indexOf('FR-CHANNEL-10'));
  });

  it('escapes special characters in the requirement id and description', () => {
    const html = renderTraceabilityMatrix([], { '<b>FR-1</b>': '<script>alert(1)</script>' }, undefined, undefined);
    expect(html).toContain('&lt;b&gt;FR-1&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('escapes special characters in a covering test title', () => {
    const test: TestRecord = { ...passingTest, title: '<script>alert(1)</script>', requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined, undefined);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('rolls up FAIL when one of two covering tests fails', () => {
    const passing: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const failing: TestRecord = { ...failingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([passing, failing], { 'FR-LOGIN-1': 'Users can log in' }, undefined, undefined);
    expect(html).toContain('>FAIL<');
    expect(html).toContain('User can log in');
    expect(html).toContain('Form submits data');
  });

  it('colors each covering test\'s (PASS)/(FAIL) to match its actual status', () => {
    const passing: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const failing: TestRecord = { ...failingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([passing, failing], { 'FR-LOGIN-1': 'Users can log in' }, undefined, undefined);
    expect(html).toContain('<span class="badge-pass">(PASS)</span>');
    expect(html).toContain('<span class="badge-fail">(FAIL)</span>');
  });

  it('shows the covering test\'s test-id, styled as an id-tag, ahead of its title', () => {
    const test: TestRecord = { ...passingTest, testId: 'TC-LOGIN-1', requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined, undefined);
    expect(html).toContain('<span class="id-tag">TC-LOGIN-1</span>');
    expect(html.indexOf('TC-LOGIN-1')).toBeLessThan(html.indexOf('User can log in'));
  });

  it('shows no page reference in html mode', () => {
    const test: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined, undefined);
    expect(html).not.toContain('p. ');
  });

  it('links a resolved page reference to the covering test\'s section', () => {
    const test: TestRecord = { ...passingTest, requirements: [requirementLogin] };
    const html = renderTraceabilityMatrix([test], undefined, undefined, new Map([['test-1', 5]]));
    expect(html).toContain('p. <a href="#test-1">5</a>');
  });

  it('reserves a wider page-number placeholder for a screenshot-heavy suite than test count alone would imply', () => {
    // A single test with many evidenceSteps can span far more pages than one
    // test "counts" as — the reserved width must account for that, not just
    // the number of tests.
    const shortTest: TestRecord = { ...passingTest, requirements: [requirementLogin], steps: [setupStep] };
    const longTest: TestRecord = { ...passingTest, requirements: [requirementLogin], steps: Array(95).fill(setupStep) };

    const shortHtml = renderTraceabilityMatrix([shortTest], { 'FR-LOGIN-1': 'Users can log in' }, undefined, 'reserve');
    const longHtml = renderTraceabilityMatrix([longTest], { 'FR-LOGIN-1': 'Users can log in' }, undefined, 'reserve');

    const shortWidth = Number(shortHtml.match(/min-width:(\d+)ch/)![1]);
    const longWidth = Number(longHtml.match(/min-width:(\d+)ch/)![1]);

    expect(longWidth).toBeGreaterThan(shortWidth);
  });

  it('id anchors the section for the Table of Contents to link to', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined, undefined);
    expect(html).toContain('id="requirements-matrix"');
  });

  it('id anchors each requirement row, so an About feature can link back to it', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined, undefined);
    expect(html).toContain('id="requirement-FR-LOGIN-1"');
  });

  it('embeds an invisible page marker in reserve mode', () => {
    const html = renderTraceabilityMatrix([], { 'FR-LOGIN-1': 'Users can log in' }, undefined, 'reserve');
    expect(html).toContain('[[page:requirements-matrix]]');
  });

  describe('feature cross-reference', () => {
    const aboutLogin: Record<string, AboutFeature> = {
      login: { title: 'Logging in', body: 'Users can sign in.' },
    };

    it('links a requirement\'s feature to its About entry when about is provided', () => {
      const html = renderTraceabilityMatrix(
        [],
        { 'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] } },
        aboutLogin,
        undefined,
      );
      expect(html).toContain('<a href="#about-login">Logging in</a>');
    });

    it('renders no feature reference when about is not provided', () => {
      const html = renderTraceabilityMatrix(
        [],
        { 'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] } },
        undefined,
        undefined,
      );
      expect(html).not.toContain('href="#about-login"');
    });

    it('skips a feature ID with no matching about entry, rather than rendering a broken link', () => {
      const html = renderTraceabilityMatrix(
        [],
        { 'FR-LOGIN-1': { description: 'Users can log in', features: ['not-a-real-feature'] } },
        aboutLogin,
        undefined,
      );
      expect(html).not.toContain('href="#about-not-a-real-feature"');
    });

    it('renders no feature reference when the requirement declares no features', () => {
      const html = renderTraceabilityMatrix(
        [],
        { 'FR-LOGIN-1': 'Users can log in' },
        aboutLogin,
        undefined,
      );
      expect(html).not.toContain('href="#about-');
    });

    it('keeps the feature reference inline with the description, not a separate labeled block', () => {
      const html = renderTraceabilityMatrix(
        [],
        { 'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] } },
        aboutLogin,
        undefined,
      );
      expect(html).not.toContain('>Feature<');
      expect(html).toContain('Users can log in <span style="color:#888;font-size:11px;">');
    });

    it('joins multiple features with a comma', () => {
      const about: Record<string, AboutFeature> = {
        login: { title: 'Logging in', body: '...' },
        logout: { title: 'Logging out', body: '...' },
      };
      const html = renderTraceabilityMatrix(
        [],
        { 'FR-LOGIN-1': { description: 'Users can log in and out', features: ['login', 'logout'] } },
        about,
        undefined,
      );
      expect(html).toContain('<a href="#about-login">Logging in</a>, <a href="#about-logout">Logging out</a>');
    });

    it('links a resolved page reference for the feature', () => {
      const html = renderTraceabilityMatrix(
        [],
        { 'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] } },
        aboutLogin,
        new Map([['about-login', 3]]),
      );
      expect(html).toContain('p. <a href="#about-login">3</a>');
    });
  });
});

// ── renderAboutSection ───────────────────────────────────────────────────────

describe('renderAboutSection', () => {
  it('returns an empty string when about is undefined', () => {
    expect(renderAboutSection(undefined, undefined, [], undefined)).toBe('');
  });

  it('returns an empty string when about is empty', () => {
    expect(renderAboutSection({}, undefined, [], undefined)).toBe('');
  });

  it('renders the feature title as an h2', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: 'Some prose.' } };
    const html = renderAboutSection(about, undefined, [], undefined);
    expect(html).toContain('<h2>Logging in</h2>');
  });

  it('anchors each feature by ID, in the order given', () => {
    const about: Record<string, AboutFeature> = {
      login: { title: 'Logging in', body: '...' },
      logout: { title: 'Logging out', body: '...' },
    };
    const html = renderAboutSection(about, undefined, [], undefined);
    expect(html).toContain('id="about-login"');
    expect(html.indexOf('id="about-login"')).toBeLessThan(html.indexOf('id="about-logout"'));
  });

  it('renders Markdown bold as <strong>', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: 'Enter your **password**.' } };
    const html = renderAboutSection(about, undefined, [], undefined);
    expect(html).toContain('<strong>password</strong>');
  });

  it('renders each blank-line-separated paragraph as its own <p>', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: 'First paragraph.\n\nSecond paragraph.' } };
    const html = renderAboutSection(about, undefined, [], undefined);
    expect(html).toContain('<p>First paragraph.</p>');
    expect(html).toContain('<p>Second paragraph.</p>');
  });

  it('escapes raw HTML embedded in the body instead of passing it through', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: 'Text with <script>alert(1)</script> in it.' } };
    const html = renderAboutSection(about, undefined, [], undefined);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('rolls up MISSED when no test covers any requirement under the feature', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: '...' } };
    const html = renderAboutSection(about, undefined, [], undefined);
    expect(html).toContain('>MISSED<');
  });

  it('rolls up the feature status from tests whose matched requirements list that feature', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: '...' } };
    const test: TestRecord = {
      ...passingTest,
      requirements: [{ id: 'FR-LOGIN-1', description: 'Users can log in', features: ['login'] }],
    };
    const html = renderAboutSection(about, undefined, [test], undefined);
    expect(html).toContain('>PASS<');
  });

  it('rolls up FAIL when any covering test fails, even if others pass', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: '...' } };
    const passing: TestRecord = {
      ...passingTest,
      requirements: [{ id: 'FR-LOGIN-1', description: 'Users can log in', features: ['login'] }],
    };
    const failing: TestRecord = {
      ...failingTest,
      requirements: [{ id: 'FR-LOGIN-2', description: 'Users can log out', features: ['login'] }],
    };
    const html = renderAboutSection(about, undefined, [passing, failing], undefined);
    expect(html).toContain('>FAIL<');
  });

  it('ignores a test whose requirements don\'t list this feature', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: '...' } };
    const unrelated: TestRecord = {
      ...failingTest,
      requirements: [{ id: 'FR-OTHER-1', description: 'Something else', features: ['other'] }],
    };
    const html = renderAboutSection(about, undefined, [unrelated], undefined);
    expect(html).toContain('>MISSED<');
  });

  it('embeds an invisible page marker in reserve mode', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: '...' } };
    const html = renderAboutSection(about, undefined, [], 'reserve');
    expect(html).toContain('[[page:about-login]]');
  });

  it('wraps every feature in one shared section, not one section per feature', () => {
    const about: Record<string, AboutFeature> = {
      login: { title: 'Logging in', body: '...' },
      logout: { title: 'Logging out', body: '...' },
    };
    const html = renderAboutSection(about, undefined, [], undefined);
    expect((html.match(/class="section"/g) ?? []).length).toBe(1);
  });

  it('forces a fresh page after the whole About section, so the Traceability Matrix doesn\'t share its last page', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: '...' } };
    const html = renderAboutSection(about, undefined, [], undefined);
    expect(html).toContain('page-break-after:always');
  });

  describe('requirements cross-reference', () => {
    const aboutLogin: Record<string, AboutFeature> = { login: { title: 'Logging in', body: '...' } };

    it('lists the requirements that point to this feature, linked to their Matrix row', () => {
      const requirementsMap = { 'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] } };
      const html = renderAboutSection(aboutLogin, requirementsMap, [], undefined);
      expect(html).toContain('<a href="#requirement-FR-LOGIN-1">FR-LOGIN-1</a>');
      expect(html).toContain('Users can log in');
    });

    it('sorts listed requirements naturally by id', () => {
      const requirementsMap = {
        'FR-LOGIN-10': { description: 'Tenth', features: ['login'] },
        'FR-LOGIN-2': { description: 'Second', features: ['login'] },
      };
      const html = renderAboutSection(aboutLogin, requirementsMap, [], undefined);
      expect(html.indexOf('FR-LOGIN-2')).toBeLessThan(html.indexOf('FR-LOGIN-10'));
    });

    it('excludes a requirement that doesn\'t declare this feature', () => {
      const requirementsMap = { 'FR-OTHER-1': { description: 'Something else', features: ['other'] } };
      const html = renderAboutSection(aboutLogin, requirementsMap, [], undefined);
      expect(html).not.toContain('FR-OTHER-1');
    });

    it('shows a placeholder when no requirement points to this feature', () => {
      const html = renderAboutSection(aboutLogin, undefined, [], undefined);
      expect(html).toContain('No requirements are tied to this feature yet.');
    });

    it('links a resolved page reference for each listed requirement', () => {
      const requirementsMap = { 'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] } };
      const html = renderAboutSection(aboutLogin, requirementsMap, [], new Map([['requirement-FR-LOGIN-1', 4]]));
      expect(html).toContain('p. <a href="#requirement-FR-LOGIN-1">4</a>');
    });
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

  it('renders the table of contents, then the traceability matrix, then the test sections, then the test case index last', () => {
    const html = renderReport('R', [passingTest], new Date(), { 'FR-LOGIN-1': 'Users can log in' });
    expect(html).toContain('<h2>Requirements Traceability Matrix</h2>');
    expect(html.indexOf('<h2>Table of Contents</h2>')).toBeLessThan(html.indexOf('<h2>Requirements Traceability Matrix</h2>'));
    expect(html.indexOf('<h2>Requirements Traceability Matrix</h2>')).toBeLessThan(html.indexOf(`<h2>${upperFirst(passingTest.title)}</h2>`));
    expect(html.indexOf(`<h2>${upperFirst(passingTest.title)}</h2>`)).toBeLessThan(html.indexOf('<h2>Test Case Index</h2>'));
  });

  it('does not render a standalone Test Results heading — the Table of Contents links straight to the first test', () => {
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
    const html = renderReport('R', [test], new Date(), { 'FR-LOGIN-1': 'Users can log in' }, undefined, undefined, pageNumbers);
    expect(html).toContain('<th>Page</th>');
    expect(html).not.toContain('[[page:');
    // Table of Contents' "Test Results" row links to the first test's resolved page.
    expect(html).toContain('<a href="#test-1">Test Results</a>');
    expect(html).toContain('<a href="#test-1">5</a>');
  });

  it('orders both the Test Case Index and the test sections by test-id, so a row and its page always match', () => {
    const testC: TestRecord = { ...passingTest, title: 'Runs third', testId: 'TC-LOGIN-10' };
    const testA: TestRecord = { ...passingTest, title: 'Runs first', testId: 'TC-LOGIN-1' };
    const testB: TestRecord = { ...passingTest, title: 'Runs second', testId: 'TC-LOGIN-2' };
    const html = renderReport('R', [testC, testA, testB], new Date());

    // Test Case Index rows read top-to-bottom in id order. The index is
    // rendered after every test section, so its content starts at the last
    // occurrence of the heading rather than the first (each test title is
    // also mentioned once per index row).
    const indexSection = html.slice(html.lastIndexOf('Test Case Index'));
    expect(indexSection.indexOf('TC-LOGIN-1')).toBeLessThan(indexSection.indexOf('TC-LOGIN-2'));
    expect(indexSection.indexOf('TC-LOGIN-2')).toBeLessThan(indexSection.indexOf('TC-LOGIN-10'));

    // The physical sections (their <h2> headings) follow the same order, not
    // the original array order — checked via <h2> since the index also
    // mentions each title, just not wrapped in a heading tag.
    expect(html.indexOf('<h2>Runs first</h2>')).toBeLessThan(html.indexOf('<h2>Runs second</h2>'));
    expect(html.indexOf('<h2>Runs second</h2>')).toBeLessThan(html.indexOf('<h2>Runs third</h2>'));

    // Each index row's link lands on the section that actually carries its id.
    expect(html).toContain('<td class="id-tag">TC-LOGIN-1</td>\n        <td><a href="#test-1">Runs first</a>');
  });

  it('appends tests with no test-id after all id-carrying tests, in their original relative order', () => {
    const withId: TestRecord = { ...passingTest, title: 'Has an id', testId: 'TC-LOGIN-1' };
    const noIdFirst: TestRecord = { ...passingTest, title: 'No id, ran first', testId: null };
    const noIdSecond: TestRecord = { ...passingTest, title: 'No id, ran second', testId: null };
    const html = renderReport('R', [noIdFirst, noIdSecond, withId], new Date());

    expect(html.indexOf('Has an id')).toBeLessThan(html.indexOf('No id, ran first'));
    expect(html.indexOf('No id, ran first')).toBeLessThan(html.indexOf('No id, ran second'));
  });

  describe('feature-first ordering', () => {
    const about: Record<string, AboutFeature> = {
      login: { title: 'Logging in', body: 'Users can sign in.' },
      checkout: { title: 'Checking out', body: 'Users can buy things.' },
    };
    const requirements = {
      'FR-CHECKOUT-1': { description: 'Users can check out', features: ['checkout'] },
      'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] },
    };

    it('orders a test by its feature\'s position in about, ahead of its own test-id', () => {
      // Test-id order alone (TC-A-1 before TC-Z-9) would put checkoutTest first;
      // 'login' is declared before 'checkout' in `about`, so loginTest should win instead.
      const checkoutTest: TestRecord = {
        ...passingTest,
        title: 'Checkout works',
        testId: 'TC-A-1',
        requirements: [{ id: 'FR-CHECKOUT-1', description: 'Users can check out', features: ['checkout'] }],
      };
      const loginTest: TestRecord = {
        ...passingTest,
        title: 'Login works',
        testId: 'TC-Z-9',
        requirements: [{ id: 'FR-LOGIN-1', description: 'Users can log in', features: ['login'] }],
      };
      const html = renderReport('R', [checkoutTest, loginTest], new Date(), requirements, about);
      expect(html.indexOf('<h2>Login works</h2>')).toBeLessThan(html.indexOf('<h2>Checkout works</h2>'));
    });

    it('orders the Traceability Matrix rows the same way as the tests that prove them', () => {
      const html = renderReport('R', [], new Date(), requirements, about);
      expect(html.indexOf('id="requirement-FR-LOGIN-1"')).toBeLessThan(html.indexOf('id="requirement-FR-CHECKOUT-1"'));
    });

    it('ranks a test proving any requirement ahead of one proving none, even if the latter\'s test-id sorts first', () => {
      const provesRequirement: TestRecord = {
        ...passingTest,
        title: 'Proves a requirement',
        testId: 'TC-Z-1',
        requirements: [{ id: 'FR-LOGIN-1', description: 'Users can log in', features: ['login'] }],
      };
      const provesNothing: TestRecord = { ...passingTest, title: 'Proves nothing', testId: 'TC-A-1' };
      const html = renderReport('R', [provesNothing, provesRequirement], new Date(), requirements, about);
      expect(html.indexOf('<h2>Proves a requirement</h2>')).toBeLessThan(html.indexOf('<h2>Proves nothing</h2>'));
    });

    it('falls back to test-id order for two tests tied on the same requirement rank', () => {
      const second: TestRecord = {
        ...passingTest,
        title: 'Runs second',
        testId: 'TC-LOGIN-2',
        requirements: [{ id: 'FR-LOGIN-1', description: 'Users can log in', features: ['login'] }],
      };
      const first: TestRecord = {
        ...passingTest,
        title: 'Runs first',
        testId: 'TC-LOGIN-1',
        requirements: [{ id: 'FR-LOGIN-1', description: 'Users can log in', features: ['login'] }],
      };
      const html = renderReport('R', [second, first], new Date(), requirements, about);
      expect(html.indexOf('<h2>Runs first</h2>')).toBeLessThan(html.indexOf('<h2>Runs second</h2>'));
    });

    it('is unaffected when requirements/about are omitted — falls back to plain test-id order', () => {
      const testC: TestRecord = { ...passingTest, title: 'Runs third', testId: 'TC-LOGIN-10' };
      const testA: TestRecord = { ...passingTest, title: 'Runs first', testId: 'TC-LOGIN-1' };
      const html = renderReport('R', [testC, testA], new Date());
      expect(html.indexOf('<h2>Runs first</h2>')).toBeLessThan(html.indexOf('<h2>Runs third</h2>'));
    });
  });

  describe('about', () => {
    const about: Record<string, AboutFeature> = { login: { title: 'Logging in', body: 'Some prose.' } };

    it('renders the About section after the Table of Contents, which always follows the cover directly', () => {
      const html = renderReport('R', [], new Date(), undefined, about);
      expect(html.indexOf('<h1>R</h1>')).toBeLessThan(html.indexOf('<h2>Table of Contents</h2>'));
      expect(html.indexOf('<h2>Table of Contents</h2>')).toBeLessThan(html.indexOf('<h2>Logging in</h2>'));
    });

    it('lists About in the Table of Contents, linked to the first feature, only when about is provided', () => {
      const withAbout = renderReport('R', [], new Date(), undefined, about);
      const withoutAbout = renderReport('R', [], new Date());
      expect(withAbout).toContain('<a href="#about-login">About</a>');
      expect(withoutAbout).not.toContain('>About<');
    });

    it('renders no About section when about is omitted — existing reports are unaffected', () => {
      const html = renderReport('R', [passingTest], new Date(), { 'FR-LOGIN-1': 'Users can log in' });
      expect(html).not.toContain('<h2>Logging in</h2>');
      expect(html).not.toContain('id="about-');
    });
  });

  describe('overview', () => {
    it('renders the overview on the cover, between the run date and the pass/fail summary', () => {
      const html = renderReport('R', [], new Date(), undefined, undefined, 'Some **overview** prose.');
      expect(html).toContain('<div class="overview">');
      expect(html).toContain('<p>Some <strong>overview</strong> prose.</p>');
      expect(html.indexOf('class="meta"')).toBeLessThan(html.indexOf('class="overview"'));
      expect(html.indexOf('class="overview"')).toBeLessThan(html.indexOf('class="summary-box'));
    });

    it('renders no overview block when omitted — existing reports are unaffected', () => {
      const html = renderReport('R', [], new Date());
      expect(html).not.toContain('class="overview"');
    });

    it('escapes raw HTML embedded in the overview instead of passing it through', () => {
      const html = renderReport('R', [], new Date(), undefined, undefined, 'Text with <script>alert(1)</script> in it.');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });
});
