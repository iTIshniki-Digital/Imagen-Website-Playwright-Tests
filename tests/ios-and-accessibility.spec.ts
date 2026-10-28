import { devices } from '@playwright/test';
import { test, expect } from './fixtures';
import urlSweepList from '../data/url-sweep-list.json';

// checklist #20 — проверки, которые специфичны для iOS и для касания/клавиатуры.
// Тесты на эмуляции iPhone 13 в обычных браузерах; реальный iPhone — в browserstack/.
//
// Пороги:
// - тач-цели: WCAG 2.2 AA требует 24×24 CSS px; рекомендация Apple — 44 pt.
//   Проверяем 24 px как обязательный минимум и печатаем, сколько кнопок ниже 44.
//   Считаем только кнопки с фоном: текстовые ссылки в строке WCAG не регулирует.
// - автоплей: iOS Safari запускает видео без звука в строке только при атрибутах
//   muted и playsinline. Без playsinline видео открывается на весь экран или не стартует.

const KEY_PAGES = ['/', ...urlSweepList.urlsToCheck.map((p) => p.path)];

// defaultBrowserType из устройства убираем: Playwright запрещает его внутри describe
// (он принудительно создаёт отдельный worker). Браузер задаёт проект, а не этот тест.
const { defaultBrowserType: _ignoredBrowser, ...IPHONE_13 } = devices['iPhone 13'];

test.describe('Mobile touch and autoplay on iPhone (#20)', () => {
  test.use(IPHONE_13);

  test('solid primary buttons are at least 24 px high (WCAG 2.2 AA)', async ({ page }) => {
    for (const path of ['/', '/pricing/']) {
      await page.goto(path, { waitUntil: 'load' });
      await page.waitForTimeout(1500);

      // Сайт пересобран на Astro 2026-10 — .elementor-button заменён на .cta
      // (или *__cta на отдельных мини-сайтах вроде /business/), разведка
      // 2026-10-27, см. тот же приём в tests/cta-buttons.spec.ts.
      const buttons = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[class*="cta" i], button[class*="cta" i]'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const bg = getComputedStyle(el).backgroundColor;
            return r.width > 0 && r.height > 0 && bg !== 'rgba(0, 0, 0, 0)' && !el.closest('header, footer, nav, .a11y__panel');
          })
          .map((el) => ({
            text: (el.textContent || '').trim().slice(0, 30),
            height: Math.round(el.getBoundingClientRect().height),
          }))
      );

      expect(buttons.length, `No button with a background found on ${path}`).toBeGreaterThan(0);
      const tooSmall = buttons.filter((b) => b.height < 24);
      expect(tooSmall, `Buttons under 24px on ${path}: ${JSON.stringify(tooSmall)}`).toEqual([]);

      const below44 = buttons.filter((b) => b.height < 44).length;
      test.info().annotations.push({ type: `buttons-below-44px-${path}`, description: String(below44) });
    }
  });

  for (const path of KEY_PAGES) {
    test(`autoplay videos on ${path} are muted and playsinline`, async ({ page, browserName }) => {
      // DOM-проверка не зависит от движка: достаточно одного браузера.
      test.skip(browserName !== 'chromium', 'DOM check: one browser is enough');
      await page.goto(path, { waitUntil: 'load' });
      await page.waitForTimeout(1500);

      const offenders = await page.evaluate(() =>
        Array.from(document.querySelectorAll('video'))
          .filter((v) => v.autoplay)
          .filter((v) => !v.muted || !v.hasAttribute('playsinline'))
          .map((v) => ({
            src: (v.currentSrc || v.getAttribute('src') || '').split('/').pop(),
            muted: v.muted,
            playsinline: v.hasAttribute('playsinline'),
          }))
      );

      expect(
        offenders,
        `Autoplay video on ${path} without muted or playsinline — won't start inline on iPhone: ${JSON.stringify(offenders)}`
      ).toEqual([]);
    });
  }
});

test.describe('Keyboard and screen-reader basics (#20)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('tabbing through the homepage shows a visible focus ring on most stops', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(1500);

    const stops: boolean[] = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== '' && cs.boxShadow !== 'none');
      });
      if (ring !== null) stops.push(ring);
    }

    expect(stops.length, 'The Tab key does not move focus to page elements').toBeGreaterThan(10);
    const withRing = stops.filter(Boolean).length;
    expect(withRing / stops.length, `Only ${withRing} of ${stops.length} Tab stops had a visible focus ring`).toBeGreaterThanOrEqual(0.8);
  });

  for (const path of KEY_PAGES) {
    test(`every visible link on ${path} has an accessible name`, async ({ page, browserName }) => {
      // DOM-проверка не зависит от движка: достаточно одного браузера.
      test.skip(browserName !== 'chromium', 'DOM check: one browser is enough');
      await page.goto(path, { waitUntil: 'load' });
      await page.waitForTimeout(1500);

      const unnamed = await page.evaluate(() => {
        const out: string[] = [];
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          const r = a.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // По согласованию с клиентом (2026-10-28) не считаем:
          // - ссылки, которые браузер не отрисовывает (checkVisibility() =
          //   false) — например, внутри свёрнутого FAQ-аккордеона: у них
          //   ненулевой прямоугольник, но текст не виден и не озвучивается;
          // - намеренно скрытые от скринридера дубли (aria-hidden="true" +
          //   tabindex="-1") — миниатюры подкастов рядом со ссылкой-заголовком.
          if (!(a as HTMLElement).checkVisibility()) continue;
          if (a.getAttribute('aria-hidden') === 'true' && a.getAttribute('tabindex') === '-1') continue;
          const name = (
            a.getAttribute('aria-label') ||
            (a as HTMLElement).innerText ||
            a.getAttribute('title') ||
            Array.from(a.querySelectorAll('img')).map((i) => i.alt).join(' ') ||
            ''
          ).trim();
          if (!name) out.push(a.getAttribute('href') || '');
        }
        return out;
      });

      expect(unnamed, `Visible links on ${path} with no accessible name (a screen reader would just say "link"): ${JSON.stringify(unnamed)}`).toEqual([]);
    });
  }
});
