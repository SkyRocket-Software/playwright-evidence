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
