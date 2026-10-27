import { test, expect } from './fixtures';
import { TEST_EMAIL } from '../pages/testData';

// A/B-тест клиента на /intelligent-studio/ (запрос 2026-10-26: "intelligent_studio_1
// against intelligent_studio_2 running on page /intelligent-studio/").
//
// Как это устроено на сайте (разведка 2026-10-27, инлайн-скрипт в <head>):
// - вариант хранится в cookie site_version_site (intelligent_studio_1 / _2),
//   выбирается случайно 50/50 при первом заходе и "липнет" на сутки;
// - скрипт до первой отрисовки пишет его в <html data-site-version="...">, а CSS
//   переключает вёрстку по этому атрибуту — без мигания второй версии;
// - сводная cookie site_version = "<site>|<quiz>" уходит во все события аналитики;
// - для QA есть принудительный параметр ?site_version=intelligent_studio_2.
//
// Чем отличаются версии (проверено вживую, десктоп):
// - _1: hero по центру, отдельный блок .swatch с кнопкой «I want in»;
// - _2: hero в две колонки (текст + видео .shero__media), кнопка «I want in» прямо
//   в шапке страницы (.shdr__cta), блок .swatch скрыт.
// Общее у обеих: форма листа ожидания (form.wlist, #studio-email) — главная
// конверсия страницы.
//
// Вариант задаём cookie ДО загрузки — так же, как его потом читает сайт у реального
// посетителя (а не параметром, который сайт считает QA-оверрайдом).

const VARIANTS = [
  {
    name: 'intelligent_studio_1',
    cta: '.swatch__cta',
    visible: ['.swatch', '.swatch__cta'],
    hidden: ['.shdr__cta'],
  },
  {
    name: 'intelligent_studio_2',
    cta: '.shdr__cta',
    visible: ['.shdr__cta', '.shero__media'],
    hidden: ['.swatch'],
  },
];

test.describe('Intelligent Studio A/B variants (/intelligent-studio/)', () => {
  for (const variant of VARIANTS) {
    test.describe(variant.name, () => {
      test.beforeEach(async ({ page, context }) => {
        await context.addCookies([
          { name: 'site_version_site', value: variant.name, domain: '.imagen-ai.com', path: '/' },
        ]);
        await page.goto('/intelligent-studio/', { waitUntil: 'load' });
      });

      test('the site applies the requested variant', async ({ page }) => {
        await expect(page.locator('html'), `Page did not switch to ${variant.name}`).toHaveAttribute(
          'data-site-version',
          variant.name
        );
        const combined = (await page.context().cookies()).find((c) => c.name === 'site_version')?.value ?? '';
        expect(combined, 'The site_version analytics cookie does not carry the variant').toContain(variant.name);
      });

      test('the variant-specific layout is shown', async ({ page }) => {
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        for (const selector of variant.visible) {
          await expect(page.locator(selector).first(), `${selector} should be visible in ${variant.name}`).toBeVisible();
        }
        for (const selector of variant.hidden) {
          await expect(page.locator(selector).first(), `${selector} should be hidden in ${variant.name}`).toBeHidden();
        }
      });

      test('"I want in" leads to the waitlist email field', async ({ page }) => {
        // Докручиваем до кнопки колесом, как посетитель, а не мгновенным прыжком
        // Playwright: при прыжке ленивый контент выше не успевает подгрузиться, и
        // плавная прокрутка сайта обратно к полю считает цель неверно — застревает
        // на полпути (проверено 2026-10-27: при прокрутке колесом всегда доходит).
        const cta = page.locator(variant.cta).first();
        await page.mouse.move(640, 400);
        for (let i = 0; i < 80 && !(await cta.isVisible() && (await cta.boundingBox())!.y < 600); i++) {
          await page.mouse.wheel(0, 120);
          await page.waitForTimeout(60);
        }
        await page.waitForTimeout(800);
        await cta.click();
        await expect(page.locator('#studio-email'), 'The waitlist email field did not come into view').toBeInViewport();
      });

      test('the waitlist form accepts an email', async ({ page, browserName }) => {
        // Каждая отправка — реальная запись в лист ожидания клиента: одного браузера хватит.
        test.skip(browserName !== 'chromium', 'Real waitlist signup: one browser is enough');

        await page.locator('#studio-email').fill(TEST_EMAIL);
        // Та же анти-бот защита, что на /step-2/ (form-guard: не раньше 2 с после загрузки).
        await page.waitForTimeout(2500);
        await page.locator('button.wlist__submit').click();

        await expect(page.locator('.wlist__done'), 'No "You’re in" confirmation after joining the waitlist').toBeVisible({
          timeout: 15000,
        });
      });
    });
  }

  test('the ?site_version= QA override switches the variant', async ({ page }) => {
    await page.goto('/intelligent-studio/?site_version=intelligent_studio_2', { waitUntil: 'load' });
    await expect(page.locator('html')).toHaveAttribute('data-site-version', 'intelligent_studio_2');
  });
});
