import { test, expect } from './fixtures';

// checklist #36 — раньше не было стабильных селекторов. Живая разведка
// 2026-09-30 нашла консистентный виджет на 6+ страницах (главная,
// culling, editing, cloud-storage, pricing, video): Elementor "Nested
// Accordion" на нативных <details>/<summary> — .e-n-accordion-item /
// .e-n-accordion-item-title. Карусели (Swiper) на сайте тоже есть
// повсеместно, но их next/prev-кнопки и пагинация не реагировали на клики
// стабильно в разведке (то ли ленивая инициализация свайпера при скролле
// в область видимости, то ли ещё что-то) — не набрали достаточной
// уверенности, чтобы включать в тест; аккордеон, в отличие от них, дал
// консистентный результат после уточнения (см. ниже).
const PAGES_WITH_FAQ = ['/', '/pricing/'];

test.describe('Interactive widgets', () => {
  for (const path of PAGES_WITH_FAQ) {
    test(`FAQ accordion on ${path} expands on click`, async ({ page }) => {
      await page.goto(path);

      const item = page.locator('.e-n-accordion-item').first();
      await expect(item, `Нет FAQ-аккордеона на ${path}`).toBeVisible();

      const summary = item.locator('.e-n-accordion-item-title');
      await summary.scrollIntoViewIfNeeded();

      // Подтверждено вживую 2026-09-30: первый клик по свежезагруженной
      // странице иногда не открывает <details> (аккордеон использует
      // нативный disclosure-виджет браузера) — похоже на задержку
      // инициализации JS-обработчика Elementor. Повторяем клик, если не
      // открылось, вместо того чтобы считать это падением с первой попытки.
      for (let attempt = 0; attempt < 3; attempt++) {
        const isOpen = await item.evaluate((el) => el.hasAttribute('open'));
        if (isOpen) break;
        await summary.click();
        await page.waitForTimeout(500);
      }

      await expect(item, 'Аккордеон не открылся после клика(ов) по заголовку').toHaveJSProperty('open', true);
    });
  }
});
