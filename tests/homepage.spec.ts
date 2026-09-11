import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';

test.describe('Homepage', () => {
  test('loads without console errors and allows clicking Get Started', async ({ page }) => {
    const consoleErrors: string[] = [];

    // Слушатели вешаем ДО goto(), иначе пропустим ошибки самой ранней стадии загрузки.
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (error) => {
      // Неотловленные исключения в JS-бандле страницы (не то же самое, что console.error).
      consoleErrors.push(error.message);
    });

    const homePage = new HomePage(page);
    await homePage.goto();

    // Никаких waitForTimeout: expect с auto-retry сам дождётся стабильного состояния.
    await expect(page).toHaveURL(/imagen-ai\.com/);

    expect(consoleErrors, `Найдены ошибки в консоли:\n${consoleErrors.join('\n')}`).toEqual([]);

    await homePage.clickGetStarted();
  });
});
