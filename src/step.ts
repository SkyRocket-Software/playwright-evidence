import { test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Run a setup action as a labelled step with no screenshot or pass/fail badge.
 * Use for navigation and preconditions that aren't themselves assertions.
 *
 * @param description - Plain-English label shown in the report
 * @param action      - Async callback containing the setup actions
 */
export async function setupStep(
  description: string,
  action: () => Promise<void>,
): Promise<void> {
  await test.step(description, action);
}

export interface EvidenceStepOptions {
  /**
   * Screenshot scale mode.
   * - 'device' (default): captures at full device pixel ratio.
   * - 'css': captures at CSS pixels — halves dimensions on retina/HiDPI displays,
   *   significantly reducing file size with no visible quality loss for evidence purposes.
   */
  screenshotScale?: 'css' | 'device';
}

/**
 * Run a test action as a named evidence step.
 *
 * Always takes a screenshot after the action — whether it passed or failed —
 * and attaches it so the evidence reporter can embed it as base64.
 * The action error is re-thrown after the screenshot so the test still fails.
 *
 * @param page        - Playwright Page object
 * @param testInfo    - Playwright TestInfo (from the test function arguments)
 * @param description - Plain-English description readable by a non-technical person
 * @param action      - Async callback containing the test actions for this step
 * @param options     - Optional screenshot settings
 */
export async function evidenceStep(
  page: Page,
  testInfo: TestInfo,
  description: string,
  action: () => Promise<void>,
  options: EvidenceStepOptions = {},
): Promise<void> {
  const { screenshotScale = 'device' } = options;

  await test.step(description, async () => {
    let actionError: unknown;

    try {
      await action();
    } catch (err) {
      actionError = err;
    }

    // Screenshot always runs regardless of pass/fail
    const screenshot = await page.screenshot({ fullPage: false, scale: screenshotScale });
    await testInfo.attach(description, {
      body: screenshot,
      contentType: 'image/png',
    });

    if (actionError !== undefined) {
      throw actionError;
    }
  });
}
