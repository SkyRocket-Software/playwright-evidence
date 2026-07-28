import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page, TestInfo } from '@playwright/test';

// step.ts only uses test.step() from '@playwright/test' — mocked here to just
// run the callback and propagate its outcome, mirroring what the real
// Playwright runner does, without needing an actual test run.
vi.mock('@playwright/test', () => ({
  test: {
    step: async (_title: string, body: () => Promise<void>) => body(),
  },
}));

const { setupStep, evidenceStep } = await import('./step.ts');

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockScreenshot = vi.fn();
const mockPage = { screenshot: mockScreenshot } as unknown as Page;

const mockAttach = vi.fn();
const mockTestInfo = { attach: mockAttach } as unknown as TestInfo;

beforeEach(() => {
  vi.clearAllMocks();
  mockScreenshot.mockResolvedValue(Buffer.from('screenshot-bytes'));
  mockAttach.mockResolvedValue(undefined);
});

// ── setupStep ─────────────────────────────────────────────────────────────────

describe('setupStep', () => {
  it('runs the given action', async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    await setupStep('Open the website', action);
    expect(action).toHaveBeenCalledOnce();
  });

  it('propagates an error thrown by the action', async () => {
    const action = vi.fn().mockRejectedValue(new Error('navigation failed'));
    await expect(setupStep('Open the website', action)).rejects.toThrow('navigation failed');
  });
});

// ── evidenceStep ──────────────────────────────────────────────────────────────

describe('evidenceStep', () => {
  it('runs the given action', async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    await evidenceStep(mockPage, mockTestInfo, 'Confirm the thing', action);
    expect(action).toHaveBeenCalledOnce();
  });

  it('takes a screenshot at device scale by default', async () => {
    await evidenceStep(mockPage, mockTestInfo, 'Confirm the thing', async () => {});
    expect(mockScreenshot).toHaveBeenCalledWith({ fullPage: false, scale: 'device' });
  });

  it('takes a screenshot at css scale when requested', async () => {
    await evidenceStep(mockPage, mockTestInfo, 'Confirm the thing', async () => {}, { screenshotScale: 'css' });
    expect(mockScreenshot).toHaveBeenCalledWith({ fullPage: false, scale: 'css' });
  });

  it('attaches the screenshot under the step description as the name', async () => {
    await evidenceStep(mockPage, mockTestInfo, 'Confirm the thing', async () => {});
    expect(mockAttach).toHaveBeenCalledWith('Confirm the thing', {
      body: Buffer.from('screenshot-bytes'),
      contentType: 'image/png',
    });
  });

  it('takes and attaches a screenshot even when the action throws', async () => {
    await expect(
      evidenceStep(mockPage, mockTestInfo, 'Confirm the thing', async () => {
        throw new Error('assertion failed');
      }),
    ).rejects.toThrow('assertion failed');
    expect(mockScreenshot).toHaveBeenCalledOnce();
    expect(mockAttach).toHaveBeenCalledOnce();
  });

  it('re-throws the action error after the screenshot is taken, so the step still fails', async () => {
    await expect(
      evidenceStep(mockPage, mockTestInfo, 'Confirm the thing', async () => {
        throw new Error('assertion failed');
      }),
    ).rejects.toThrow('assertion failed');
  });

  it('does not throw when the action succeeds', async () => {
    await expect(
      evidenceStep(mockPage, mockTestInfo, 'Confirm the thing', async () => {}),
    ).resolves.toBeUndefined();
  });

  it('still fails the step when the action throws a literal `undefined`', async () => {
    // A naive `actionError !== undefined` check would swallow this — the action
    // technically threw, it just threw a falsy, undefined value.
    let caught: unknown = 'not thrown';
    try {
      await evidenceStep(mockPage, mockTestInfo, 'Confirm the thing', async () => {
        throw undefined;
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeUndefined();
  });

  it('throws the action error, not a subsequent screenshot failure, when both fail', async () => {
    // The action's own failure is the more useful error for debugging — e.g. the
    // screenshot only failed because the action's failure crashed the page.
    mockScreenshot.mockRejectedValueOnce(new Error('page crashed'));
    await expect(
      evidenceStep(mockPage, mockTestInfo, 'Confirm the thing', async () => {
        throw new Error('assertion failed');
      }),
    ).rejects.toThrow('assertion failed');
  });

  it('throws the screenshot failure when the action itself succeeded', async () => {
    mockScreenshot.mockRejectedValueOnce(new Error('page crashed'));
    await expect(
      evidenceStep(mockPage, mockTestInfo, 'Confirm the thing', async () => {}),
    ).rejects.toThrow('page crashed');
  });
});
