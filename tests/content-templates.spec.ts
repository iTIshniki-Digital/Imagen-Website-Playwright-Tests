import { test, expect } from './fixtures';

test('a blog article renders with a title and body content', async ({ page }) => {
  await page.goto('/blog/');

  // Берём первую попавшуюся статью с текущей ленты блога, а не
  // захардкоженный URL — так тест не сломается, когда конкретный пост
  // удалят/переименуют, и по факту тестирует "шаблон статьи работает",
  // а не "эта конкретная статья существует".
  const firstArticleLink = page.locator('a[href*="/post/"]').first();
  const href = await firstArticleLink.getAttribute('href');
  expect(href, 'На /blog/ не нашлось ни одной ссылки на статью').toBeTruthy();

  await page.goto(href!);

  const heading = page.getByRole('heading', { level: 1 }).first();
  await expect(heading, 'На странице статьи нет заголовка h1').toBeVisible();
  await expect(heading).not.toBeEmpty();

  // Elementor-тема не использует семантические <article>/<main> — контент
  // статьи рендерится в виджете с этим классом (проверено вживую).
  const bodyText = await page.locator('.elementor-widget-theme-post-content').first().innerText();
  expect(bodyText.trim().length, 'Тело статьи выглядит пустым').toBeGreaterThan(200);
});
