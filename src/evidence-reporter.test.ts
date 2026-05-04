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
const { default: EvidenceReporter } = await import('./evidence-reporter.ts');

// ── Helpers ───────────────────────────────────────────────────────────────────

const fullResult = {
  status: 'passed',
  startTime: new Date(),
  duration: 0,
} as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EvidenceReporter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── HTML mode ───────────────────────────────────────────────────────────────

  describe('html mode (default)', () => {
    it('writes evidence-report.html when no file option is set', async () => {
      // Use a known path so we can clean up — override default by passing file
      const outFile = path.join(tmpDir, 'evidence-report.html');
      const reporter = new EvidenceReporter({ file: outFile });
      await reporter.onEnd(fullResult);
      expect(fs.existsSync(outFile)).toBe(true);
    });

    it('writes HTML to the configured file path', async () => {
      const outFile = path.join(tmpDir, 'custom-report.html');
      const reporter = new EvidenceReporter({ file: outFile });
      await reporter.onEnd(fullResult);
      expect(fs.existsSync(outFile)).toBe(true);
    });

    it('creates parent directories that do not exist', async () => {
      const outFile = path.join(tmpDir, 'nested', 'dir', 'report.html');
      const reporter = new EvidenceReporter({ file: outFile });
      await reporter.onEnd(fullResult);
      expect(fs.existsSync(outFile)).toBe(true);
    });

    it('writes valid HTML content', async () => {
      const outFile = path.join(tmpDir, 'report.html');
      const reporter = new EvidenceReporter({ file: outFile, title: 'My Evidence' });
      await reporter.onEnd(fullResult);
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
  });

  // ── PDF mode ────────────────────────────────────────────────────────────────

  describe('pdf mode', () => {
    it('launches a headless browser', async () => {
      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      expect(mockLaunch).toHaveBeenCalledOnce();
    });

    it('writes the PDF to the configured file path', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');
      const reporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      expect(mockPdf).toHaveBeenCalledWith(expect.objectContaining({
        path: path.resolve(pdfFile),
      }));
    });

    it('defaults PDF path to evidence-report.pdf when no file is set', async () => {
      const reporter = new EvidenceReporter({ output: 'pdf' });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      expect(mockPdf).toHaveBeenCalledWith(expect.objectContaining({
        path: path.resolve('evidence-report.pdf'),
      }));
    });

    it('navigates to the intermediate HTML file via file:// URL', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');
      const reporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      const expectedHtml = path.resolve(pdfFile.replace(/\.pdf$/i, '.html'));
      expect(mockGoto).toHaveBeenCalledWith(
        `file://${expectedHtml}`,
        { waitUntil: 'networkidle' },
      );
    });

    it('removes the intermediate HTML file after PDF is written', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');
      const reporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      const htmlFile = pdfFile.replace(/\.pdf$/i, '.html');
      expect(fs.existsSync(htmlFile)).toBe(false);
    });

    it('removes the sidecar screenshot directory after PDF is written', async () => {
      const pdfFile = path.join(tmpDir, 'report.pdf');
      const reporter = new EvidenceReporter({ output: 'pdf', file: pdfFile });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      const screenshotDir = path.join(tmpDir, 'screenshots');
      expect(fs.existsSync(screenshotDir)).toBe(false);
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
  });
});
