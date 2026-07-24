import fs from 'fs';
import path from 'path';
import os from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Playwright mock ───────────────────────────────────────────────────────────
//
// We mock 'playwright' so we can test PDF wiring without launching a real browser.
// The mock captures what path page.pdf() was called with.

const mockPdf = vi.fn().mockResolvedValue(undefined);
const mockGoto = vi.fn().mockResolvedValue(undefined);
const mockPage = { goto: mockGoto, pdf: mockPdf };
const mockNewPage = vi.fn().mockResolvedValue(mockPage);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockBrowser = { newPage: mockNewPage, close: mockClose };
const mockLaunch = vi.fn().mockResolvedValue(mockBrowser);

vi.mock('playwright-core', () => ({
  chromium: { launch: mockLaunch },
}));

// Dynamic import so the vi.mock above takes effect first.
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

/** Matches `<base>-<8 digit date>-<6 digit time>-<6 char random suffix>.<ext>`. */
function suffixedPattern(base: string, ext: string): RegExp {
  return new RegExp(`^${base}-\\d{8}-\\d{6}-[0-9a-z]{6}\\.${ext}$`);
}

/** Finds the single file in `dir` matching `pattern`, failing the test if there isn't exactly one. */
function findMatch(dir: string, pattern: RegExp): string {
  const matches = fs.readdirSync(dir).filter((name) => pattern.test(name));
  expect(matches, `expected exactly one file matching ${pattern} in ${dir}, found: ${matches.join(', ')}`).toHaveLength(1);
  return path.join(dir, matches[0]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('formats a UTC date as YYYYMMDD-HHmmss', () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 6, 24, 14, 30, 5)))).toBe('20260724-143005');
  });

  it('zero-pads single-digit month, day, hour, minute, and second', () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 0, 5, 3, 2, 1)))).toBe('20260105-030201');
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
      expect(formatTimestamp(date)).toBe('20260101-233000');
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});

describe('EvidenceReporter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── HTML mode ───────────────────────────────────────────────────────────────

  describe('html mode (default)', () => {
    it('writes evidence-report-<timestamp>-<suffix>.html when no file option is set', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'evidence-report.html') });
      await reporter.onEnd(fullResult);
      findMatch(tmpDir, suffixedPattern('evidence-report', 'html'));
    });

    it('writes HTML to the configured file path with a timestamp and random suffix appended', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'custom-report.html') });
      await reporter.onEnd(fullResult);
      findMatch(tmpDir, suffixedPattern('custom-report', 'html'));
    });

    it('creates parent directories that do not exist', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'nested', 'dir', 'report.html') });
      await reporter.onEnd(fullResult);
      findMatch(path.join(tmpDir, 'nested', 'dir'), suffixedPattern('report', 'html'));
    });

    it('writes valid HTML content', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html'), title: 'My Evidence' });
      await reporter.onEnd(fullResult);
      const outFile = findMatch(tmpDir, suffixedPattern('report', 'html'));
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('<!DOCTYPE html>');
      expect(content).toContain('My Evidence');
    });

    it('does not launch a browser', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      await reporter.onEnd(fullResult);
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it('explicit output: html does not launch a browser', async () => {
      const reporter = new EvidenceReporter({ output: 'html', file: path.join(tmpDir, 'report.html') });
      await reporter.onEnd(fullResult);
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    describe('latest option', () => {
      it('writes to the exact configured path, with no timestamp or suffix', async () => {
        const outFile = path.join(tmpDir, 'report.html');
        const reporter = new EvidenceReporter({ file: outFile, latest: true });
        await reporter.onEnd(fullResult);
        expect(fs.existsSync(outFile)).toBe(true);
        expect(fs.readdirSync(tmpDir)).toEqual(['report.html']);
      });

      it('defaults to evidence-report.html with no file option set', async () => {
        const originalCwd = process.cwd();
        process.chdir(tmpDir);
        try {
          const reporter = new EvidenceReporter({ latest: true });
          await reporter.onEnd(fullResult);
          expect(fs.existsSync(path.join(tmpDir, 'evidence-report.html'))).toBe(true);
        } finally {
          process.chdir(originalCwd);
        }
      });

      it('overwrites the same file on a second run, unlike the default timestamped behaviour', async () => {
        const outFile = path.join(tmpDir, 'report.html');

        const firstReporter = new EvidenceReporter({ file: outFile, latest: true, title: 'First run' });
        await firstReporter.onEnd(fullResult);
        expect(fs.readFileSync(outFile, 'utf8')).toContain('First run');

        const secondReporter = new EvidenceReporter({ file: outFile, latest: true, title: 'Second run' });
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
      const { path: actualPath } = mockPdf.mock.calls[0][0];
      expect(path.dirname(actualPath)).toBe(path.resolve(tmpDir));
      expect(path.basename(actualPath)).toMatch(suffixedPattern('report', 'pdf'));
    });

    it('defaults PDF path to evidence-report-<timestamp>-<suffix>.pdf when no file is set', async () => {
      const reporter = new EvidenceReporter({ output: 'pdf' });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      const { path: actualPath } = mockPdf.mock.calls[0][0];
      expect(path.dirname(actualPath)).toBe(path.resolve('.'));
      expect(path.basename(actualPath)).toMatch(suffixedPattern('evidence-report', 'pdf'));
    });

    it('produces different filenames for two runs started at the exact same instant (e.g. parallel CI shards), so they do not overwrite each other', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');

      // Fixed system time for both runs — only the random suffix can disambiguate them.
      const firstReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      firstReporter.onBegin({} as never, {} as never);
      await firstReporter.onEnd(fullResult);
      const firstPath = mockPdf.mock.calls[0][0].path;

      const secondReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      secondReporter.onBegin({} as never, {} as never);
      await secondReporter.onEnd(fullResult);
      const secondPath = mockPdf.mock.calls[1][0].path;

      expect(firstPath).not.toBe(secondPath);
    });

    it('produces a different filename for a run started at a different time, so repeated runs do not overwrite each other', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');

      const firstReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      firstReporter.onBegin({} as never, {} as never);
      await firstReporter.onEnd(fullResult);
      const firstPath = mockPdf.mock.calls[0][0].path;

      vi.setSystemTime(new Date(2026, 6, 24, 14, 45, 0));
      const secondReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      secondReporter.onBegin({} as never, {} as never);
      await secondReporter.onEnd(fullResult);
      const secondPath = mockPdf.mock.calls[1][0].path;

      expect(firstPath).not.toBe(secondPath);
    });

    it('navigates to report.html inside the temp directory via file:// URL', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');
      const reporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      const [[gotoUrl]] = mockGoto.mock.calls;
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
        const firstPath = mockPdf.mock.calls[0][0].path;

        vi.setSystemTime(new Date(2026, 6, 24, 14, 45, 0));
        const secondReporter = new EvidenceReporter({ output: 'pdf', file: pdfFile, latest: true });
        secondReporter.onBegin({} as never, {} as never);
        await secondReporter.onEnd(fullResult);
        const secondPath = mockPdf.mock.calls[1][0].path;

        expect(firstPath).toBe(secondPath);
      });
    });
  });
});
