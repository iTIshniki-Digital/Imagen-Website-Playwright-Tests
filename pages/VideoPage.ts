import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { TEST_EMAIL } from './testData';

// Проверено вживую 2026-09-30: форма id="go_to_step2_video_2" на /video/,
// та же структура, что у hero-формы на главной (form_fields[email],
// #form-field-email) — судя по всему, тот же Elementor-виджет с другим
// id. Как и у hero, тут наверняка тоже есть honeypot-поле — намеренно
// заполняем ТОЛЬКО email, ничего больше.
export class VideoPage extends BasePage {
  readonly emailInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    const form = page.locator('#go_to_step2_video_2');
    this.emailInput = form.locator('#form-field-email');
    this.submitButton = form.getByRole('button', { name: /start for free/i });
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
