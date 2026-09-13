import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { NavigationPage } from '../pages/NavigationPage';

test('every first-party header/footer link responds without 4xx/5xx', async ({ page, browserName }) => {
  // ВРЕМЕННО ОТКЛЮЧЕНО: подтверждено вживую (2026-09-13), что ~40 последовательных
  // переходов подряд получают 403 от Cloudflare rate-limit на стороне клиента —
  // это не баг теста, а ограничение защиты сайта. Нужно попросить клиента
  // настроить allowlist/bypass для QA-трафика (см. обсуждение с пользователем),
  // после чего снять этот skip.
  test.skip(true, 'Заблокировано Cloudflare rate-limit — ждём allowlist/bypass от клиента для CI-трафика.');

  // HTTP-статус ссылки не зависит от движка рендеринга — гоняем один раз,
  // чтобы не утраивать нагрузку на rate-limit защиты сайта (Cloudflare).
  test.skip(browserName !== 'chromium', 'Проверка статус-кодов запускается только на chromium.');
  // Десятки последовательных переходов — это дольше дефолтных 30с.
  test.setTimeout(5 * 60 * 1000);

  const homePage = new HomePage(page);
  await homePage.goto();

  const navigation = new NavigationPage(page);
  const links = (await navigation.getHeaderAndFooterLinks()).filter((link) => navigation.isFirstParty(link.href));

  const broken: string[] = [];

  for (const link of links) {
    const response = await page.goto(link.href, { waitUntil: 'domcontentloaded' });
    const status = response?.status() ?? 0;
    if (!response || status >= 400) {
      broken.push(`${status} ${link.href} ("${link.text}")`);
    }

    // Пауза не про "подождать готовности UI" (auto-waiting Playwright уже
    // делает это), а про намеренное замедление — сайт лочит защитой
    // (Cloudflare) частые запросы подряд с одного IP.
    await page.waitForTimeout(200);
  }

  expect(broken, `Битые ссылки:\n${broken.join('\n')}`).toEqual([]);
});
