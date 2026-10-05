import { Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import { wakeUpPageScripts } from '../pages/pageActivation';

// checklist #36 — раньше не было стабильных селекторов. Живая разведка
// 2026-09-30 нашла консистентный виджет на 6+ страницах (главная,
// culling, editing, cloud-storage, pricing, video): Elementor "Nested
// Accordion" на нативных <details>/<summary> — .e-n-accordion-item /
// .e-n-accordion-item-title.
//
// Карусели: прежние провалы 2026-09-30 были связаны с тем, что JS Elementor
// (WP Rocket) стартует только после первого реального действия пользователя,
// а наши программные клики шли раньше. Перепроверено 2026-10-05: после
// «разогрева» колесом мыши (pages/pageActivation.ts) карусель, прокрученная во
// вьюпорт, инициализируется, и кнопка «далее» / буллеты двигают активный слайд.
// Проверяем именно изменение активного слайда, а не просто факт клика.
const PAGES_WITH_FAQ = ['/', '/pricing/'];
const PAGES_WITH_CAROUSEL = ['/', '/business/'];

// Индекс активного слайда. Elementor/Swiper в loop-режиме дублирует слайды,
// поэтому считаем по всем слайдам как есть: тест сравнивает "до" и "после",
// а не конкретный номер.
const activeSlideIndex = (carousel: Locator) =>
  carousel.evaluate((el) => {
    const slides = Array.from(el.querySelectorAll('.swiper-slide'));
    return slides.findIndex((slide) => slide.classList.contains('swiper-slide-active'));
  });

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

test.describe('Carousels', () => {
  for (const path of PAGES_WITH_CAROUSEL) {
    test(`carousel on ${path} moves to another slide`, async ({ page }) => {
      await page.goto(path);
      await wakeUpPageScripts(page);

      const carousels = page.locator('.e-n-carousel.swiper');
      const total = await carousels.count();
      expect(total, `На ${path} не нашлось ни одной карусели`).toBeGreaterThan(0);

      let exercised = 0;
      for (let i = 0; i < total; i++) {
        const carousel = carousels.nth(i);
        const widget = carousel.locator('xpath=ancestor::*[contains(@class,"elementor-widget")][1]');

        // Часть каруселей лежит в неактивных табах и не видна — проверяем
        // только те, что реально доступны пользователю. Если ни одна не
        // видна, тест упадёт ниже, а не пройдёт вхолостую.
        const next = widget.locator('.elementor-swiper-button-next').first();
        const bullet = widget.locator('.swiper-pagination-bullet').last();
        const hasNext = await next.isVisible().catch(() => false);
        const hasBullets = await bullet.isVisible().catch(() => false);
        if (!hasNext && !hasBullets) continue;

        await carousel.scrollIntoViewIfNeeded();
        await expect(carousel, `Карусель #${i} на ${path} не инициализировалась`).toHaveClass(/swiper-initialized/);

        const before = await activeSlideIndex(carousel);

        if (hasNext) {
          await next.click();
        } else {
          await bullet.click();
        }

        await expect
          .poll(() => activeSlideIndex(carousel), {
            message: `Карусель #${i} на ${path} не сменила активный слайд после ${hasNext ? 'кнопки «далее»' : 'клика по буллету'}`,
            timeout: 5000,
          })
          .not.toBe(before);

        exercised++;
      }

      expect(exercised, `На ${path} ни одна карусель не оказалась доступной для проверки`).toBeGreaterThan(0);
    });
  }
});
