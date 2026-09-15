import { test, expect } from './fixtures';
import { HomePage } from '../pages/HomePage';

test.describe('Homepage', () => {
  test('loads within ~5s with no console errors and no failed requests', async ({ page }) => {
    const homePage = new HomePage(page);
    const issues = homePage.trackIssues(); // вешаем слушатели ДО goto()

    const start = Date.now();
    await homePage.goto();
    await page.waitForLoadState('load');
    const loadTime = Date.now() - start;

    expect(loadTime, `Страница грузилась ${loadTime}ms`).toBeLessThan(5000);

    expect(issues.consoleErrors, `Ошибки в консоли:\n${issues.consoleErrors.join('\n')}`).toEqual([]);
    expect(issues.failedRequests, `Проваленные запросы:\n${issues.failedRequests.join('\n')}`).toEqual([]);
  });

  test('hero "Get Started" redirects to /step-2/', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();

    await homePage.clickHeroGetStarted();

    await expect(page).toHaveURL(/\/step-2\/?$/);
  });

  test('nav "Get Started" redirects to /step-2/', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();

    await homePage.clickNavGetStarted();

    await expect(page).toHaveURL(/\/step-2\/?$/);
  });
});
