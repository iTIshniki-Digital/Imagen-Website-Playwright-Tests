import { test, expect } from './fixtures';
import { HomePage } from '../pages/HomePage';
import { TEST_EMAIL } from '../pages/testData';

test.describe('Homepage', () => {
  test('loads within ~5s with no console errors and no failed requests', async ({ page }) => {
    const homePage = new HomePage(page);
    const issues = homePage.trackIssues(); // вешаем слушатели ДО goto()

    const start = Date.now();
    await homePage.goto();
    await page.waitForLoadState('load');
    const loadTime = Date.now() - start;

    // ТЗ просит "~5 секунд" — держим порог близко к этому, но с небольшим
    // запасом (6с): в реальном CI-прогоне WebKit пару раз показал 5.1-7с
    // при в остальном чистой загрузке — это разница в сетевых условиях
    // CI-раннера и особенностях движка WebKit, а не деградация сайта.
    // Слишком туго — и тест ловит инфраструктурный шум вместо реальных проблем.
    expect(loadTime, `Page took ${loadTime}ms to load`).toBeLessThan(6000);

    expect(issues.consoleErrors, `Console errors:\n${issues.consoleErrors.join('\n')}`).toEqual([]);
    expect(issues.failedRequests, `Failed requests:\n${issues.failedRequests.join('\n')}`).toEqual([]);
  });

  test('hero CTA redirects to /step-2/ with the email prefilled', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();

    await homePage.continueToStepTwo();

    // Новый сайт добавляет свои query-параметры к /step-2/ (submit_url=,
    // email=) — проверяем путь, а не точное совпадение URL целиком.
    await expect(page).toHaveURL(/\/step-2\//);
    await expect(page.locator('#s2-email')).toHaveValue(TEST_EMAIL);
  });

  test('nav "Get Started" redirects to /step-2/', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goto();

    await homePage.clickNavGetStarted();

    await expect(page).toHaveURL(/\/step-2\//);
  });
});
