// checklist #21 (Mac Safari) + проверки, которые Playwright-коннектор BrowserStack
// не умеет вести на десктопном Safari.
//
// Почему Selenium, а не Playwright: browserType.connect у BrowserStack принимает
// только chrome/edge/firefox/webkit — Safari.app для десктопа через него не
// запускается ("Invalid 'browser'"). Через их Automate (WebDriver) настоящий
// Safari 17 на macOS Sonoma поднимается и открывает сайт — проверено 2026-10-05.
//
// Запуск: npm run test:safari (креды берутся из ../.env через dotenv-cli).
//
// Ограничение, которое видно в тестах ниже: WebDriver не умеет задавать
// произвольные HTTP-заголовки, поэтому x-e2e-bypass (для WAF Cloudflare) здесь
// не передаётся. Cloudflare иногда отдаёт страницу проверки «Just a moment…» —
// её ждём, а не считаем падением. Жёсткого блока (Attention Required) в ~6 сессиях
// подряд не было, но он возможен.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Builder, By, until } = require('selenium-webdriver');

const SITE = 'https://imagen-ai.com';
const API = 'https://app-web-server.imagen-ai-op.com/website/get_pricing';
const CHALLENGE = /just a moment|attention required/i;

const bstackOptions = {
  os: 'OS X',
  osVersion: 'Sonoma',
  browserVersion: 'latest',
  userName: process.env.BROWSERSTACK_USERNAME,
  accessKey: process.env.BROWSERSTACK_ACCESS_KEY,
  projectName: 'imagen-qa',
  buildName: 'desktop-safari',
};

let driver;

// Ждём, пока Cloudflare пропустит на реальную страницу (до 60 с). Если страница
// проверки не сменилась — возвращаем false: тест пропускается, а не падает. Это барьер
// для автоматизированной сессии, а не результат проверки сайта. Видно в отчёте как skip.
async function openPage(path) {
  await driver.get(SITE + path);
  for (let i = 0; i < 30; i++) {
    const title = await driver.getTitle();
    if (!CHALLENGE.test(title)) return true;
    await driver.sleep(2000);
  }
  return false;
}

const CF_SKIP = 'Cloudflare не пропустил сессию BrowserStack (страница проверки «Just a moment…» не сменилась за 60 с). Нужно разрешить трафик BrowserStack для Safari-прогонов — см. «Что нужно от клиента».';

// Сайт пересобран на Astro 2026-10 — Elementor/WP Rocket больше нет, поэтому
// отложенной инициализации JS, которую раньше ждал wakeUp(), тоже нет. Оставлен
// упрощённый вариант (реальное движение мыши/колесо) просто как имитация
// настоящего посетителя, без ожидания elementorFrontend.
async function wakeUp() {
  await driver.actions().move({ x: 300, y: 300 }).perform();
  await driver.executeScript('window.scrollBy(0, 150);');
  await driver.sleep(500);
  await driver.executeScript('window.scrollBy(0, -150);');
  await driver.sleep(300);
}

// Каждый тест — своя сессия. Cloudflare обычно пропускает первую загрузку сессии,
// а вторая в той же сессии часто застревает на проверке, поэтому не переиспользуем.
beforeEach(async () => {
  driver = await new Builder()
    .usingServer('https://hub.browserstack.com/wd/hub')
    .withCapabilities({ browserName: 'Safari', 'bstack:options': { ...bstackOptions, sessionName: 'desktop safari' } })
    .build();
  await driver.manage().window().setRect({ width: 1280, height: 900 }).catch(() => {});
});

afterEach(async () => {
  if (driver) await driver.quit().catch(() => {});
  driver = undefined;
});

