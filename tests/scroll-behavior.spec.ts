import { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import urlSweepList from '../data/url-sweep-list.json';

// checklist #37 — поведение при прокрутке. Прокрутка здесь настоящая
// (колесо мыши), а не программная: JS части сайта (WP Rocket) стартует
// только после первого реального действия пользователя, см. комментарий в
// interactive-widgets.spec.ts.
//
// Разведка 2026-10-05:
// - sticky-шапки на сайте нет: при прокрутке на 2000px хедер уезжает вверх
//   (это подтверждено, пункт остаётся «не делали» по sticky по смыслу ТЗ);
// - Elementor-анимации появления не скрывают контент навсегда: после
//   прокрутки до конца и обратно не остаётся видимого текста с opacity ≈ 0.
//   Исключения: неактивные слайды каруселей и закрытые <details> прозрачны
//   по задумке, их не считаем.
// - НАЙДЕНО: верхняя промо-полоса (.sale-banner, «Something big has arrived /
//   $10») при прокрутке вниз уезжает за верх экрана и становится прозрачной.
//   При возврате наверх остаётся на top: -141px, opacity: 0, и возвращается
//   только после перезагрузки. Это дефект сайта — тест красный.

const KEY_PAGES = ['/', ...urlSweepList.urlsToCheck.map((p) => p.path)];

// Настоящее колесо мыши: прокрутка идёт порциями, пока страница не перестанет
// двигаться (дно или верх).
async function wheelScroll(page: Page, direction: 'down' | 'up'): Promise<void> {
  const step = direction === 'down' ? 400 : -400;
  let last = -1;
  for (let i = 0; i < 200; i++) {
    await page.mouse.wheel(0, step);
    await page.waitForTimeout(120);
    const y = await page.evaluate(() => Math.round(window.scrollY));
    if (y === last) break;
    last = y;
  }
  await page.waitForTimeout(1500);
}

// Элементы с текстом или картинки, которые должны быть видны, но стоят с
// эффективной прозрачностью ≈ 0. Скрытое по задумке (неактивные слайды,
// закрытые аккордеоны, фоновые слайд-шоу, a11y-тулбар, промо-полоса, которую
// проверяем отдельно) не учитываем.
const INVISIBLE_CONTENT = `(() => {
  const excluded = '.swiper-slide:not(.swiper-slide-active), details:not([open]), [aria-hidden="true"], .elementor-background-slideshow, .pojo-a11y-toolbar, .elementor-lightbox, [hidden], .sale-banner';
  const stuck = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,p,a,span,li,img')) {
    if (el.closest(excluded)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const label = (el.tagName === 'IMG' ? el.alt : el.innerText || '').trim();
    if (!label) continue;
    let opacity = 1;
    for (let n = el; n; n = n.parentElement) {
      const v = parseFloat(getComputedStyle(n).opacity);
      if (!isNaN(v)) opacity *= v;
    }
    if (opacity < 0.05) stuck.push(el.tagName + ':' + label.slice(0, 40));
  }
  return stuck;
})()`;

test.describe('Scroll behavior (#37)', () => {
  for (const path of KEY_PAGES) {
    test(`no visible content stays transparent after a full scroll on ${path}`, async ({ page }) => {
      test.setTimeout(120000);
      await page.goto(path);
      await page.waitForTimeout(1000);
      await wheelScroll(page, 'down');
      await wheelScroll(page, 'up');

      const stuck = await page.evaluate(INVISIBLE_CONTENT);
      expect(stuck, `Invisible content remains on ${path} after scrolling to the end and back`).toEqual([]);
    });
  }

  test('the top promo banner is visible again after scrolling back to the top of /', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await page.waitForTimeout(1500);

    const readBanner = () =>
      page.evaluate(() => {
        const banner = document.querySelector('.sale-banner');
        if (!banner) return null;
        const rect = banner.getBoundingClientRect();
        return { top: Math.round(rect.top), opacity: Number(getComputedStyle(banner).opacity) };
      });

    const atLoad = await readBanner();
    expect(atLoad, 'The .sale-banner promo banner was not found on the homepage').not.toBeNull();
    expect(atLoad!.top, 'The promo banner should be visible right after load').toBeGreaterThanOrEqual(0);

    await wheelScroll(page, 'down');
    await wheelScroll(page, 'up');

    const afterReturn = await readBanner();
    expect(afterReturn!.top, `After scrolling back to the top, the promo banner is at top=${afterReturn!.top}px but should be on screen`).toBeGreaterThanOrEqual(0);
    expect(afterReturn!.opacity, 'The promo banner is transparent after scrolling back to the top').toBeGreaterThan(0.9);
  });
});
