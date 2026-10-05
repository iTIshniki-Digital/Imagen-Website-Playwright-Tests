import { test, expect } from './fixtures';
import { wakeUpPageScripts } from '../pages/pageActivation';

// checklist #12 — локализованная воронка. Подтверждено вживую 2026-10-05 на всех
// 8 локалях:
// - hero-кнопка на каждой локали — это <a> без href с переведённым текстом
//   («Comece agora», «Empezar», «시작하기», «Démarrer», «Jetzt loslegen», «始める»,
//   «Inizia subito»), email-поля в hero на локалях нет. Клик ведёт на
//   /<локаль>/step-2/. Прежний HomePage.continueToStepTwo() искал английский текст
//   и форму #go_to_step2_new_hp — на локалях он не найдёт hero, поэтому здесь свой
//   локатор, не привязанный к языку.
// - форма step-2 на всех локалях та же (id step2, те же поля), меняется только язык
//   текста и кнопки отправки.
//
// Клик по hero идёт после «разогрева» страницы (колесо мыши), как у посетителя: без
// него JS Elementor (WP Rocket) ещё не поднят, и клик может не сработать.
//
// Что НЕ проверяем здесь: отправку формы на локалях и дальнейший квиз — это тот же
// блок, что и на английской версии (quiz-full-walkthrough.spec.ts).

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
      await wakeUpPageScripts(page);

      // Попап Elementor (промо) на десктопе тоже может перекрыть hero — закрываем, как
      // на мобильной версии. Если его нет, ничего не делаем.
      const close = page.locator('.elementor-popup-modal a.dialog-close-button[aria-label="Close"]').first();
      if (await close.isVisible().catch(() => false)) await close.click();

      const cta = page.locator('xpath=//a[contains(@class,"elementor-button") and not(@href) and not(ancestor::header)]').filter({ hasText: /\S/ }).first();
      await expect(cta, `На ${path} не нашлась hero-кнопка без href`).toBeAttached();
      await cta.scrollIntoViewIfNeeded();
      // Обработчик hero-кнопки (без href) подключается чуть позже самого Elementor —
      // первый клик на свежей странице иногда не срабатывает (и на /es/, /fr/ так и было
      // в разведке). Повторяем клик до 3 раз и пишем, сколько понадобилось, — это видно в
      // отчёте, а не прячется. Посетитель обычно кликает не мгновенно, поэтому так и делаем.
      const expectedPath = `${path}step-2`;
      const onStepTwo = (url: URL) => url.pathname.replace(/\/$/, '') === expectedPath;
      let clicks = 0;
      for (let attempt = 1; attempt <= 3 && !onStepTwo(new URL(page.url())); attempt++) {
        const box = await cta.boundingBox().catch(() => null);
        if (!box) {
          // Кнопка уже пропала — значит, страница уходит на step-2. Ждём переход, а не падаем.
          await page.waitForURL(onStepTwo, { timeout: 5000 }).catch(() => {});
          break;
        }
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        clicks = attempt;
        await page.waitForURL(onStepTwo, { timeout: 2500 }).catch(() => {});
      }
      test.info().annotations.push({ type: 'hero-clicks-to-step-2', description: String(clicks) });

      // Сравниваем путь, а не регулярку: префикс локали (/br/, /kr/…) легко сломать экранированием.
      expect(new URL(page.url()).pathname.replace(/\/$/, ''), `Hero-кнопка на ${path} не привела на ${expectedPath} (3 клика)`).toBe(expectedPath);

      await expect(page.locator('form#step2'), `На ${path}step-2 нет формы #step2`).toBeVisible();
      await expect(page.locator('#step_2_email'), `На ${path}step-2 нет поля email`).toBeVisible();

      // Текст кнопки отправки должен быть переведён, а не английский «Sign up & download»
      // (для английской версии — проверка просто что кнопка есть).
      const submit = (await page.locator('form#step2').getByRole('button').first().innerText()).trim();
      expect(submit.length, `На ${path}step-2 пустая кнопка отправки`).toBeGreaterThan(0);
      if (path !== '/') {
        expect(submit, `На ${path}step-2 кнопка отправки осталась на английском`).not.toMatch(/Sign up & download/);
      }
    });
  }
});
