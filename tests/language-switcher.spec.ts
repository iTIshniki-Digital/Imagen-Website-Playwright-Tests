import { test, expect } from './fixtures';
import { LanguageSwitcher } from '../pages/LanguageSwitcher';

test('language switcher link preserves the current page path', async ({ page }) => {
  await page.goto('/pricing/');

  const switcher = new LanguageSwitcher(page);
  const href = await switcher.getSwitcherHref('fr');

  expect(href, 'No French switcher link found in the DOM').toBeTruthy();
  expect(href, `Switcher should lead to /fr/pricing/, but leads to: ${href}`).toMatch(/\/fr\/pricing\/?$/);
});
