import { test, expect } from './fixtures';

// checklist #30 (Podcast) — шаблон эпизода подкаста. Подтверждено вживую
// 2026-10-05: эпизоды лежат по /podcast/<id>/ и рендерятся тем же
// Elementor-шаблоном, что статьи блога (h1 + .elementor-widget-theme-post-content),
// поэтому проверка повторяет логику tests/content-templates.spec.ts.
test('a podcast episode renders with a title and body content', async ({ page }) => {
  await page.goto('/podcast/');

  // Первый эпизод из текущей ленты, а не захардкоженный URL — так тест не
  // сломается, когда конкретный эпизод удалят или переименуют.
  const hrefs = await page.locator('a[href*="/podcast/"]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('href') || '')
  );
  const href = hrefs.find((h) => /\/podcast\/\d+\/?$/.test(h));
  expect(href, 'На /podcast/ не нашлось ни одной ссылки на эпизод вида /podcast/<id>/').toBeTruthy();

  await page.goto(href!);

  const heading = page.getByRole('heading', { level: 1 }).first();
  await expect(heading, 'На странице эпизода нет заголовка h1').toBeVisible();
  await expect(heading).not.toBeEmpty();

  const bodyText = await page.locator('.elementor-widget-theme-post-content').first().innerText();
  expect(bodyText.trim().length, 'Описание эпизода выглядит пустым').toBeGreaterThan(200);
});
