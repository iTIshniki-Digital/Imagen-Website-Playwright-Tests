import { test, expect } from './fixtures';
import urlSweepList from '../data/url-sweep-list.json';

// checklist #28 — раньше сделаны были только hero/nav/real-estate,
// остальные страницы пропущены из-за того, что подписи кнопок слишком
// разные для точного текстового совпадения. Вместо жёстко зашитых
// текстов проверяем структурно: у каждой ключевой страницы есть хотя бы
// одна видимая основная CTA-кнопка (Elementor .elementor-button вне
// header/footer/a11y-тулбара — тот же паттерн, что уже использует
// HomePage.heroLinkVariant для исключения хедера), и если у кнопки есть
// реальный href, он не ведёt на 4xx/5xx.
//
// Собираем кандидатов через page.evaluate (подтверждено вживую
// 2026-09-30 на всех 10 страницах списка — селектор находит настоящие
// CTA, а не шум тулбара) — дешевле и надёжнее, чем гонять Playwright-
// фильтры по XPath-предкам на каждой странице.
//
// /blog/ намеренно исключён — подтверждено вживую: это страница-лента
// статей без единой "главной" CTA-кнопки (только карточки "Read on Imagen
// blog" у каждой статьи), в отличие от остальных 9 страниц списка.
const PAGES_WITH_PRIMARY_CTA = urlSweepList.urlsToCheck.filter(({ path }) => path !== '/blog/');

test.describe('CTA buttons across key pages', () => {
  for (const { name, path } of PAGES_WITH_PRIMARY_CTA) {
    test(`${name} (${path}) has at least one working primary CTA`, async ({ page }) => {
      // На страницах с десятками under-CTA (напр. AI Tools — по кнопке
      // "Learn more" на каждый инструмент) дефолтных 30с не хватает на
      // обход всех уникальных ссылок — тот же случай, что и в
      // navigation-links.spec.ts.
      test.setTimeout(2 * 60 * 1000);

      await page.goto(path);
      await page.waitForTimeout(500);

      const ctas = await page.evaluate(() => {
        const isVisible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        };
        const excluded = 'header, footer, nav, .pojo-a11y-toolbar';
        return Array.from(
          document.querySelectorAll(
            'a.elementor-button, a.elementor-button-link, button.elementor-button, .elementor-button-wrapper a'
          )
        )
          .filter((el) => isVisible(el) && !el.closest(excluded))
          .map((el) => ({
            text: (el.textContent || '').trim(),
            href: el.getAttribute('href'),
          }));
      });

      expect(ctas.length, `На ${path} не нашлось ни одной видимой основной CTA-кнопки`).toBeGreaterThan(0);

      const checkedHrefs = new Set<string>();
      const broken: string[] = [];

      for (const cta of ctas) {
        // Подтверждено вживую 2026-09-30: href вида ".../pricing/#" или
        // ".../business/#contact" — это переход к якорю НА ТОЙ ЖЕ
        // странице (Elementor пишет его абсолютным URL, не просто "#"),
        // а не отдельная страница. page.goto на такой URL, когда мы уже
        // на этой странице, — навигация в рамках документа без реального
        // HTTP-ответа, поэтому response оказывается null и ложно
        // считается "битым". На сайте такой href ни разу не вёл на
        // отдельную страницу — пропускаем любой href с "#" целиком.
        if (!cta.href || cta.href.includes('#') || checkedHrefs.has(cta.href)) continue;
        checkedHrefs.add(cta.href);

        // page.goto (не page.request) — так же, как в navigation-links.spec.ts:
        // запрос идёт с теми же bypass-заголовками/cookies, что и у страницы
        // (см. tests/fixtures.ts), иначе Cloudflare ответит 403 на все подряд.
        const response = await page.goto(cta.href, { waitUntil: 'domcontentloaded' }).catch(() => null);
        const status = response?.status() ?? 0;
        if (!response || status >= 400) {
          broken.push(`${status} ${cta.href} ("${cta.text}")`);
        }
        await page.waitForTimeout(200);
      }

      expect(broken, `Битые CTA-ссылки на ${path}:\n${broken.join('\n')}`).toEqual([]);
    });
  }
});
