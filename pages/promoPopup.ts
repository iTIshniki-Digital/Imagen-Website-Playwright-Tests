import { Page } from '@playwright/test';

// Промо-попап Elementor («The next evolution of your workflow…»). Открывается
// примерно через 3 с после загрузки и въезжает анимацией. Подтверждено 2026-10-06:
// в DOM два крестика — скрытый (display: none) и настоящий, поэтому берём :visible.
// Клик по крестику во время въезда уходит мимо экрана (x > ширины вьюпорта), поэтому
// кликаем только тогда, когда крестик реально стоит внутри окна, и проверяем, что
// попап закрылся.
const CLOSE = '.elementor-popup-modal a.dialog-close-button[aria-label="Close"]:visible';

/**
 * Закрывает попап, если он появился. Возвращает true, если попап был показан.
 *
 * Крестик во время анимации «дышит» (уезжает и возвращается), поэтому клик по нему
 * попадает не всегда. Сначала пробуем Escape (Elementor закрывает попап по Esc), затем
 * реальный клик по крестику, когда он стоит внутри окна. Успех — попап скрыт (display: none).
 */
export async function closePromoPopup(page: Page, waitMs = 10000): Promise<boolean> {
  const close = page.locator(CLOSE).first();
  const viewport = page.viewportSize();
  const deadline = Date.now() + waitMs;
  let seen = false;

  const isHidden = () =>
    page.evaluate(() => {
      const p = document.querySelector('.elementor-popup-modal');
      return !p || getComputedStyle(p).display === 'none';
    });

  while (Date.now() < deadline) {
    const visible = await close.isVisible().catch(() => false);
    if (!visible) {
      if (seen) return true;
      await page.waitForTimeout(250);
      continue;
    }
    seen = true;

    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    if (await isHidden()) return true;

    const box = await close.boundingBox();
    const inside = !!box && !!viewport && box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0;
    if (inside) {
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2).catch(() => {});
      await page.waitForTimeout(400);
      if (await isHidden()) return true;
    }
    await page.waitForTimeout(300);
  }
  return seen;
}
