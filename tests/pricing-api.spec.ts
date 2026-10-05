import { test, expect } from './fixtures';
import supported from '../data/supported-currencies.json';

// checklist #22/#23 — API прайсинга, которую клиент прислал 2026-10-05:
// GET https://app-web-server.imagen-ai-op.com/website/get_pricing?currency=<код>
// Ответ — плоский JSON с ценами по валюте. Тесты ходят напрямую в API
// (не через браузер), поэтому bypass-заголовок сайта здесь не нужен.
const PRICING_API = 'https://app-web-server.imagen-ai-op.com/website/get_pricing';

type PricingResponse = Record<string, unknown> & {
  cloud_storage_500_original_price: number;
  cloud_storage_500_current_price: number;
  cloud_storage_2000_original_price: number;
  cloud_storage_2000_current_price: number;
  base_payment_price: number;
  culling_monthly_price_for_monthly_plan: number;
  culling_monthly_price_for_annual_plan: number;
  original_limitless_monthly_price: number;
  mega_promo_limitless_monthly_price: number;
  flat_fee_plans: { monthly: { limitless: { price: number } }; annual: { limitless: { price: number } } };
};

async function fetchPricing(request: import('@playwright/test').APIRequestContext, currency?: string) {
  const url = currency === undefined ? PRICING_API : `${PRICING_API}?currency=${encodeURIComponent(currency)}`;
  const response = await request.get(url);
  return { status: response.status(), body: response.status() === 200 ? ((await response.json()) as PricingResponse) : null };
}

test.describe('Pricing API — schema and sanity per supported currency', () => {
  let usdBody: PricingResponse;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const usd = await fetchPricing(request, 'USD');
    expect(usd.status, 'USD должна отдаваться с 200').toBe(200);
    usdBody = usd.body!;
    await request.dispose();
  });

  for (const currency of supported.currencies) {
    test(`${currency}: responds 200 with the same schema as USD`, async ({ request }) => {
      const { status, body } = await fetchPricing(request, currency);
      expect(status, `${currency} вернула ${status}`).toBe(200);
      expect(Object.keys(body!).sort(), `Набор полей у ${currency} отличается от USD`).toEqual(
        Object.keys(usdBody).sort()
      );
    });

    test(`${currency}: plan prices are internally consistent`, async ({ request }) => {
      const { body } = await fetchPricing(request, currency);
      const p = body!;

      expect(p.cloud_storage_500_current_price, `${currency}: 500GB со скидкой дороже обычной цены`).toBeLessThanOrEqual(
        p.cloud_storage_500_original_price
      );
      expect(p.cloud_storage_2000_current_price, `${currency}: 2000GB со скидкой дороже обычной цены`).toBeLessThanOrEqual(
        p.cloud_storage_2000_original_price
      );
      expect(p.flat_fee_plans.annual.limitless.price, `${currency}: годовой безлимит не дешевле месячного`).toBeLessThan(
        p.flat_fee_plans.monthly.limitless.price
      );
      expect(p.culling_monthly_price_for_annual_plan, `${currency}: culling на годовом не дешевле месячного`).toBeLessThanOrEqual(
        p.culling_monthly_price_for_monthly_plan
      );
      expect(p.mega_promo_limitless_monthly_price, `${currency}: промо-цена безлимита не ниже оригинальной`).toBeLessThan(
        p.original_limitless_monthly_price
      );
      expect(p.base_payment_price, `${currency}: базовый платёж должен быть положительным`).toBeGreaterThan(0);
    });

    if (currency !== 'USD') {
      test(`${currency}: prices are localized, not USD relabeled`, async ({ request }) => {
        const { body } = await fetchPricing(request, currency);
        expect(JSON.stringify(body), `${currency} вернула ровно те же цены, что USD — валюта не применилась`).not.toBe(
          JSON.stringify(usdBody)
        );
      });
    }
  }
});

// Клиентская находка (не баг теста): запрос с неподдерживаемой валютой
// (например XXX) сейчас молча возвращает USD-цены с кодом 200, без ошибки.
// Это ломает точность валюты — пользователь из, скажем, неподдерживаемой
// страны увидит доллары и не поймёт, что это фолбэк. Помечено как
// expected-fail: тест начнёт падать (сигнал убрать пометку), как только
// клиент это поправит.
test('unsupported currency does not silently fall back to USD prices', async ({ request }) => {
  test.fail(true, 'Клиентская находка: неподдерживаемая валюта молча даёт USD-цены с 200 вместо ошибки');

  const usd = await fetchPricing(request, 'USD');
  const bogus = await request.get(`${PRICING_API}?currency=XXX`);
  const bogusStatus = bogus.status();
  const bogusBody = bogusStatus === 200 ? JSON.stringify(await bogus.json()) : null;

  const isErrorStatus = bogusStatus >= 400;
  const isDistinct = bogusBody !== null && bogusBody !== JSON.stringify(usd.body);
  expect(isErrorStatus || isDistinct, 'XXX должна давать ошибку, а не USD-цены с 200').toBe(true);
});
