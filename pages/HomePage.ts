import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {
  // Сайт на Elementor — CSS-классы вида "elementor-element-3f8a1b2" нестабильны
  // и меняются при каждой правке в редакторе, поэтому НЕ используем их как локаторы.
  // getByRole ищет по семантике (роль + видимый текст), это переживает верстку.

  // Проверено вживую: на странице 3 ссылки с текстом "Get Started"/"Get started" —
  // одна внутри <header> (кнопка в шапке), две вне его (первая по DOM-порядку —
  // hero-секция). У всех одинаковые generic-классы Elementor, поэтому различаем
  // по расположению относительно <header>, а не по классам.
  readonly navGetStartedButton: Locator;
  readonly heroGetStartedButton: Locator;

  constructor(page: Page) {
    super(page);

    this.navGetStartedButton = page.locator('header').getByRole('link', { name: /get started/i }).first();

    this.heroGetStartedButton = page
      .getByRole('link', { name: /get started/i })
      .filter({ hasNot: page.locator('xpath=ancestor::header') })
      .first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async clickNavGetStarted(): Promise<void> {
    await this.navGetStartedButton.click();
  }

  async clickHeroGetStarted(): Promise<void> {
    // Явная проверка с понятным сообщением вместо голого таймаута локатора:
    // клиент регулярно выпускает A/B-тесты, и hero-CTA — то, что меняется
    // первым. Если её нет, это важный сигнал, а не "тест завис".
    await expect(
      this.heroGetStartedButton,
      'Hero "Get Started" не найдена на главной — возможно, активный A/B-тест или изменение вёрстки клиентом'
    ).toBeVisible({ timeout: 10000 });
    await this.heroGetStartedButton.click();
  }
}
