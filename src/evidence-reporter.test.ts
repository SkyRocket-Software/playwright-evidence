import fs from 'fs';
import path from 'path';
import os from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Playwright mock ───────────────────────────────────────────────────────────
//
// Mocks 'playwright' so PDF wiring can be tested without a real browser. Reads
// back whichever HTML mockGoto just loaded, so tests can assert on the actual
// rendered content of either print pass.
const loadedHtmlByCall: string[] = [];

// Writes a dummy file — resolvePageNumbers reads the draft PDF back off disk
// before pdfjs-dist (also mocked, below) ever parses it, so the file just needs to exist.
const mockPdf = vi.fn(async (opts: { path: string; [key: string]: unknown }) => {
  fs.writeFileSync(opts.path, 'fake-pdf-bytes');
});
const mockGoto = vi.fn(async (url: string) => {
  loadedHtmlByCall.push(fs.readFileSync(url.replace('file://', ''), 'utf8'));
});
const mockPage = { goto: mockGoto, pdf: mockPdf };
const mockNewPage = vi.fn().mockResolvedValue(mockPage);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockBrowser = { newPage: mockNewPage, close: mockClose };
const mockLaunch = vi.fn().mockResolvedValue(mockBrowser);

vi.mock('playwright-core', () => ({
  chromium: { launch: mockLaunch },
}));

// ── pdfjs-dist mock ────────────────────────────────────────────────────────────
//
// Avoids needing a byte-real PDF fixture. Defaults to a zero-page document (no
// markers resolved); the "page numbers" tests below override
// `mockDocument`/`mockGetPage` to exercise real marker-to-page resolution.
const mockDocument: { numPages: number } = { numPages: 0 };
const mockGetPage = vi.fn();
const mockLoadingTaskDestroy = vi.fn().mockResolvedValue(undefined);
const mockGetDocument = vi.fn(() => ({
  promise: Promise.resolve({ numPages: mockDocument.numPages, getPage: mockGetPage }),
  destroy: mockLoadingTaskDestroy,
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mockGetDocument,
}));

// Dynamic import so the vi.mock calls above take effect first.
const { default: EvidenceReporter, formatTimestamp } = await import('./evidence-reporter.ts');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Fixed instant so the timestamp portion of filenames is deterministic. The run
// also gets a random suffix, so tests match filenames by pattern rather than
// predicting them exactly — see `findMatch` below.
const fixedNow = new Date(2026, 6, 24, 14, 30, 5);

const fullResult = {
  status: 'passed',
  startTime: fixedNow,
  duration: 0,
} as const;

/** Matches `<base>-<8 digit date>-<6 digit time>Z-<6 char random suffix>.<ext>`. */
function suffixedPattern(base: string, ext: string): RegExp {
  return new RegExp(`^${base}-\\d{8}-\\d{6}Z-[0-9a-z]{6}\\.${ext}$`);
}

/** Finds the single file in `dir` matching `pattern`, failing the test if there isn't exactly one. */
function findMatch(dir: string, pattern: RegExp): string {
  const matches = fs.readdirSync(dir).filter((name) => pattern.test(name));
  expect(matches, `expected exactly one file matching ${pattern} in ${dir}, found: ${matches.join(', ')}`).toHaveLength(1);
  return path.join(dir, matches[0]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('formats a UTC date as YYYYMMDD-HHmmssZ', () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 6, 24, 14, 30, 5)))).toBe('20260724-143005Z');
  });

  it('zero-pads single-digit month, day, hour, minute, and second', () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 0, 5, 3, 2, 1)))).toBe('20260105-030201Z');
  });

  it('uses UTC rather than local time, so DST or timezone can not shift the date', () => {
    // Pacific/Kiritimati is UTC+14 — far enough that this instant's UTC date
    // (Jan 1) and local date (Jan 2) fall on different calendar days. If
    // formatTimestamp used local getters instead of UTC ones, this would
    // read '20260102' instead.
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      const date = new Date(Date.UTC(2026, 0, 1, 23, 30, 0));
      expect(formatTimestamp(date)).toBe('20260101-233000Z');
    } finally {
      process.env.TZ = originalTZ;
    }
  });

  it('marks the timestamp as UTC with a trailing Z, so it is not misread as local time', () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 6, 24, 14, 30, 5)))).toMatch(/Z$/);
  });
});

