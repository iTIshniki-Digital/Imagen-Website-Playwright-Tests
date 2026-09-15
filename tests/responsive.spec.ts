import { test, expect } from './fixtures';
import { HomePage } from '../pages/HomePage';
import { isThirdPartyNoise } from '../pages/BasePage';

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

      // Прокручиваем всю страницу, чтобы триггернуть ленивую загрузку картинок —
      // иначе не увидим их реальный статус, они просто ещё не начали грузиться.
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          const distance = 400;
          let total = 0;
          const timer = setInterval(() => {
            window.scrollBy(0, distance);
            total += distance;
            if (total >= document.body.scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });
      await page.waitForLoadState('networkidle');

      // Сравниваем с clientWidth (реальная видимая ширина БЕЗ учёта
      // вертикального скроллбара), а не с числом из конфига viewport —
      // так браузерный скроллбар не даёт ложных срабатываний.
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        scrollWidth,
        `Горизонтальный скролл: контент ${scrollWidth}px шире видимой области ${clientWidth}px`
      ).toBeLessThanOrEqual(clientWidth);

      const brokenImages = (
        await page.$$eval('img', (images) =>
          images.filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src)
        )
      ).filter((src) => !isThirdPartyNoise(src));
      expect(brokenImages, `Битые картинки:\n${brokenImages.join('\n')}`).toEqual([]);

      // Скриншот — для ручной визуальной проверки вёрстки человеком
      // (объективные вещи вроде скролла/битых картинок уже проверены выше).
      await page.screenshot({ path: `test-results/screenshots/homepage-${width}px.png`, fullPage: true });
    });
  }
});
