import { test as base, devices, expect, Browser, Page } from '@playwright/test';

// checklist #23 — что реально видит посетитель на /pricing/, а не только
// что отдаёт API.
//
// ВАЖНО про режим. Разведка 2026-10-05 нашла два источника цен на сайте:
// - обычная сессия: цены из WordPress-заглушек `price_<ключ>`, значения
//   вписаны на сервере, часть сумм пустая (это видит посетитель);
// - сессия с перехватом запросов (page.route): страница сама вызывает
//   get_pricing и заполняет все слоты значениями API.
// Что именно включает вызов API в обычной сессии, пока не выяснили. Поэтому
// эти тесты идут НАМЕРЕННО без перехвата (отдельный контекст, не фикстура
// `test` из tests/fixtures.ts — та всегда ставит page.route), чтобы
// проверять то, что видит обычный посетитель.
//
// Классы проверок:
// 1) Дефекты, видные обычному посетителю, — тест красный: это баг сайта.
// 2) Расхождения значений с API и валюта на локализованной странице — вопрос
//    к клиенту (какой источник правильный), помечены expected-fail с причиной.

const PRICING_API = 'https://app-web-server.imagen-ai-op.com/website/get_pricing';

// Пустые суммы в видимых карточках. Пустой span сам по себе имеет нулевой
// размер, поэтому проверяем родительский виджет карточки.
const BLANK_VISIBLE_SLOTS = `(() => {
  const isShown = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || n.hasAttribute('hidden')) return false;
    }
    return true;
  };
  return Array.from(document.querySelectorAll('[class*="price_"]'))
    .filter((el) => (el.textContent || '').trim() === '')
    .filter((el) => {
      const card = el.closest('.elementor-widget') || el.parentElement;
      return card && isShown(card) && card.getBoundingClientRect().width > 0;
    })
    .map((el) => Array.from(el.classList).find((c) => c.startsWith('price_')) || el.className);
})()`;

// Первый непустой отрендеренный текст слота с данным ключом.
function firstPriceText(page: Page, key: string): Promise<string> {
  return page.evaluate((k) => {
    const el = Array.from(document.querySelectorAll(`[class*="price_${k}"]`)).find(
      (e) => (e.textContent || '').trim() !== ''
    );
    return el ? (el.textContent || '').trim() : '';
  }, key);
}

// Обычная сессия, как у посетителя: без page.route, с Cloudflare-заголовком
// только для запросов к сайту (он уходит на домен клиента).
const test = base.extend<{ plainPage: Page }>({
  plainPage: async ({ browser }: { browser: Browser }, use) => {
    const token = process.env.E2E_BYPASS_TOKEN;
    const context = await browser.newContext({
      ...devices['Desktop Chrome'],
      baseURL: 'https://imagen-ai.com',
      extraHTTPHeaders: token ? { 'x-e2e-bypass': token } : {},
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

async function settle(page: Page): Promise<void> {
  // networkidle на /pricing/ не наступает (постоянные соединения), поэтому
  // только ограниченное ожидание загрузки и короткая пауза на отрисовку цен.
  await page.waitForLoadState('load');
  await page.waitForTimeout(3000);
}

test.describe('Rendered pricing on /pricing/ (#23)', () => {
  for (const path of ['/pricing/', '/de/pricing/']) {
    test(`no visible price slot is blank on ${path}`, async ({ plainPage: page }) => {
      await page.goto(path);
      await settle(page);

      const blank = await page.evaluate(BLANK_VISIBLE_SLOTS);
      expect(
        blank,
        `Blank amounts in visible cards on ${path} (${blank.join(', ')}): a visitor sees gaps instead of prices, e.g. "/monthly base fee" and "Save ___ /year"`
      ).toEqual([]);
    });
  }

  test('headline monthly promo price on /pricing/ matches the API (USD)', async ({ plainPage: page, request }) => {
    const response = await request.get(`${PRICING_API}?currency=USD`);
    expect(response.status()).toBe(200);
    const api = (await response.json()) as { mega_promo_limitless_monthly_price: number };

    await page.goto('/pricing/');
    await settle(page);

    const rendered = await firstPriceText(page, 'mega_promo_limitless_monthly_price');
    const amount = Number(rendered.replace(/[^\d.]/g, ''));
    expect(amount, `Promo price on /pricing/ is "${rendered}", API says ${api.mega_promo_limitless_monthly_price}`).toBe(
      api.mega_promo_limitless_monthly_price
    );
  });

  // Обычный (не expected-fail) тест. Подтверждено 2026-10-06 на трёх браузерах в обычной
  // сессии: в Firefox и WebKit страница вызывает get_pricing и показывает API ($0.01 за фото),
  // а в Chromium вызова нет и остаются значения WordPress ($0.2). Поэтому это дефект
  // Chromium, а не вопрос к клиенту: API — источник правды, и так его показывают другие браузеры.
  test('per-photo tool prices on /pricing/ equal the API values in every browser', async ({ plainPage: page, request }) => {
    const response = await request.get(`${PRICING_API}?currency=USD`);
    const api = (await response.json()) as Record<string, number>;
    const keys = ['straightening', 'crop', 'portrait_crop', 'headshot_crop', 'smooth_skin', 'subject_mask'];

    await page.goto('/pricing/');
    await settle(page);

    for (const key of keys) {
      const text = await firstPriceText(page, key);
      const shown = Number(text.replace(/[^\d.]/g, ''));
      expect(shown, `${key}: site shows "${text}", API says ${api[key]} (Chromium shows WordPress values in a plain session, Firefox/WebKit show the API value)`).toBe(api[key]);
    }
  });

  // Немецкая страница с ценами для посетителя БЕЗ cc_code (страна по IP раннера).
  test('localized /de/pricing/ renders prices (precondition)', async ({ plainPage: page }) => {
    await page.goto('/de/pricing/');
    await settle(page);
    const texts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[class*="price_"]'))
        .map((el) => (el.textContent || '').trim())
        .filter((t) => /\d/.test(t))
    );
    expect(texts.length, 'No rendered price found on /de/pricing/').toBeGreaterThan(0);
  });

  // Валюта следует за страной посетителя, а не за языком страницы (клиент,
  // 2026-10-28): CI-раннер в США видит $ и на /de/ — это задумано. Страну
  // задаёт cookie cc_code (ISO-3166 alpha-3) — ставим DEU и ждём евро.
  test('/de/pricing/ for a visitor from Germany (cc_code=DEU) shows prices in euros', async ({ plainPage: page }) => {
    await page.context().addCookies([{ name: 'cc_code', value: 'DEU', domain: '.imagen-ai.com', path: '/' }]);
    await page.goto('/de/pricing/');
    await settle(page);

    const texts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[class*="price_"]'))
        .map((el) => (el.textContent || '').trim())
        .filter((t) => /\d/.test(t))
    );
    expect(texts.length, 'No rendered price found on /de/pricing/').toBeGreaterThan(0);
    expect(texts.filter((t) => t.includes('€')).length, `No prices in € on /de/pricing/ for cc_code=DEU: ${JSON.stringify(texts.slice(0, 8))}`).toBeGreaterThan(0);
    expect(texts.filter((t) => t.includes('$')), 'Prices in $ on /de/pricing/ for a visitor from Germany (cc_code=DEU)').toEqual([]);
  });
});
