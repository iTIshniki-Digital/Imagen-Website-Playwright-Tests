import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
  // Сайт на Elementor — CSS-классы вида "elementor-element-3f8a1b2" нестабильны
  // и меняются при каждой правке в редакторе, поэтому НЕ используем их как локаторы.
  // getByRole ищет по семантике (роль + видимый текст), это переживает верстку.
  readonly getStartedButton: Locator;

  constructor(page: Page) {
    super(page);

    // Проверено вживую: на странице сейчас 3 ссылки с текстом "Get Started" /
    // "Get started" (шапка, hero-секция и ещё один блок) — у всех одинаковые
    // generic-классы Elementor (elementor-button elementor-size-sm), различить
    // их по семантике нельзя. Берём первую (обычно это CTA в шапке — самый
    // стабильный, присутствует на всех страницах сайта).
    // TODO(dev-team): попросить добавить data-testid на конкретную hero-кнопку,
    // если тест должен проверять именно её, а не "любую" Get Started.
    this.getStartedButton = page.getByRole('link', { name: /get started/i }).first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async clickGetStarted(): Promise<void> {
    await this.getStartedButton.click();
  }
}