describe('EvidenceReporter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    loadedHtmlByCall.length = 0;
    mockDocument.numPages = 0;
    mockGetPage.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── HTML mode ───────────────────────────────────────────────────────────────

  describe('html mode (default)', () => {
    it('writes evidence-report-<timestamp>-<suffix>.html when no file option is set', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'evidence-report.html') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      findMatch(tmpDir, suffixedPattern('evidence-report', 'html'));
    });

    it('writes HTML to the configured file path with a timestamp and random suffix appended', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'custom-report.html') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      findMatch(tmpDir, suffixedPattern('custom-report', 'html'));
    });

    it('creates parent directories that do not exist', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'nested', 'dir', 'report.html') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      findMatch(path.join(tmpDir, 'nested', 'dir'), suffixedPattern('report', 'html'));
    });

    it('writes valid HTML content', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html'), title: 'My Evidence' });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('<!DOCTYPE html>');
      expect(content).toContain('My Evidence');
    });

    it('does not launch a browser', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it('explicit output: html does not launch a browser', async () => {
      const reporter = new EvidenceReporter({ output: 'html', file: path.join(tmpDir, 'report.html') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    describe('latest option', () => {
      it('writes to the exact configured path, with no timestamp or suffix', async () => {
        const outFile = path.join(tmpDir, 'report.html');
        const reporter = new EvidenceReporter({ file: outFile, latest: true });
        reporter.onBegin({} as never, {} as never);
        await reporter.onEnd(fullResult);
        expect(fs.existsSync(outFile)).toBe(true);
        expect(fs.readdirSync(tmpDir)).toEqual(['report.html']);
      });

      it('defaults to evidence-report.html with no file option set', async () => {
        const originalCwd = process.cwd();
        process.chdir(tmpDir);
        try {
          const reporter = new EvidenceReporter({ latest: true });
          reporter.onBegin({} as never, {} as never);
          await reporter.onEnd(fullResult);
          expect(fs.existsSync(path.join(tmpDir, 'evidence-report.html'))).toBe(true);
        } finally {
          process.chdir(originalCwd);
        }
      });

      it('overwrites the same file on a second run, unlike the default timestamped behaviour', async () => {
        const outFile = path.join(tmpDir, 'report.html');

        const firstReporter = new EvidenceReporter({ file: outFile, latest: true, title: 'First run' });
        firstReporter.onBegin({} as never, {} as never);
        await firstReporter.onEnd(fullResult);
        expect(fs.readFileSync(outFile, 'utf8')).toContain('First run');

        const secondReporter = new EvidenceReporter({ file: outFile, latest: true, title: 'Second run' });
        secondReporter.onBegin({} as never, {} as never);
        await secondReporter.onEnd(fullResult);
        expect(fs.readFileSync(outFile, 'utf8')).toContain('Second run');

        // Still exactly one file — the second run replaced the first rather than adding to it.
        expect(fs.readdirSync(tmpDir)).toEqual(['report.html']);
      });
    });
  });

  // ── PDF mode ────────────────────────────────────────────────────────────────

  describe('pdf mode', () => {
    it('launches a headless browser', async () => {
      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      expect(mockLaunch).toHaveBeenCalledOnce();
    });

    it('writes the PDF to the configured file path with a timestamp and random suffix appended', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');
      const reporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      // The final (second) pass writes to the real configured path — the
      // first pass is a throwaway draft used only to resolve page numbers.
      const { path: actualPath } = mockPdf.mock.calls.at(-1)![0];
      expect(path.dirname(actualPath)).toBe(path.resolve(tmpDir));
      expect(path.basename(actualPath)).toMatch(suffixedPattern('report', 'pdf'));
    });

    it('defaults PDF path to evidence-report-<timestamp>-<suffix>.pdf when no file is set', async () => {
      // resolveOutFile resolves the default filename against process.cwd() —
      // chdir into tmpDir first so the mock (which genuinely writes bytes to
      // whatever path it's given) doesn't leave a real file in the repo root.
      // Verified via findMatch (fs.readdirSync) rather than a string compare
      // against tmpDir, since process.cwd() returns the symlink-resolved path
      // on macOS (/private/tmp/... vs. tmpDir's /tmp/...) and a direct string
      // comparison would falsely fail despite the file landing in the right place.
      const originalCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const reporter = new EvidenceReporter({ output: 'pdf' });
        reporter.onBegin({} as never, {} as never);
        await reporter.onEnd(fullResult);
        findMatch(tmpDir, suffixedPattern('evidence-report', 'pdf'));
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('produces different filenames for two runs started at the exact same instant (e.g. parallel CI shards), so they do not overwrite each other', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');

      // Fixed system time for both runs — only the random suffix can disambiguate them.
      const firstReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      firstReporter.onBegin({} as never, {} as never);
      await firstReporter.onEnd(fullResult);
      const firstPath = mockPdf.mock.calls.at(-1)![0].path;

      const secondReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      secondReporter.onBegin({} as never, {} as never);
      await secondReporter.onEnd(fullResult);
      const secondPath = mockPdf.mock.calls.at(-1)![0].path;

      expect(firstPath).not.toBe(secondPath);
    });

    it('produces a different filename for a run started at a different time, so repeated runs do not overwrite each other', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');

      const firstReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      firstReporter.onBegin({} as never, {} as never);
      await firstReporter.onEnd(fullResult);
      const firstPath = mockPdf.mock.calls.at(-1)![0].path;

      vi.setSystemTime(new Date(2026, 6, 24, 14, 45, 0));
      const secondReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      secondReporter.onBegin({} as never, {} as never);
      await secondReporter.onEnd(fullResult);
      const secondPath = mockPdf.mock.calls.at(-1)![0].path;

      expect(firstPath).not.toBe(secondPath);
    });

    it('navigates to report.html inside the temp directory via file:// URL', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');
      const reporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      // The final (second) pass is the one that loads report.html — the
      // first pass loads the throwaway report-draft.html.
      const [gotoUrl] = mockGoto.mock.calls.at(-1)!;
      expect(gotoUrl).toMatch(/^file:\/\/.*evidence-screenshots-.*\/report\.html$/);
    });

    it('removes the temp directory (HTML + screenshots) after PDF is written', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');
      const reporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      const [[gotoUrl]] = mockGoto.mock.calls;
      const tempHtmlPath = gotoUrl.replace('file://', '');
      const tempDir = path.dirname(tempHtmlPath);
      expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('calls page.pdf() with A4 format and printBackground', async () => {
      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      expect(mockPdf).toHaveBeenCalledWith(expect.objectContaining({
        format: 'A4',
        printBackground: true,
      }));
    });

    it('enables header and footer display', async () => {
      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      expect(mockPdf).toHaveBeenCalledWith(expect.objectContaining({
        displayHeaderFooter: true,
      }));
    });

    it('includes the report title in the header template', async () => {
      const reporter = new EvidenceReporter({
        output: 'pdf',
        file: path.join(tmpDir, 'report.pdf'),
        title: 'My Custom Report',
      });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      const call = mockPdf.mock.calls[0][0];
      expect(call.headerTemplate).toContain('My Custom Report');
    });

    it('formats the run date in the header template as UTC, so it agrees with the filename timestamp', async () => {
      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      const call = mockPdf.mock.calls[0][0];
      expect(call.headerTemplate).toContain('UTC');
    });

    it('includes page number and total pages spans in the footer template', async () => {
      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      const call = mockPdf.mock.calls[0][0];
      expect(call.footerTemplate).toContain('class="pageNumber"');
      expect(call.footerTemplate).toContain('class="totalPages"');
    });

    it('closes the browser even if pdf() throws', async () => {
      mockPdf.mockRejectedValueOnce(new Error('render failed'));
      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      await expect(reporter.onEnd(fullResult)).rejects.toThrow('render failed');
      expect(mockClose).toHaveBeenCalledOnce();
    });

    describe('latest option', () => {
      it('calls page.pdf() with the exact configured path, no timestamp or suffix', async () => {
        const pdfFile = path.join(tmpDir, 'report.pdf');
        const reporter = new EvidenceReporter({ output: 'pdf', file: pdfFile, latest: true });
        reporter.onBegin({} as never, {} as never);
        await reporter.onEnd(fullResult);
        expect(mockPdf).toHaveBeenCalledWith(expect.objectContaining({ path: path.resolve(pdfFile) }));
      });

      it('resolves to the same path across two runs, unlike the default timestamped behaviour', async () => {
        const pdfFile = path.join(tmpDir, 'report.pdf');

        const firstReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile, latest: true });
        firstReporter.onBegin({} as never, {} as never);
        await firstReporter.onEnd(fullResult);
        const firstPath = mockPdf.mock.calls.at(-1)![0].path;

        vi.setSystemTime(new Date(2026, 6, 24, 14, 45, 0));
        const secondReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile, latest: true });
        secondReporter.onBegin({} as never, {} as never);
        await secondReporter.onEnd(fullResult);
        const secondPath = mockPdf.mock.calls.at(-1)![0].path;

        expect(firstPath).toBe(secondPath);
      });
    });
  });

  // ── page numbers ────────────────────────────────────────────────────────────

  describe('page numbers', () => {
    it('launches Chromium once and prints twice, closing the browser only after both passes', async () => {
      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      expect(mockLaunch).toHaveBeenCalledOnce();
      expect(mockPdf).toHaveBeenCalledTimes(2);
      expect(mockClose).toHaveBeenCalledOnce();
    });

    it('resolves marker positions from the draft PDF and substitutes them into the final pass', async () => {
      // Simulate the draft PDF landing the Test Case Index marker on page 1
      // and the test's own marker on page 2.
      mockDocument.numPages = 2;
      mockGetPage.mockImplementation((pageNumber: number) => Promise.resolve({
        getTextContent: () => Promise.resolve({
          items: [{ str: pageNumber === 1 ? '[[page:test-case-index]]' : '[[page:test-1]]' }],
        }),
      }));

      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(
        { title: 'Sample test', tags: [], annotations: [] } as never,
        { status: 'passed', errors: [], steps: [], attachments: [] } as never,
      );
      await reporter.onEnd(fullResult);

      const [draftHtml, finalHtml] = loadedHtmlByCall;
      expect(draftHtml).toContain('[[page:test-1]]');

      // The final (delivered) pass has no use for the markers once resolved.
      expect(finalHtml).not.toContain('[[page:');

      const indexSection = finalHtml.slice(finalHtml.indexOf('Test Case Index'));
      expect(indexSection).toContain('>2<');
    });

    it('resolves an empty map — and so renders blank page references — when the draft PDF has no pages', async () => {
      mockDocument.numPages = 0;

      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(
        { title: 'Sample test', tags: [], annotations: [] } as never,
        { status: 'passed', errors: [], steps: [], attachments: [] } as never,
      );
      await reporter.onEnd(fullResult);

      const [, finalHtml] = loadedHtmlByCall;
      expect(finalHtml).toContain('<th>Page</th>');
      expect(finalHtml).not.toContain('[[page:');
    });
  });

  // ── retries ──────────────────────────────────────────────────────────────────

  describe('retries', () => {
    it('replaces an earlier failing attempt with a later passing one, rather than reporting both', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      const testCase = { title: 'Flaky test', tags: [], annotations: [] } as never;
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(testCase, { status: 'failed', retry: 0, errors: [], steps: [], attachments: [] } as never);
      reporter.onTestEnd(testCase, { status: 'passed', retry: 1, errors: [], steps: [], attachments: [] } as never);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      // Exactly one test section (id="test-1") — no id="test-2" from a
      // duplicate second attempt. The title itself legitimately appears
      // twice by design (once in the Test Case Index, once as the section
      // heading), so counting title occurrences wouldn't detect a duplicate.
      expect(content).toContain('id="test-1"');
      expect(content).not.toContain('id="test-2"');
      expect(content).toContain('1 of 1 test passed');
    });

    it('marks a test that only passed on retry as flaky, not a plain pass', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      const testCase = { title: 'Flaky test', tags: [], annotations: [] } as never;
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(testCase, { status: 'failed', retry: 0, errors: [], steps: [], attachments: [] } as never);
      reporter.onTestEnd(testCase, { status: 'passed', retry: 1, errors: [], steps: [], attachments: [] } as never);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('class="badge badge-flaky"');
      expect(content).toContain('>FLAKY<');
    });

    it('reports a test that passes on the first attempt as a plain pass, not flaky', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      const testCase = { title: 'Solid test', tags: [], annotations: [] } as never;
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(testCase, { status: 'passed', retry: 0, errors: [], steps: [], attachments: [] } as never);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      // `.badge-flaky` always appears once as a CSS rule in the shared
      // stylesheet embedded on every page, regardless of whether any test
      // uses it — assert on the actual rendered badge markup instead.
      expect(content).not.toContain('class="badge badge-flaky"');
      expect(content).toContain('class="badge badge-pass"');
    });

    it('reports a test that still fails after exhausting retries as a single failure, not flaky', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      const testCase = { title: 'Always fails', tags: [], annotations: [] } as never;
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(testCase, { status: 'failed', retry: 0, errors: [], steps: [], attachments: [] } as never);
      reporter.onTestEnd(testCase, { status: 'failed', retry: 1, errors: [], steps: [], attachments: [] } as never);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('id="test-1"');
      expect(content).not.toContain('id="test-2"');
      expect(content).toContain('class="badge badge-fail"');
      expect(content).not.toContain('class="badge badge-flaky"');
    });

    it('keeps two distinct tests separate even though their result objects look alike', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(
        { title: 'Test A', tags: [], annotations: [] } as never,
        { status: 'passed', retry: 0, errors: [], steps: [], attachments: [] } as never,
      );
      reporter.onTestEnd(
        { title: 'Test B', tags: [], annotations: [] } as never,
        { status: 'passed', retry: 0, errors: [], steps: [], attachments: [] } as never,
      );
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('Test A');
      expect(content).toContain('Test B');
      expect(content).toContain('2 of 2 tests passed');
    });
  });

  // ── screenshot attribution ───────────────────────────────────────────────────

  describe('screenshot attribution', () => {
    it('pairs same-titled steps with their own attachment in encounter order, rather than both showing the first one', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(
        { title: 'Duplicate-titled steps', tags: [], annotations: [] } as never,
        {
          status: 'passed',
          retry: 0,
          errors: [],
          steps: [
            { category: 'test.step', title: 'Confirm the same thing', steps: [] },
            { category: 'test.step', title: 'Confirm the same thing', steps: [] },
          ],
          attachments: [
            { name: 'Confirm the same thing', contentType: 'image/png', body: Buffer.from('first') },
            { name: 'Confirm the same thing', contentType: 'image/png', body: Buffer.from('second') },
          ],
        } as never,
      );
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      const firstBase64 = Buffer.from('first').toString('base64');
      const secondBase64 = Buffer.from('second').toString('base64');
      expect(content).toContain(firstBase64);
      expect(content).toContain(secondBase64);
      expect(content.indexOf(firstBase64)).toBeLessThan(content.indexOf(secondBase64));
    });
  });

  // ── describe-block titles ────────────────────────────────────────────────────

  describe('describe-block titles', () => {
    const passingResult = { status: 'passed', retry: 0, errors: [], steps: [], attachments: [] } as never;

    it('renders the enclosing describe title as a label on the test\'s section', async () => {
      const fileSuite = { type: 'file', title: 'homepage.spec.ts', parent: undefined };
      const describeSuite = { type: 'describe', title: 'The homepage', parent: fileSuite };
      const testCase = { title: 'shows the hero heading', tags: [], annotations: [], parent: describeSuite } as never;

      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(testCase, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('<div class="describe-label">The homepage</div>');
    });

    it('joins nested describe blocks outermost-first', async () => {
      const fileSuite = { type: 'file', title: 'homepage.spec.ts', parent: undefined };
      const outerDescribe = { type: 'describe', title: 'The homepage', parent: fileSuite };
      const innerDescribe = { type: 'describe', title: 'the hero section', parent: outerDescribe };
      const testCase = { title: 'shows the heading', tags: [], annotations: [], parent: innerDescribe } as never;

      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(testCase, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('<div class="describe-label">The homepage › the hero section</div>');
    });

    it('renders no describe label for a test with no enclosing describe block', async () => {
      const fileSuite = { type: 'file', title: 'homepage.spec.ts', parent: undefined };
      const testCase = { title: 'shows the hero heading', tags: [], annotations: [], parent: fileSuite } as never;

      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(testCase, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      // '.describe-label' always appears once as a CSS rule in the shared
      // stylesheet embedded on every page — assert on the rendered element.
      expect(content).not.toContain('<div class="describe-label">');
    });
  });

  // ── requirements option ─────────────────────────────────────────────────────

  describe('requirements option', () => {
    const passingResult = { status: 'passed', errors: [], steps: [], attachments: [] } as never;

    it('lists a matched requirement under its test section, with full description text', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in with valid credentials' },
      });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1'], annotations: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('Requirements proven');
      expect(content).toContain('FR-LOGIN-1');
      expect(content).toContain('Users can log in with valid credentials');
    });

    it('strips a leading "@" from tags before matching against the requirements map', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1'], annotations: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('FR-LOGIN-1');
    });

    it('ignores tags with no matching entry in the requirements map', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Unrelated test', tags: ['@not-a-requirement'], annotations: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).not.toContain('Requirements proven');
    });

    it('renders the Requirements Traceability Matrix when requirements is set', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1'], annotations: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('Requirements Traceability Matrix');
    });

    it('renders no traceability matrix when requirements is omitted, matching pre-patch output', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login test', tags: [], annotations: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).not.toContain('Requirements Traceability Matrix');
      expect(content).not.toContain('Requirements proven');
    });

    it('lists every requirement matched by a test tagged with more than one requirement', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in', 'FR-LOGIN-2': 'Users can log out' },
      });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1', '@FR-LOGIN-2'], annotations: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('FR-LOGIN-1');
      expect(content).toContain('FR-LOGIN-2');
    });

    it('lists a duplicated tag only once, rather than repeating the requirement', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd(
        { title: 'Login test', tags: ['@FR-LOGIN-1', '@FR-LOGIN-1'], annotations: [] } as never,
        passingResult,
      );
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content.match(/FR-LOGIN-1/g)?.length).toBe(3); // once in the per-test list, once as the matrix row's anchor id, once as its visible ID cell
    });

    it('rolls up FLAKY in the traceability matrix when a covering test only passed on retry, with no failures', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      const flakyResult = { status: 'passed', retry: 1, errors: [], steps: [], attachments: [] } as never;
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login via form', tags: ['@FR-LOGIN-1'], annotations: [] } as never, flakyResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      const matrixSection = content.slice(content.indexOf('Requirements Traceability Matrix'));
      expect(matrixSection).toContain('>FLAKY<');
    });

    it('rolls up FAIL in the traceability matrix when one of two tests covering a requirement fails', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      const failingResult = { status: 'failed', errors: [], steps: [], attachments: [] } as never;
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login via form', tags: ['@FR-LOGIN-1'], annotations: [] } as never, passingResult);
      reporter.onTestEnd({ title: 'Login via SSO', tags: ['@FR-LOGIN-1'], annotations: [] } as never, failingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      const matrixSection = content.slice(content.indexOf('Requirements Traceability Matrix'));
      expect(matrixSection).toContain('Login via form');
      expect(matrixSection).toContain('Login via SSO');
      expect(matrixSection).toContain('>FAIL<');
    });

    it('accepts an object-form requirement entry carrying features, alongside plain-string entries', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: {
          'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] },
          'FR-OTHER-1': 'Some other requirement',
        },
        features: { login: { title: 'Logging in', body: 'Some prose.' } },
      });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1'], annotations: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('Users can log in');
      expect(content).toContain('<a href="#about-login">Logging in</a>');
    });
  });

  // ── about option ────────────────────────────────────────────────────────────

  describe('about option', () => {
    const passingResult = { status: 'passed', errors: [], steps: [], attachments: [] } as never;

    it('renders an About section for each feature, with a rolled-up status from its requirements\' covering tests', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] } },
        about: { login: { title: 'Logging in', body: 'Users **sign in** with their credentials.' } },
      });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1'], annotations: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('<h2>Logging in</h2>');
      expect(content).toContain('<strong>sign in</strong>');
      const aboutSection = content.slice(content.indexOf('id="about-login"'), content.indexOf('<h2>Requirements Traceability Matrix</h2>'));
      expect(aboutSection).toContain('class="badge badge-pass"');
    });

    it('lists a feature\'s requirements linked back to their Matrix row', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': { description: 'Users can log in', features: ['login'] } },
        features: { login: { title: 'Logging in', body: 'Some prose.' } },
      });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1'], annotations: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('<a href="#requirement-FR-LOGIN-1">FR-LOGIN-1</a>');
    });

    it('lists About in the Table of Contents, linked to the first feature', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        features: { login: { title: 'Logging in', body: 'Some prose.' } },
      });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('<a href="#about-login">About</a>');
    });

    it('renders no About section when the option is omitted — existing reports are unaffected', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      reporter.onBegin({} as never, {} as never);
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1'], annotations: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).not.toContain('id="about-');
      expect(content).not.toContain('>About<');
    });
  });

  // ── overview option ─────────────────────────────────────────────────────────

  describe('overview option', () => {
    it('renders the overview on the cover page', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        overview: 'This app lets visitors **schedule appointments**.',
      });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('<strong>schedule appointments</strong>');
    });

    it('renders no overview block when the option is omitted — existing reports are unaffected', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);

      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).not.toContain('class="overview"');
    });
  });
});
