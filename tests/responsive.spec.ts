import { test, expect } from './fixtures';
import { HomePage } from '../pages/HomePage';
import { checkResponsiveHealth } from '../pages/responsiveChecks';

const BREAKPOINTS = [
  { name: 'tablet (768px)', width: 768, height: 1024 },
  { name: 'mobile (375px)', width: 375, height: 812 },
];

test.describe('Responsive layout', () => {
  for (const { name, width, height } of BREAKPOINTS) {
    test(`homepage has no horizontal scroll or broken images at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });

      const homePage = new HomePage(page);
      await homePage.goto();

      const { scrollWidth, clientWidth, brokenImages } = await checkResponsiveHealth(page);

      expect(
        scrollWidth,
        `Горизонтальный скролл: контент ${scrollWidth}px шире видимой области ${clientWidth}px`
      ).toBeLessThanOrEqual(clientWidth);
      expect(brokenImages, `Битые картинки:\n${brokenImages.join('\n')}`).toEqual([]);

      // Скриншот — для ручной визуальной проверки вёрстки человеком
      // (объективные вещи вроде скролла/битых картинок уже проверены выше).
      await page.screenshot({ path: `test-results/screenshots/homepage-${width}px.png`, fullPage: true });
    });
  }
});
