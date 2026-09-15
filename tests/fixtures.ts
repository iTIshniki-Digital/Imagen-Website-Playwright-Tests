import { test as base } from '@playwright/test';
import { isFirstPartyUrl } from '../pages/domains';

// Расширяем стандартный `page` fixture: добавляем Cloudflare bypass-заголовок
// ТОЛЬКО на запросы к доменам клиента. Если добавить его глобально через
// playwright.config `use.extraHTTPHeaders`, он улетит и на сторонние API
// (например, geo-IP сервис, который дёргает сам сайт) — кастомный заголовок
// на чужом домене превращает простой запрос в CORS preflight, который эти
// сервисы не ждут, и роняет их с ошибкой. Поэтому фильтруем по хосту.
export const test = base.extend<{}>({
  page: async ({ page }, use) => {
    const token = process.env.E2E_BYPASS_TOKEN;

    if (token) {
      await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (isFirstPartyUrl(url)) {
          await route.continue({
            headers: { ...route.request().headers(), 'x-e2e-bypass': token },
          });
        } else {
          await route.continue();
        }
      });
    }

    await use(page);
  },
});

export { expect } from '@playwright/test';
