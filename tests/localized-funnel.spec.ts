import { test, expect } from './fixtures';
import { HomePage } from '../pages/HomePage';

// checklist #12 — локализованная воронка. Сайт пересобран на Astro
// 2026-10 — разведка 2026-10-27 нашла, что hero на локалях использует
// ТОТ ЖЕ компонент form.signup__form/#home-hero-email, что и английская
// версия (проверено на /es/, /kr/) — просто с переведённым label/
// placeholder. Больше нет ни Elementor-кнопки без href, ни WP Rocket
// "разогрева" колесом мыши, ни промо-попапа — переиспользуем HomePage
// целиком вместо отдельной хрупкой логики под каждую локаль.
//
// Что НЕ проверяем здесь: отправку формы на локалях и дальнейший квиз —
// это тот же блок, что и на английской версии (quiz-full-walkthrough.spec.ts).

const LOCALES = [
  { path: '/', lang: 'en' },
  { path: '/br/', lang: 'br' },
  { path: '/es/', lang: 'es' },
  { path: '/kr/', lang: 'kr' },
  { path: '/fr/', lang: 'fr' },
  { path: '/de/', lang: 'de' },
  { path: '/ja/', lang: 'ja' },
  { path: '/it/', lang: 'it' },
];

test.describe('Localized funnel (#12)', () => {
  for (const { path } of LOCALES) {
    test(`hero CTA on ${path} leads to the localized step-2 form`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'load' });
      const homePage = new HomePage(page);

      await homePage.continueToStepTwo();

      // После валидного submit сайт уходит на step-2 не сразу, а после
      // отправки события аналитики (до ~0.5 с, клиент 2026-10-29) — в WebKit
      // page.url() сразу после клика ещё старый. Ждём переход, потом сверяем.
      const expectedPath = `${path}step-2`;
      await page.waitForURL((url) => url.pathname.replace(/\/$/, '') === expectedPath, { timeout: 10000 }).catch(() => {});
      expect(
        new URL(page.url()).pathname.replace(/\/$/, ''),
        `Hero button on ${path} didn't lead to ${expectedPath}`
      ).toBe(expectedPath);

      await expect(page.locator('form.s2__form'), `No step-2 form on ${path}step-2`).toBeVisible();
      await expect(page.locator('#s2-email'), `No email field on ${path}step-2`).toBeVisible();

      // Текст кнопки отправки должен быть переведён, а не английский «Sign up & download»
      // (для английской версии — проверка просто что кнопка есть).
      const submit = (await page.locator('button.s2__submit').innerText()).trim();
      expect(submit.length, `Empty submit button on ${path}step-2`).toBeGreaterThan(0);
      if (path !== '/') {
        expect(submit, `Submit button on ${path}step-2 is still in English`).not.toMatch(/Sign up & download/);
      }
    });
  }
});
