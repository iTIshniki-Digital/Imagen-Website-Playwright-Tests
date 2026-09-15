import { test as base } from '@playwright/test';
import { isFirstPartyUrl } from '../pages/domains';

// Расширяем стандартный `page` fixture Cloudflare bypass-заголовком.
//
// История правок (важно для будущих изменений):
// 1) Ставили заголовок глобально через playwright.config `use.extraHTTPHeaders`
//    — улетал и на сторонние API (geo-IP сервис самого сайта), ломал им CORS.
// 2) Перешли на `page.route('**/*', ...)` с JS-фильтром по хосту внутри —
//    в CI (не локально!) это давало нестабильный net::ERR_ABORTED прямо на
//    обычной навигации (page.goto('/')).
// 3) Сузили route до паттернов по доменам клиента — тот же ERR_ABORTED
//    остался, потому что главная навигация ВСЕГДА идёт на домен клиента,
//    то есть всё равно перехватывалась.
// Вывод: нестабилен именно `route.continue({ headers })` С ИЗМЕНЁННЫМИ
// заголовками на main-frame навигации. Поэтому теперь заголовок ставится
// нативно через `context.setExtraHTTPHeaders()` (без CDP-перехвата вообще),
// а route используется только в обратную сторону — ВЫРЕЗАТЬ заголовок
// перед сторонними доменами (это не критичная main-frame навигация, а
// обычный sub-resource запрос, там модификация headers через route стабильна).
export const test = base.extend<{}>({
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

export { expect } from '@playwright/test';
