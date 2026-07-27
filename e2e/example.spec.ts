import { expect, test } from '@playwright/test';
import { evidenceStep, setupStep } from '../dist/index.js';

test('page title reads "Skyrocket — Launch faster"', { tag: '@FR-TITLE-1' }, async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await evidenceStep(page, testInfo, 'Confirm the page title reads "Skyrocket — Launch faster"', async () => {
    await expect(page).toHaveTitle('Skyrocket — Launch faster');
  });
});

test('hero heading announces the product name', { tag: '@FR-HERO-1' }, async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await evidenceStep(page, testInfo, 'Confirm the hero heading reads "Launch faster with Skyrocket"', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Launch faster with Skyrocket');
  });
});

test('get started button links to the correct anchor', { tag: '@FR-CTA-1' }, async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await evidenceStep(page, testInfo, 'Confirm the "Get started free" button links to "#get-started"', async () => {
    await expect(page.getByRole('link', { name: 'Get started free' }))
      .toHaveAttribute('href', '#get-started');
  });
});

test('navigation contains the Features link', { tag: '@FR-NAV-1' }, async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await evidenceStep(page, testInfo, 'Confirm the navigation contains a "Features" link', async () => {
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Features' }))
      .toHaveAttribute('href', '#features');
  });
});

test('pricing link is present in the navigation', async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await evidenceStep(page, testInfo, 'Confirm the navigation contains a "Pricing" link', async () => {
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Pricing' }))
      .toHaveAttribute('href', '#pricing');
  });
});

test('hero subheading describes the product', async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await evidenceStep(page, testInfo, 'Confirm the hero subheading describes shipping software from commit to production', async () => {
    await expect(page.locator('.hero p'))
      .toHaveText('The all-in-one platform for shipping software your users will love. From first commit to production in minutes.');
  });
});

test('features section heading reads "Everything you need"', async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await setupStep('Scroll down to the Features section', async () => {
    await page.locator('#features').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  await evidenceStep(page, testInfo, 'Confirm the features section heading reads "Everything you need"', async () => {
    await expect(page.getByRole('heading', { name: 'Everything you need' })).toBeVisible();
  });
});

test('first feature card is labelled "Instant deploys"', async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await setupStep('Scroll down to the Features section', async () => {
    await page.locator('#features').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  await evidenceStep(page, testInfo, 'Confirm the first feature card is labelled "Instant deploys"', async () => {
    await expect(page.getByRole('heading', { name: 'Instant deploys' })).toBeVisible();
  });
});

test('second feature card is labelled "Built-in analytics"', async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await setupStep('Scroll down to the Features section', async () => {
    await page.locator('#features').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  await evidenceStep(page, testInfo, 'Confirm the second feature card is labelled "Built-in analytics"', async () => {
    await expect(page.getByRole('heading', { name: 'Built-in analytics' })).toBeVisible();
  });
});

test('third feature card is labelled "99.99% uptime SLA"', async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await setupStep('Scroll down to the Features section', async () => {
    await page.locator('#features').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  await evidenceStep(page, testInfo, 'Confirm the third feature card is labelled "99.99% uptime SLA"', async () => {
    await expect(page.getByRole('heading', { name: '99.99% uptime SLA' })).toBeVisible();
  });
});

test('footer displays the copyright notice', async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await setupStep('Scroll down to the footer', async () => {
    await page.locator('footer').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  await evidenceStep(page, testInfo, 'Confirm the footer displays the copyright notice "© 2026 Skyrocket Software Ltd."', async () => {
    await expect(page.locator('footer span')).toHaveText('© 2026 Skyrocket Software Ltd.');
  });
});

test('contact email links to the correct mailto address', { tag: '@FR-CONTACT-1' }, async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await setupStep('Scroll down to the footer', async () => {
    await page.locator('footer').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  await evidenceStep(page, testInfo, 'Confirm the contact email links to mailto:hello@skyrocket.dev', async () => {
    await expect(page.getByRole('link', { name: 'hello@skyrocket.dev' }))
      .toHaveAttribute('href', 'mailto:hello@skyrocket.dev');
  });
});

// This test deliberately breaks the "one evidenceStep per test" convention
// (see CLAUDE.md) — every other test in this file has exactly one screenshot,
// so the report has never actually exercised multiple screenshots landing in
// the same section. This proves that case: each evidenceStep still gets its
// own intact, unsplit step-group, and the section flows across as many pages
// as it needs without leaving dead space.
test('homepage renders the hero, features, and footer sections', async ({ page }, testInfo) => {
  await setupStep('Open the fixture page', async () => {
    await page.goto('/fixture.html');
  });

  await evidenceStep(page, testInfo, 'Confirm the hero section is visible', async () => {
    await expect(page.locator('.hero')).toBeVisible();
  });

  await setupStep('Scroll down to the Features section', async () => {
    await page.locator('#features').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  await evidenceStep(page, testInfo, 'Confirm the features section is visible', async () => {
    await expect(page.locator('#features')).toBeVisible();
  });

  await setupStep('Scroll down to the footer', async () => {
    await page.locator('footer').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  await evidenceStep(page, testInfo, 'Confirm the footer is visible', async () => {
    await expect(page.locator('footer')).toBeVisible();
  });
});
