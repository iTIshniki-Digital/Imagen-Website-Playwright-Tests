import { test as base, expect } from '@playwright/test';

// Cloudflare на стороне клиента отдаёт челлендж без bypass-заголовка —
// тот же приём, что в основной tests/fixtures.ts: заголовок только на
// запросы к домену клиента, сторонние сервисы его не получают (иначе
// ломается CORS у них).
const FIRST_PARTY_HOSTS = ['imagen-ai.com'];

function isFirstPartyUrl(href: string): boolean {
  try {
    const host = new URL(href).host;
    return FIRST_PARTY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export const test = base.extend({
  page: async ({ page, context }, use) => {
    const token = process.env.E2E_BYPASS_TOKEN;
    if (token) {
      await context.setExtraHTTPHeaders({ 'x-e2e-bypass': token });
      await page.route('**/*', async (route) => {
        if (isFirstPartyUrl(route.request().url())) {
          await route.continue();
          return;
        }
        const headers = route.request().headers();
        delete headers['x-e2e-bypass'];
        await route.continue({ headers });
      });
    }
    await use(page);
  },
});

export { expect };
