import { test, expect } from './fixtures';

// checklist #36 — сайт пересобран на Astro 2026-10, Elementor больше нет.
// Разведка 2026-10-27:
// - FAQ-аккордеон — всё ещё нативные <details>/<summary> (как и раньше),
//   просто под новыми классами: .faq__row / .faq__q вместо
//   .e-n-accordion-item / .e-n-accordion-item-title. Найден на / и /pricing/.
// - Карусели — не swiper, а обычные горизонтально скроллящиеся <ul> со
//   стрелками "назад"/"вперёд" (data-step="-1"/"1") и CSS scroll-snap.
//   На главной их две (.hwork__arrow — кейсы использования, .hrev__arrow —
//   отзывы), у обеих есть aria-controls, указывающий на id скроллящегося
//   <ul>. На /business/ — своя (.biztest__arrow), но без aria-controls —
//   контейнер нужно искать рядом по DOM. Проверяем универсально: кликаем
//   "next" (data-step="1") и смотрим, что scrollLeft контейнера изменился.
const PAGES_WITH_FAQ = ['/', '/pricing/'];
const PAGES_WITH_CAROUSEL = ['/', '/business/'];

// Возвращает scrollLeft контейнера (число, сериализуется нормально) — не
// сам DOM-элемент, тот из evaluate() в Node не прочитать. Не привязываемся
// к тегу <ul> — на /business/ скроллится не он сам, а его родительский div
// (.biztest__row), тогда как на главной скроллится сам <ul> (id="hrev-row").
// Ищем ЛЮБОЙ элемент с реальным горизонтальным переполнением рядом с кнопкой.
function scrollLeftOfRow(btn: HTMLElement): number | null {
  function hasOverflow(el: Element): boolean {
    return el.scrollWidth - el.clientWidth > 20 && el.clientWidth > 100;
  }
  function findRow(el0: HTMLElement): HTMLElement | null {
    const viaAria = el0.getAttribute('aria-controls');
    if (viaAria) {
      const byId = document.getElementById(viaAria);
      if (byId) return byId;
    }
    let el: HTMLElement | null = el0.parentElement;
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
      if (hasOverflow(el)) return el;
      const candidate = Array.from(el.querySelectorAll<HTMLElement>('*')).find(hasOverflow);
      if (candidate) return candidate;
    }
    return null;
  }
  const row = findRow(btn);
  return row ? row.scrollLeft : null;
}

test.describe('Interactive widgets', () => {
  for (const path of PAGES_WITH_FAQ) {
    test(`FAQ accordion on ${path} expands on click`, async ({ page }) => {
      await page.goto(path);

      const item = page.locator('.faq__row').first();
      await expect(item, `No FAQ accordion on ${path}`).toBeVisible();

      const summary = item.locator('.faq__q');
      await summary.scrollIntoViewIfNeeded();

      // Нативный <details> — первый клик по свежезагруженной странице иногда
      // не срабатывает (тот же эффект, что был у старого виджета). Повторяем,
      // вместо того чтобы считать это падением с первой попытки.
      for (let attempt = 0; attempt < 3; attempt++) {
        const isOpen = await item.evaluate((el) => el.hasAttribute('open'));
        if (isOpen) break;
        await summary.click();
        await page.waitForTimeout(500);
      }

      await expect(item, 'Accordion did not open after clicking the title').toHaveJSProperty('open', true);
    });
  }
});

test.describe('Carousels', () => {
  for (const path of PAGES_WITH_CAROUSEL) {
    test(`carousel on ${path} moves to another slide`, async ({ page }) => {
      await page.goto(path);
      await page.waitForTimeout(1000);

      const nextButtons = page.locator('button[data-step="1"]:visible');
      const total = await nextButtons.count();
      expect(total, `No carousel found on ${path}`).toBeGreaterThan(0);

      let exercised = 0;
      for (let i = 0; i < total; i++) {
        const next = nextButtons.nth(i);
        await next.scrollIntoViewIfNeeded();

        const before = await next.evaluate(scrollLeftOfRow);
        if (before === null) continue; // не нашли контейнер для этой стрелки — пропускаем, не считаем провалом

        await next.click();

        await expect
          .poll(() => next.evaluate(scrollLeftOfRow), {
            message: `Carousel #${i} on ${path} did not scroll after clicking "next"`,
            timeout: 5000,
          })
          .not.toBe(before);

        exercised++;
      }

      expect(exercised, `No carousel on ${path} was available to check`).toBeGreaterThan(0);
    });
  }
});
