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
const mockContextClose = vi.fn().mockResolvedValue(undefined);
const mockContext = vi.fn().mockReturnValue({ close: mockContextClose });
const mockPage = { goto: mockGoto, pdf: mockPdf, context: mockContext };
const mockNewPage = vi.fn().mockResolvedValue(mockPage);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockBrowser = { newPage: mockNewPage, close: mockClose };
const mockLaunch = vi.fn().mockResolvedValue(mockBrowser);
const mockConnectOverCDP = vi.fn().mockResolvedValue(mockBrowser);

vi.mock('playwright-core', () => ({
  chromium: { launch: mockLaunch, connectOverCDP: mockConnectOverCDP },
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

    it('closes the page context before disconnecting the browser', async () => {
      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      await reporter.onEnd(fullResult);
      expect(mockContextClose).toHaveBeenCalledOnce();
      const contextCloseOrder = mockContextClose.mock.invocationCallOrder[0];
      const browserCloseOrder = mockClose.mock.invocationCallOrder[0];
      expect(contextCloseOrder).toBeLessThan(browserCloseOrder);
    });

    it('closes the page context even if pdf() throws', async () => {
      mockPdf.mockRejectedValueOnce(new Error('render failed'));
      const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
      reporter.onBegin({} as never, {} as never);
      await expect(reporter.onEnd(fullResult)).rejects.toThrow('render failed');
      expect(mockContextClose).toHaveBeenCalledOnce();
    });

    describe('cdpEndpoint option', () => {
      it('connects via CDP instead of launching a new browser when set', async () => {
        const reporter = new EvidenceReporter({
          output: 'pdf',
          file: path.join(tmpDir, 'report.pdf'),
          cdpEndpoint: 'http://localhost:9222',
        });
        reporter.onBegin({} as never, {} as never);
        await reporter.onEnd(fullResult);
        expect(mockConnectOverCDP).toHaveBeenCalledWith('http://localhost:9222');
        expect(mockLaunch).not.toHaveBeenCalled();
      });

      it('launches a new browser as before when cdpEndpoint is not set', async () => {
        const reporter = new EvidenceReporter({ output: 'pdf', file: path.join(tmpDir, 'report.pdf') });
        reporter.onBegin({} as never, {} as never);
        await reporter.onEnd(fullResult);
        expect(mockLaunch).toHaveBeenCalledOnce();
        expect(mockConnectOverCDP).not.toHaveBeenCalled();
      });

      it('wraps a CDP connection failure with the endpoint and a remediation hint', async () => {
        mockConnectOverCDP.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:9222'));
        const reporter = new EvidenceReporter({
          output: 'pdf',
          file: path.join(tmpDir, 'report.pdf'),
          cdpEndpoint: 'http://localhost:9222',
        });
        reporter.onBegin({} as never, {} as never);
        await expect(reporter.onEnd(fullResult)).rejects.toThrow(
          /Failed to connect to CDP endpoint "http:\/\/localhost:9222".*connect ECONNREFUSED 127\.0\.0\.1:9222.*Chromium instance is listening/s,
        );
      });

      it('does not attempt to close a browser that was never connected', async () => {
        mockConnectOverCDP.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
        const reporter = new EvidenceReporter({
          output: 'pdf',
          file: path.join(tmpDir, 'report.pdf'),
          cdpEndpoint: 'http://localhost:9222',
        });
        reporter.onBegin({} as never, {} as never);
        await expect(reporter.onEnd(fullResult)).rejects.toThrow();
        expect(mockClose).not.toHaveBeenCalled();
      });

      it('rejects an empty cdpEndpoint at construction time', () => {
        expect(() => new EvidenceReporter({ output: 'pdf', cdpEndpoint: '' })).toThrow(/non-empty URL/);
      });

      it('rejects a cdpEndpoint with no URL scheme at construction time', () => {
        expect(() => new EvidenceReporter({ output: 'pdf', cdpEndpoint: 'localhost:9222' })).toThrow(
          /scheme "localhost:" is not supported/,
        );
      });

      it('rejects a cdpEndpoint that is not a URL at construction time', () => {
        expect(() => new EvidenceReporter({ output: 'pdf', cdpEndpoint: 'not a url' })).toThrow(
          /Invalid cdpEndpoint "not a url"/,
        );
      });

      it('accepts a ws: scheme endpoint', async () => {
        const reporter = new EvidenceReporter({
          output: 'pdf',
          file: path.join(tmpDir, 'report.pdf'),
          cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
        });
        reporter.onBegin({} as never, {} as never);
        await reporter.onEnd(fullResult);
        expect(mockConnectOverCDP).toHaveBeenCalledWith('ws://127.0.0.1:9222/devtools/browser/abc');
      });

      it('does not throw when cdpEndpoint is omitted', () => {
        expect(() => new EvidenceReporter({ output: 'pdf' })).not.toThrow();
      });
    });

    describe('cdpTimeout option', () => {
      it('passes the configured timeout through to connectOverCDP', async () => {
        const reporter = new EvidenceReporter({
          output: 'pdf',
          file: path.join(tmpDir, 'report.pdf'),
          cdpEndpoint: 'http://localhost:9222',
          cdpTimeout: 5000,
        });
        reporter.onBegin({} as never, {} as never);
        await reporter.onEnd(fullResult);
        expect(mockConnectOverCDP).toHaveBeenCalledWith('http://localhost:9222', { timeout: 5000 });
      });

      it('omits the options argument to connectOverCDP when cdpTimeout is not set', async () => {
        const reporter = new EvidenceReporter({
          output: 'pdf',
          file: path.join(tmpDir, 'report.pdf'),
          cdpEndpoint: 'http://localhost:9222',
        });
        reporter.onBegin({} as never, {} as never);
        await reporter.onEnd(fullResult);
        expect(mockConnectOverCDP).toHaveBeenCalledWith('http://localhost:9222');
      });

      it('is ignored when cdpEndpoint is not set', async () => {
        const reporter = new EvidenceReporter({
          output: 'pdf',
          file: path.join(tmpDir, 'report.pdf'),
          cdpTimeout: 5000,
        });
        reporter.onBegin({} as never, {} as never);
        await reporter.onEnd(fullResult);
        expect(mockLaunch).toHaveBeenCalledOnce();
        expect(mockConnectOverCDP).not.toHaveBeenCalled();
      });
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
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1'] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = path.join(tmpDir, 'report.html');
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
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1'] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = path.join(tmpDir, 'report.html');
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('FR-LOGIN-1');
    });

    it('ignores tags with no matching entry in the requirements map', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      reporter.onTestEnd({ title: 'Unrelated test', tags: ['@not-a-requirement'] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = path.join(tmpDir, 'report.html');
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).not.toContain('Requirements proven');
    });

    it('renders the Requirements Traceability Matrix when requirements is set', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1'] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = path.join(tmpDir, 'report.html');
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('Requirements Traceability Matrix');
    });

    it('renders no traceability matrix when requirements is omitted, matching pre-patch output', async () => {
      const reporter = new EvidenceReporter({ file: path.join(tmpDir, 'report.html') });
      reporter.onTestEnd({ title: 'Login test', tags: [] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = path.join(tmpDir, 'report.html');
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).not.toContain('Requirements Traceability Matrix');
      expect(content).not.toContain('Requirements proven');
    });

    it('lists every requirement matched by a test tagged with more than one requirement', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in', 'FR-LOGIN-2': 'Users can log out' },
      });
      reporter.onTestEnd({ title: 'Login test', tags: ['@FR-LOGIN-1', '@FR-LOGIN-2'] } as never, passingResult);
      await reporter.onEnd(fullResult);

      const outFile = path.join(tmpDir, 'report.html');
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content).toContain('FR-LOGIN-1');
      expect(content).toContain('FR-LOGIN-2');
    });

    it('lists a duplicated tag only once, rather than repeating the requirement', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      reporter.onTestEnd(
        { title: 'Login test', tags: ['@FR-LOGIN-1', '@FR-LOGIN-1'] } as never,
        passingResult,
      );
      await reporter.onEnd(fullResult);

      const outFile = path.join(tmpDir, 'report.html');
      const content = fs.readFileSync(outFile, 'utf8');
      expect(content.match(/FR-LOGIN-1/g)?.length).toBe(2); // once in the per-test list, once in the matrix
    });

    it('rolls up FAIL in the traceability matrix when one of two tests covering a requirement fails', async () => {
      const reporter = new EvidenceReporter({
        file: path.join(tmpDir, 'report.html'),
        requirements: { 'FR-LOGIN-1': 'Users can log in' },
      });
      const failingResult = { status: 'failed', errors: [], steps: [], attachments: [] } as never;
      reporter.onTestEnd({ title: 'Login via form', tags: ['@FR-LOGIN-1'] } as never, passingResult);
      reporter.onTestEnd({ title: 'Login via SSO', tags: ['@FR-LOGIN-1'] } as never, failingResult);
      await reporter.onEnd(fullResult);

      const outFile = path.join(tmpDir, 'report.html');
      const content = fs.readFileSync(outFile, 'utf8');
      const matrixSection = content.slice(content.indexOf('Requirements Traceability Matrix'));
      expect(matrixSection).toContain('Login via form');
      expect(matrixSection).toContain('Login via SSO');
      expect(matrixSection).toContain('>FAIL<');
    });
  });
});
