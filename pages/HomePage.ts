import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { TEST_EMAIL } from './testData';

export class HomePage extends BasePage {
  // Сайт пересобран на Astro 2026-10 (был Elementor/WordPress) — вся
  // предыдущая вёрстка и локаторы под неё больше не актуальны, переписано
  // с нуля по живой разведке 2026-10-27. Новая разметка куда стабильнее:
  // осмысленные BEM-классы (signup__*, s2__*, cta--*) и полезные
  // data-атрибуты вместо автогенерированных elementor-element-* классов.
  readonly navGetStartedButton: Locator;

  // Hero-CTA на новом сайте — ВСЕГДА форма с email (form.signup__form,
  // id полей #home-hero-email), прежнего A/B "форма vs голая ссылка" не
  // обнаружено при разведке 2026-10-27. Если это изменится — тут будет
  // падать expect в continueToStepTwo с понятным сообщением, а не молча.
  readonly heroForm: Locator;
  readonly heroEmailInput: Locator;
  readonly heroFormSubmitButton: Locator;

  constructor(page: Page) {
    super(page);

    this.navGetStartedButton = page.locator('header').getByRole('link', { name: /get started/i }).first();

    this.heroForm = page.locator('form.signup__form').first();
    this.heroEmailInput = this.heroForm.locator('#home-hero-email');
    this.heroFormSubmitButton = this.heroForm.locator('button.signup__submit');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async clickNavGetStarted(): Promise<void> {
    await this.navGetStartedButton.click();
  }

  /**
   * Проходит hero-форму (email) к /step-2/?email=... — сайт сам
   * пререндерит GET-параметр и подставляет email на шаге 2.
   */
  async continueToStepTwo(email: string = TEST_EMAIL): Promise<void> {
    await expect(
      this.heroEmailInput,
      'Hero email field (#home-hero-email) not found — the homepage markup may have changed'
    ).toBeVisible({ timeout: 10000 });
    await this.heroEmailInput.fill(email);
    await this.heroFormSubmitButton.click();
  }
}
