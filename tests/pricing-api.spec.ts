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
    expect(usd.status, 'USD should respond with 200').toBe(200);
    usdBody = usd.body!;
    await request.dispose();
  });

  for (const currency of supported.currencies) {
    test(`${currency}: responds 200 with the same schema as USD`, async ({ request }) => {
      const { status, body } = await fetchPricing(request, currency);
      expect(status, `${currency} returned ${status}`).toBe(200);
      expect(Object.keys(body!).sort(), `${currency}'s set of fields differs from USD`).toEqual(
        Object.keys(usdBody).sort()
      );
    });

    test(`${currency}: plan prices are internally consistent`, async ({ request }) => {
      const { body } = await fetchPricing(request, currency);
      const p = body!;

      expect(p.cloud_storage_500_current_price, `${currency}: discounted 500GB is pricier than the original price`).toBeLessThanOrEqual(
        p.cloud_storage_500_original_price
      );
      expect(p.cloud_storage_2000_current_price, `${currency}: discounted 2000GB is pricier than the original price`).toBeLessThanOrEqual(
        p.cloud_storage_2000_original_price
      );
      expect(p.flat_fee_plans.annual.limitless.price, `${currency}: annual limitless is not cheaper than monthly`).toBeLessThan(
        p.flat_fee_plans.monthly.limitless.price
      );
      expect(p.culling_monthly_price_for_annual_plan, `${currency}: culling on the annual plan is not cheaper than monthly`).toBeLessThanOrEqual(
        p.culling_monthly_price_for_monthly_plan
      );
      expect(p.mega_promo_limitless_monthly_price, `${currency}: promo price for limitless is not below the original`).toBeLessThan(
        p.original_limitless_monthly_price
      );
      expect(p.base_payment_price, `${currency}: base payment should be positive`).toBeGreaterThan(0);
    });

    if (currency !== 'USD') {
      test(`${currency}: prices are localized, not USD relabeled`, async ({ request }) => {
        const { body } = await fetchPricing(request, currency);
        expect(JSON.stringify(body), `${currency} returned the exact same prices as USD — currency wasn't applied`).not.toBe(
          JSON.stringify(usdBody)
        );
      });
    }
  }
});

// Неподдерживаемая валюта (например XXX) возвращает USD-цены с кодом 200 —
// клиент подтвердил 2026-10-28, что это задуманный фолбэк, а не баг. Раньше
// тут стоял expected-fail "должна быть ошибка"; теперь проверяем сам фолбэк:
// если он сломается (ошибка, пустой ответ, другие цены) — тест покраснеет.
test('unsupported currency falls back to USD prices (200, same as USD)', async ({ request }) => {
  const usd = await fetchPricing(request, 'USD');
  expect(usd.status, 'USD should respond with 200').toBe(200);

  const bogus = await request.get(`${PRICING_API}?currency=XXX`);
  expect(bogus.status(), 'An unsupported currency (XXX) should still respond with 200').toBe(200);
  expect(await bogus.json(), 'An unsupported currency (XXX) should return the same prices as USD').toEqual(usd.body);
});
