import { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import urlSweepList from '../data/url-sweep-list.json';

// checklist #37 — поведение при прокрутке. Прокрутка здесь настоящая
// (колесо мыши), не программная.
//
// Сайт пересобран на Astro 2026-10 (разведка 2026-10-27):
// - sticky-шапки по-прежнему нет — прокрутка уводит хедер вверх, это
//   подтверждено и остаётся «не делали» по смыслу ТЗ.
// - ПРЕЖНИЙ дефект "верхняя промо-полоса .sale-banner остаётся прозрачной
//   после прокрутки вверх" — больше не актуален: самого элемента
//   .sale-banner на сайте больше нет (клиент убрал полосу при пересборке,
//   вместо неё маленький бейдж в хедере .hdr__badge, который просто
//   уезжает с хедером, никакого отдельного состояния не хранит). Второй
//   тест файла (про .sale-banner) удалён как проверяющий несуществующий
//   элемент, а не потому что сайт «починили» в старом смысле.

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
// эффективной прозрачностью ≈ 0. Скрытое по задумке (неактивные карусельные
// слайды вне видимой области, закрытые аккордеоны, a11y-панель) не учитываем.
const INVISIBLE_CONTENT = `(() => {
  const excluded = 'details:not([open]), [aria-hidden="true"], .a11y__panel, [hidden]';
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
});
