import { test, expect } from '@playwright/test';
import { BasePage } from '../pages/BasePage';
import urlSweepList from '../data/url-sweep-list.json';

// Это не про конкретный экран, а про сквозной health-check множества
// произвольных страниц из data/ — поэтому используем BasePage напрямую,
// без отдельного Page Object на каждую страницу.
test.describe('Console/Network sweep across key pages', () => {
  for (const { name, path } of urlSweepList.urlsToCheck) {
    test(`${name} (${path}) has no console errors or failed requests`, async ({ page }) => {
      const basePage = new BasePage(page);
      const issues = basePage.trackIssues();

      await page.goto(path);
      await page.waitForLoadState('load');

      expect(issues.consoleErrors, `Ошибки в консоли на ${path}:\n${issues.consoleErrors.join('\n')}`).toEqual([]);
      expect(
        issues.failedRequests,
        `Проваленные запросы на ${path}:\n${issues.failedRequests.join('\n')}`
      ).toEqual([]);
    });
  }
});
