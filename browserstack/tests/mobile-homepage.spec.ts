import { test, expect, Page } from './fixtures';

// Мобильная проверка на реальном iPhone 15 / iOS 17 (checklist #19/#20/#17/#18).
// Одна сессия BrowserStack = один тест: допускается только один браузерный контекст
// на сессию ("Only one browser context is allowed"), поэтому главная и воронка идут в
// одном тесте, а не в двух.
//
// Сайт пересобран на Astro 2026-10 (разведка 2026-10-27, см. pages/MobileOnboardingPage.ts
// и pages/quizWalker.ts в основном наборе — те же находки, просто здесь без импорта оттуда):
// - никакого промо-попапа на мобильном больше нет;
// - hero-кнопка «Get started» в хедере — обычная <a class="cta cta--header" href="/step-2/">,
//   но реальный тап перехватывается JS сайта и ведёт на /q/ — отдельный онбординг из
//   ~13 экранов, который заканчивается экраном «Check your email on desktop».
// - /q/ использует тот же виджет-движок, что /photo-quiz/ и /video/questionnaire/ в
//   основном наборе: один <section class="mq-screen" data-step> виден за раз, вопрос —
//   fieldset[data-question] с radio/checkbox, кнопка продвижения — везде одна и та же,
//   [data-quiz-next] (задизейблена через aria-disabled="true" до ответа).
//
// Цепочка воронки — в этом файле, а не импортом из основного набора: тот тянет
// @playwright/test другой версии (1.63), а здесь 1.49.1.

const HERO_CTA = 'header a.cta';

// Проходит онбординг /q/ до экрана email. Вопросы/интерстишлы — через общую механику
// .mq-screen/fieldset[data-question]/[data-quiz-next]; экран имени — текстовые поля,
// обрабатывается отдельно (та же логика, что в pages/MobileOnboardingPage.ts).
async function walkOnboardingToEmail(page: Page): Promise<number> {
  let answered = 0;

  for (let step = 0; step < 30; step++) {
    if (await page.locator('.mq-screen:not([hidden]) #q-email').count()) return answered;

    const nameScreen = page.locator('.mq-screen:not([hidden]) #q-fname');
    if (await nameScreen.count()) {
      await nameScreen.fill('Playwright');
      await page.locator('.mq-screen:not([hidden]) #q-lname').fill('QA');
      await page.locator('.mq-screen:not([hidden]) [data-quiz-next]').click();
      await page.waitForTimeout(1200);
      continue;
    }

    const state = await page.evaluate(() => {
      const visible = document.querySelector('.mq-screen:not([hidden])');
      if (!visible) return { noScreen: true as const };
      const fieldset = visible.querySelector('fieldset[data-question]');
      const next = visible.querySelector('[data-quiz-next]');
      return {
        noScreen: false as const,
        hasQuestion: !!fieldset,
        answered: fieldset ? fieldset.querySelectorAll('input:checked').length > 0 : true,
        hasNext: !!next,
        nextDisabled: next ? next.getAttribute('aria-disabled') === 'true' : true,
      };
    });
    if (state.noScreen) throw new Error('Онбординг покинул /q/ раньше, чем дошёл до экрана email');

    if (state.hasQuestion && !state.answered) {
      await page.evaluate(() => {
        const v = document.querySelector('.mq-screen:not([hidden])');
        (v?.querySelector('fieldset[data-question] label') as HTMLElement | null)?.click();
      });
      answered++;
      await page.waitForTimeout(400);
      continue;
    }

    if (state.hasNext && !state.nextDisabled) {
      await page.evaluate(() => {
        const v = document.querySelector('.mq-screen:not([hidden])');
        (v?.querySelector('[data-quiz-next]') as HTMLElement | null)?.click();
      });
      await page.waitForTimeout(700);
      continue;
    }

    await page.waitForTimeout(1000);
  }
  throw new Error('Онбординг не дошёл до экрана email за 30 шагов');
}

