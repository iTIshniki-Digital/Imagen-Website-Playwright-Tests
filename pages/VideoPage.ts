import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { TEST_EMAIL } from './testData';

// Сайт пересобран на Astro 2026-10 — форма теперь form.vhero__form на
// /video/, поле #vhero-email, кнопка .vhero__submit (разведка 2026-10-27).
export class VideoPage extends BasePage {
  readonly emailInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    const form = page.locator('form.vhero__form');
    this.emailInput = form.locator('#vhero-email');
    this.submitButton = form.locator('button.vhero__submit');
  }

  async goto(): Promise<void> {
    await this.page.goto('/video/');
  }

  async submitEmail(email: string = TEST_EMAIL): Promise<void> {
    await expect(
      this.emailInput,
      'Email field on /video/ was not found — the layout may have changed, or another A/B variant is active'
    ).toBeVisible({ timeout: 10000 });
    await this.emailInput.fill(email);
    await this.submitButton.click();
  }
}
