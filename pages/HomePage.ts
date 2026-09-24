import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { TEST_EMAIL } from './testData';

export class HomePage extends BasePage {
  // Сайт на Elementor — CSS-классы вида "elementor-element-3f8a1b2" нестабильны
  // и меняются при каждой правке в редакторе, поэтому НЕ используем их как локаторы.
  // getByRole ищет по семантике (роль + видимый текст), это переживает верстку.
  readonly navGetStartedButton: Locator;

  // Проверено вживую 2026-09-24: hero-CTA — это НЕ отдельная ссылка, а
  // submit-кнопка внутри формы id="go_to_step2_new_hp" (id задан вручную в
  // Elementor, семантический и стабильный). Без заполненного email-поля
  // кнопка ничего не делает. Старый локатор искал только <a>-ссылки и
  // поэтому никогда не мог найти эту кнопку — вероятно, этим объясняется
  // прошлый отчёт "hero CTA пропала", а не реальным багом сайта.
  readonly heroForm: Locator;
  readonly heroEmailInput: Locator;
  readonly heroSubmitButton: Locator;

  constructor(page: Page) {
    super(page);

    this.navGetStartedButton = page.locator('header').getByRole('link', { name: /get started/i }).first();

    this.heroForm = page.locator('#go_to_step2_new_hp');
    this.heroEmailInput = this.heroForm.locator('#form-field-email');
    this.heroSubmitButton = this.heroForm.getByRole('button', { name: /get started/i });
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async clickNavGetStarted(): Promise<void> {
    await this.navGetStartedButton.click();
  }

  async submitHeroEmail(email: string = TEST_EMAIL): Promise<void> {
    await expect(
      this.heroEmailInput,
      'Email-поле hero-формы не найдено на главной — возможно, изменилась вёрстка формы'
    ).toBeVisible({ timeout: 10000 });
    await this.heroEmailInput.fill(email);
    // form_fields[invalid] — honeypot-поле Elementor против ботов: если его
    // заполнить, форма молча отклонит отправку. Намеренно его не трогаем.
    await this.heroSubmitButton.click();
  }
}