test('mobile smoke on a real iPhone: homepage, onboarding to the email screen', async ({ page }, testInfo) => {
  // Главная (до 120 с ожидания body) + онбординг на реальном устройстве — больше 180 с.
  test.setTimeout(300000);

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message.slice(0, 160)));

  const started = Date.now();
  await page.goto('/', { waitUntil: 'commit' });

  let bodyReadyMs = -1;
  while (Date.now() - started < 120000) {
    const bodyLen = await page.evaluate(() => (document.body?.innerText || '').length).catch(() => 0);
    if (bodyLen > 500) {
      bodyReadyMs = Date.now() - started;
      break;
    }
    await page.waitForTimeout(2000);
  }
  testInfo.annotations.push({ type: 'homepage-body-ready-ms', description: String(bodyReadyMs) });
  expect(bodyReadyMs, 'Тело главной на реальном iPhone не появилось за 120 секунд').toBeGreaterThan(0);

  await expect(page).toHaveTitle(/Imagen/i);
  expect(
    consoleErrors.filter((t) => !/amazon-adsystem|pinterest|pocketscience|ipify|ERR_FAILED|CORS/i.test(t)),
    'Ошибки в консоли на мобильной главной'
  ).toEqual([]);

  // Воронка.
  const cta = page.locator(HERO_CTA).filter({ hasText: /get started/i }).first();
  await expect(cta, 'На реальном iPhone не нашлась hero-кнопка «Get started»').toBeAttached({ timeout: 15000 });
  await cta.scrollIntoViewIfNeeded();

  // Диагностика выводится прямо в тексте ошибки: аннотации в логе BrowserStack видны
  // только как [Object], а текст падения попадает в консоль целиком.
  const ctaInfo = await cta.evaluate((el) => ({
    cursor: getComputedStyle(el).cursor,
    href: el.getAttribute('href'),
    hit: (() => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit ? `${hit.tagName}.${String(hit.className).slice(0, 50)}` : 'null';
    })(),
  }));
  const diag: string[] = [`cursor=${ctaInfo.cursor}`, `href=${ctaInfo.href}`, `под центром: ${ctaInfo.hit}`];
  diag.push(`pageerror: ${pageErrors.slice(0, 3).join(' || ') || 'нет'}`);

  // Настоящее касание в нейтральной точке на всякий случай (сайт больше не откладывает
  // свой JS до первого действия пользователя, как раньше WP Rocket, но лишним не будет).
  await page.touchscreen.tap(30, 260).catch((e: Error) => diag.push(`касание: ${e.message.slice(0, 60)}`));
  await page.waitForTimeout(300);

  // Один настоящий тап. Повторные тапы на этом устройстве однажды зависли на 60 с,
  // поэтому дальше не тапаем, а пробуем программный клик.
  let activatedBy = 'none';
  await cta.tap({ timeout: 15000 }).catch((e: Error) => diag.push(`тап: ${e.message.split('\n')[0].slice(0, 100)}`));
  await page.waitForURL(/\/q\//, { timeout: 6000 }).catch(() => {});
  if (/\/q\//.test(new URL(page.url()).pathname)) {
    activatedBy = 'tap';
  } else {
    diag.push(`после тапа: ${new URL(page.url()).pathname}`);
    await cta.evaluate((el) => (el as HTMLElement).click()).catch((e: Error) => diag.push(`js-клик: ${e.message.slice(0, 80)}`));
    await page.waitForURL(/\/q\//, { timeout: 6000 }).catch(() => {});
    if (/\/q\//.test(new URL(page.url()).pathname)) {
      activatedBy = 'js-click';
    } else {
      diag.push(`после js-клика: ${new URL(page.url()).pathname}`);
    }
  }
  testInfo.annotations.push({ type: 'hero-activated-by', description: activatedBy });

  // Мягкая проверка: дефект hero-кнопки на iOS фиксируется красным, но тест продолжает
  // проверять саму воронку — открываем /q/ напрямую. Так падение кнопки не прячет
  // падение онбординга и экрана отправки, и наоборот.
  expect.soft(activatedBy, `Hero-кнопка на iPhone не привела на /q/. ${diag.join(' | ')}`).not.toBe('none');
  if (activatedBy === 'none') {
    await page.goto('/q/', { waitUntil: 'load' });
  }
  const answered = await walkOnboardingToEmail(page);
  testInfo.annotations.push({ type: 'onboarding-answers', description: String(answered) });
  expect(answered, 'Онбординг на iPhone должен задать хотя бы 5 вопросов').toBeGreaterThanOrEqual(5);

  const email = `playwright-qa-test-${Date.now()}@example.com`;
  await page.locator('#q-email').fill(email);
  // #q-terms уже отмечен по умолчанию (как на основном step-2) — не трогаем.
  await page.locator('.mq-screen:not([hidden]) [data-quiz-next]').tap();

  await expect(page.getByText(/check your email on desktop/i), 'После email на iPhone не показан экран «Check your email on desktop»').toBeVisible({ timeout: 15000 });
  await expect(page.getByText(email), 'Экран «Check your email» не показывает введённый адрес').toBeVisible();
});
