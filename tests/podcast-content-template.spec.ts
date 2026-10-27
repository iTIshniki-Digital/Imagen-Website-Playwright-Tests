import { test, expect } from './fixtures';

// checklist #30 (Podcast) — шаблон эпизода подкаста. Сайт пересобран на
// Astro 2026-10 — эпизоды по-прежнему лежат по /podcast/<id>/, но теперь
// это отдельный шаблон от статей блога (ephead__title + .epnotes, не
// .post__main, как у tests/content-templates.spec.ts — разведка 2026-10-27).
test('a podcast episode renders with a title and body content', async ({ page }) => {
  await page.goto('/podcast/');

  // Первый эпизод из текущей ленты, а не захардкоженный URL — так тест не
  // сломается, когда конкретный эпизод удалят или переименуют.
  const hrefs = await page.locator('a[href*="/podcast/"]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('href') || '')
  );
  const href = hrefs.find((h) => /\/podcast\/\d+\/?$/.test(h));
  expect(href, 'No episode link in the /podcast/<id>/ shape found on /podcast/').toBeTruthy();

  await page.goto(href!);

  const heading = page.getByRole('heading', { level: 1 }).first();
  await expect(heading, 'No h1 heading on the episode page').toBeVisible();
  await expect(heading).not.toBeEmpty();

  const bodyText = await page.locator('.epnotes').first().innerText();
  expect(bodyText.trim().length, 'Episode description looks empty').toBeGreaterThan(200);
});
