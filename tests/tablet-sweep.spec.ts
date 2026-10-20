import { test, expect } from './fixtures';
import { checkResponsiveHealth } from '../pages/responsiveChecks';
import urlSweepList from '../data/url-sweep-list.json';

// Только 768px (не 375px) — homepage уже подробно проверена на обоих
// брейкпоинтах в responsive.spec.ts, а гонять весь список страниц ещё и на
// мобильном разрешении почти вдвое увеличивает время прогона без
// пропорциональной пользы.
test.describe('Tablet (768px) sweep across key pages', () => {
  for (const { name, path } of urlSweepList.urlsToCheck) {
    test(`${name} (${path}) has no horizontal scroll or broken images at 768px`, async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(path);

      const { scrollWidth, clientWidth, brokenImages } = await checkResponsiveHealth(page);

      expect(
        scrollWidth,
        `Horizontal scroll on ${path}: content is ${scrollWidth}px, wider than the ${clientWidth}px visible area`
      ).toBeLessThanOrEqual(clientWidth);
      expect(brokenImages, `Broken images on ${path}:\n${brokenImages.join('\n')}`).toEqual([]);
    });
  }
});
