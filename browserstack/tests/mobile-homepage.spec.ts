import { test, expect, Page } from './fixtures';

// Мобильная проверка на реальном iPhone 15 / iOS 17 (checklist #19/#20/#17/#18).
// Одна сессия BrowserStack = один тест: допускается только один браузерный контекст
// на сессию ("Only one browser context is allowed"), поэтому главная и воронка идут в
// одном тесте, а не в двух.
//
// Что подтверждено на реальном устройстве (2026-10-05):
// - <body> главной появляется не сразу: ~18 с в одном прогоне, больше 60 с в другом —
//   фиксируем время, а не падаем на ожидании;
// - при загрузке открывается промо-попап Elementor, он перекрывает hero-кнопку. Его
//   надо закрыть крестиком — так же поступит посетитель;
// - hero-кнопка на мобильном — <a> без href, тап ведёт на /q/: отдельный онбординг из
//   ~12 экранов, который заканчивается экраном «Check your email on desktop» (ссылка
//   уходит на почту, а не на телефон).
//
// Цепочка воронки — в этом файле, а не импортом из основного набора: тот тянет
// @playwright/test другой версии (1.63), а здесь 1.49.1.

// :visible — в DOM есть и скрытый дубликат крестика (этот селектор работает и в 1.49).
const PROMO_CLOSE = '.elementor-popup-modal a.dialog-close-button[aria-label="Close"]:visible';
const HERO_CTA = 'xpath=//a[contains(@class,"elementor-button") and not(@href) and not(ancestor::header)]';

async function closePromoIfShown(page: Page): Promise<boolean> {
  const close = page.locator(PROMO_CLOSE).first();
  const shown = await close.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false);
  if (!shown) return false;
  await close.tap().catch(() => close.click());
  await close.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  return true;
}

// Проходит онбординг /q/ до экрана email. Вопросы — первым вариантом, интерстициалы —
// «Continue», экран имени — заполняем. Идём по тексту экрана, а не по номерам шагов.
async function walkOnboardingToEmail(page: Page): Promise<number> {
  let answered = 0;
  let lastBody = '';
  let repeats = 0;

  for (let step = 0; step < 30; step++) {
    const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
    if (/Where to send your link/i.test(body)) return answered;

    repeats = body === lastBody ? repeats + 1 : 0;
    lastBody = body;
    expect(repeats, `Онбординг завис на экране: «${body.slice(0, 120)}»`).toBeLessThan(3);

    if (/What's your name/i.test(body)) {
      await page.getByPlaceholder('First name').fill('Playwright');
      await page.getByPlaceholder('Last name').fill('QA');
      await page.getByText('Continue', { exact: true }).first().tap();
      await page.waitForTimeout(1500);
      continue;
    }

    const option = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('button, a, [role=button], div, span, label'))
        .filter((el) => {
          const text = ((el as HTMLElement).innerText || '').trim();
          return !!text && text.length <= 40 && !!(el as HTMLElement).offsetParent;
        })
        .map((el) => ((el as HTMLElement).innerText || '').trim().split('\n')[0]);
      const unique = Array.from(new Set(items));
      return unique.includes('Continue') ? 'Continue' : unique[0] ?? null;
    });
    expect(option, `Нет варианта или «Continue» на экране: «${body.slice(0, 120)}»`).not.toBeNull();
    if (option !== 'Continue') answered++;
    await page.getByText(option!, { exact: true }).first().tap();
    await page.waitForTimeout(1200);
  }
  throw new Error('Онбординг не дошёл до экрана email за 30 шагов');
}

test('mobile smoke on a real iPhone: homepage, promo popup, onboarding to the email screen', async ({ page }, testInfo) => {
  // Главная (до 120 с ожидания body) + онбординг на реальном устройстве — больше 180 с.
  test.setTimeout(300000);

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  // Неперехваченные исключения приходят не как console.error, а как pageerror — без этого
  // упавший на iOS скрипт Elementor в отчёте был бы невидим.
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
  const popupClosed = await closePromoIfShown(page);
  testInfo.annotations.push({ type: 'promo-popup-shown-on-load', description: String(popupClosed) });

  const cta = page.locator(HERO_CTA).filter({ hasText: /get started/i }).first();
  await expect(cta, 'На реальном iPhone не нашлась hero-кнопка «Get started»').toBeAttached({ timeout: 15000 });
  await cta.scrollIntoViewIfNeeded();

  // Диагностика выводится прямо в тексте ошибки: аннотации в логе BrowserStack видны
  // только как [Object], а текст падения попадает в консоль целиком.
  const hitAtCta = () =>
    cta.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit ? `${hit.tagName}.${String(hit.className).slice(0, 50)}` : 'null';
    }).catch((e: Error) => `ошибка: ${e.message.slice(0, 60)}`);

  // Что стоит под кнопкой и как она объявлена: iOS Safari не отдаёт touch-клик
  // элементу без href и без cursor:pointer, а десктопный мышиный клик — отдаёт.
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

  // Состояние Elementor до и после реального скролла. WP Rocket откладывает JS до первого
  // действия пользователя: если elementorFrontend не поднят, обработчик hero-кнопки ещё
  // не привязан — тап ничего не сделает.
  const elementorState = () =>
    page.evaluate(() => ({
      elementorFrontend: typeof (window as unknown as { elementorFrontend?: unknown }).elementorFrontend,
      rocketDelayedScripts: document.querySelectorAll('script[data-rocket-src], script[data-rocketsrc]').length,
    }));
  diag.push(`до скролла: ${JSON.stringify(await elementorState())}`);
  const elementorScript = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource').map((e) => e.name);
    return {
      frontendLoaded: entries.some((n) => /elementor\/assets\/js\/frontend/.test(n)),
      frontendRequested: document.querySelectorAll('script[src*="elementor/assets/js/frontend"]').length,
    };
  });
  diag.push(`скрипт Elementor: ${JSON.stringify(elementorScript)}`);
  const htmlFacts = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    return {
      htmlLen: html.length,
      scripts: document.scripts.length,
      mentionsFrontend: html.includes('elementor/assets/js/frontend'),
      mentionsRocket: html.includes('rocket'),
      ua: navigator.userAgent.slice(0, 90),
    };
  });
  diag.push(`HTML: ${JSON.stringify(htmlFacts)}`);
  diag.push(`pageerror: ${pageErrors.slice(0, 3).join(' || ') || 'нет'}`);

  // Настоящее касание в нейтральной точке — WP Rocket запускает отложенный JS именно по
  // реальному вводу. Программный scrollBy/click этим не считаются.
  await page.touchscreen.tap(30, 260).catch((e: Error) => diag.push(`касание: ${e.message.slice(0, 60)}`));
  await page
    .waitForFunction(() => typeof (window as unknown as { elementorFrontend?: unknown }).elementorFrontend === 'object', null, { timeout: 12000 })
    .catch(() => {});
  diag.push(`после касания: ${JSON.stringify(await elementorState())}`);

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
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByText('Send me the download link', { exact: true }).first().tap();

  await expect(page.getByText(/check your email on desktop/i), 'После email на iPhone не показан экран «Check your email on desktop»').toBeVisible({ timeout: 15000 });
  await expect(page.getByText(email), 'Экран «Check your email» не показывает введённый адрес').toBeVisible();
});