describe('Desktop Safari (macOS Sonoma, Safari 17)', () => {
  test('homepage loads with the right title and a visible header CTA', async (t) => {
    if (!(await openPage('/'))) return t.skip(CF_SKIP);
    assert.match(await driver.getTitle(), /Imagen/i);

    const cta = await driver.findElements(By.xpath('//header//a[contains(translate(., "GETSARTED", "getsarted"), "get started")]'));
    assert.ok(cta.length > 0, 'В шапке не нашлась кнопка «Get Started»');
    assert.ok(await cta[0].isDisplayed(), '«Get Started» в шапке не видна');
  });

  test('FAQ accordion opens on click', async (t) => {
    if (!(await openPage('/'))) return t.skip(CF_SKIP);
    await wakeUp();

    // Сайт пересобран на Astro 2026-10 — тот же нативный <details>/<summary>,
    // что был у Elementor-аккордеона, просто под классами .faq__row/.faq__q
    // (разведка 2026-10-27, см. tests/interactive-widgets.spec.ts в основном наборе).
    const title = await driver.findElement(By.css('.faq__q'));
    await driver.executeScript('arguments[0].scrollIntoView({block: "center"});', title);
    await driver.sleep(300);
    await title.click();
    await driver.sleep(800);

    const open = await driver.executeScript('return document.querySelector(".faq__row").open;');
    assert.equal(open, true, 'Аккордеон на Safari не открылся после клика');
  });

  test('homepage carousel moves to another slide', async (t) => {
    if (!(await openPage('/'))) return t.skip(CF_SKIP);
    await wakeUp();

    // Сайт пересобран на Astro 2026-10 — больше не Swiper, а обычный горизонтально
    // скроллящийся <ul>/<div> со стрелками data-step="1"/"-1" (разведка 2026-10-27,
    // см. tests/interactive-widgets.spec.ts в основном наборе). Контейнер со
    // scrollLeft ищем рядом с кнопкой — он не всегда сам <ul> (на /business/ это
    // родительский div), поэтому берём первый элемент с реальным горизонтальным
    // переполнением в пределах ближайших 4 уровней предков. Скрипт возвращает
    // ЧИСЛО (scrollLeft) или null — не DOM-элемент, тот через WebDriver не прочитать.
    const SCROLL_LEFT_SCRIPT = `
      function hasOverflow(el) { return el.scrollWidth - el.clientWidth > 20 && el.clientWidth > 100; }
      const btn = document.querySelector('button[data-step="1"]');
      if (!btn) return null;
      btn.scrollIntoView({ block: 'center' });
      let el = btn.parentElement;
      for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
        if (hasOverflow(el)) return el.scrollLeft;
        const candidate = Array.from(el.querySelectorAll('*')).find(hasOverflow);
        if (candidate) return candidate.scrollLeft;
      }
      return null;
    `;
    const scrollLeft = () => driver.executeScript(SCROLL_LEFT_SCRIPT);

    const before = await scrollLeft();
    if (before === null) return t.skip('На главной не нашлась карусель (button[data-step="1"]) — см. tests/interactive-widgets.spec.ts.');

    await driver.executeScript('document.querySelector(\'button[data-step="1"]\').click();');
    await driver.sleep(1200);
    const after = await scrollLeft();
    assert.notEqual(after, before, `Карусель на Safari не сдвинулась после «далее» (scrollLeft ${before} → ${after})`);
  });

  test('rendered pricing matches the API for the currency the page shows, with no blank slots', async (t) => {
    if (!(await openPage('/pricing/'))) return t.skip(CF_SKIP);
    await driver.sleep(2500);

    const rendered = await driver.executeScript(`
      const text = (k) => Array.from(document.querySelectorAll('[class*="price_' + k + '"]'))
        .map((e) => (e.textContent || '').trim()).find(Boolean) || '';
      const keys = ['mega_promo_limitless_monthly_price', 'straightening', 'pay_as_you_go', 'base_payment_price',
        'culling_monthly_price_for_annual_plan', 'cloud_storage_500_current_price',
        'flat_fee_plans_annual_limitless', 'flat_fee_plans_annual_limitless_save_amount_in_year'];
      const blank = Array.from(document.querySelectorAll('[class*="price_"]'))
        .filter((e) => (e.textContent || '').trim() === '' && e.parentElement && e.parentElement.getBoundingClientRect().width > 0)
        .map((e) => Array.from(e.classList).find((c) => c.startsWith('price_')));
      return { values: Object.fromEntries(keys.map((k) => [k, text(k)])), blank };
    `);

    assert.deepEqual(rendered.blank, [], `Пустые цены на Safari: ${rendered.blank.join(', ')}`);

    const symbolToCurrency = { '€': 'EUR', $: 'USD', '£': 'GBP' };
    const symbol = Object.keys(symbolToCurrency).find((s) => Object.values(rendered.values).some((v) => v.includes(s)));
    assert.ok(symbol, `Не удалось определить валюту по ценам: ${JSON.stringify(rendered.values)}`);
    const currency = symbolToCurrency[symbol];

    const api = await (await fetch(`${API}?currency=${currency}`)).json();
    const expected = {
      mega_promo_limitless_monthly_price: api.mega_promo_limitless_monthly_price,
      straightening: api.straightening,
      pay_as_you_go: api.pay_as_you_go,
      base_payment_price: api.base_payment_price,
      culling_monthly_price_for_annual_plan: api.culling_monthly_price_for_annual_plan,
      cloud_storage_500_current_price: api.cloud_storage_500_current_price,
      flat_fee_plans_annual_limitless: api.flat_fee_plans.annual.limitless.price,
      flat_fee_plans_annual_limitless_save_amount_in_year: api.flat_fee_plans.annual.limitless.save_amount_in_year,
    };

    for (const [key, apiValue] of Object.entries(expected)) {
      const shown = Number(rendered.values[key].replace(/[^\d.]/g, ''));
      assert.equal(shown, apiValue, `${key}: на Safari «${rendered.values[key]}», в API ${currency} ${apiValue}`);
    }
  });
});
