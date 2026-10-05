import { test, expect } from './fixtures';

// Мобильная проверка на реальном iPhone 15 / iOS 17 (checklist #19/#20).
// Повторяет базовые проверки главной без POM из основного набора: тот
// импортирует @playwright/test другой версии, а здесь используется 1.49.1.
//
// Один тест, а не несколько: BrowserStack допускает только один
// браузерный контекст на сессию ("Only one browser context is allowed").
//
// Что подтверждено на реальном устройстве (2026-10-05):
// - <body> главной появляется не сразу: ~18 с в одном прогоне, в другом
//   больше 60 с — фиксируем время, а не падаем на ожидании;
// - hero-CTA на мобильном не открывает email-форму так же, как на десктопе
//   (и на Pixel 5 вела на /q/) — воронка с мобильного вынесена в отдельную
//   разведку, здесь её не проверяем.
test('mobile smoke on a real iPhone: homepage loads with title and no console errors', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

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
});
