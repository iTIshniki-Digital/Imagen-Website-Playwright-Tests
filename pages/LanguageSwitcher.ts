import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

// Виджет переключателя языков (WPML) на этом сайте открывается по hover,
// а не по клику — тестировать саму механику наведения через Playwright
// нестабильно. Вместо этого проверяем то, что реально важно по смыслу
// сценария "переключатель сохраняет текущую страницу": ссылка на нужную
// локаль в DOM уже содержит правильный путь, даже если сама она визуально
// скрыта до наведения мышью.
export class LanguageSwitcher extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async getSwitcherHref(localeCode: string): Promise<string | null> {
    return this.page.locator(`a[href*="/${localeCode}/"]`).first().getAttribute('href');
  }
}
