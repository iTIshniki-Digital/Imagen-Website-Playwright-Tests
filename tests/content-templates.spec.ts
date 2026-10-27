import { test, expect } from './fixtures';

test('a blog article renders with a title and body content', async ({ page }) => {
  await page.goto('/blog/');

  // Берём первую попавшуюся статью с текущей ленты блога, а не
  // захардкоженный URL — так тест не сломается, когда конкретный пост
  // удалят/переименуют, и по факту тестирует "шаблон статьи работает",
  // а не "эта конкретная статья существует".
  const firstArticleLink = page.locator('a[href*="/post/"]').first();
  const href = await firstArticleLink.getAttribute('href');
  expect(href, 'No article link found on /blog/').toBeTruthy();

  await page.goto(href!);

  const heading = page.getByRole('heading', { level: 1 }).first();
  await expect(heading, 'No h1 heading on the article page').toBeVisible();
  await expect(heading).not.toBeEmpty();

  // Сайт пересобран на Astro 2026-10 — текст статьи теперь в .post__main
  // (разведка 2026-10-27, URL-схема /post/<slug>/ не изменилась).
  const bodyText = await page.locator('.post__main').first().innerText();
  expect(bodyText.trim().length, 'Article body looks empty').toBeGreaterThan(200);
});
