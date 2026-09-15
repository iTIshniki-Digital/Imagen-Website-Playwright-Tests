import { test as base } from '@playwright/test';
import { FIRST_PARTY_HOSTS } from '../pages/domains';

// Расширяем стандартный `page` fixture: добавляем Cloudflare bypass-заголовок
// ТОЛЬКО на запросы к доменам клиента. Два важных момента:
//
// 1) Если добавить заголовок глобально через playwright.config
//    `use.extraHTTPHeaders`, он улетит и на сторонние API (например, geo-IP
//    сервис, который дёргает сам сайт) — кастомный заголовок на чужом домене
//    превращает простой запрос в CORS preflight, который эти сервисы не
//    ждут, и роняет их с ошибкой.
//
// 2) Перехват ОДНИМ хендлером на "**/*" (с JS-фильтром по хосту внутри)
//    вызывает Node-колбэк на КАЖДЫЙ запрос страницы (десятки: трекеры,
//    шрифты, картинки) — в CI это давало нестабильные ERR_ABORTED на самой
//    навигации. Регистрируем route ПО ПАТТЕРНУ ДОМЕНА для каждого хоста
//    клиента отдельно — Playwright матчит URL нативно и вызывает наш код
//    только для реально нужных запросов, остальное вообще не долетает до JS.
export const test = base.extend<{}>({
  page: async ({ page }, use) => {
    const token = process.env.E2E_BYPASS_TOKEN;

    if (token) {
      for (const host of FIRST_PARTY_HOSTS) {
        await page.route(`https://${host}/**`, async (route) => {
          await route.continue({
            headers: { ...route.request().headers(), 'x-e2e-bypass': token },
          });
        });
      }
    }

    await use(page);
  },
});

export { expect } from '@playwright/test';
