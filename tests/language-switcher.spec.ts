import { test, expect } from './fixtures';
import { LanguageSwitcher } from '../pages/LanguageSwitcher';

test('language switcher link preserves the current page path', async ({ page }) => {
  await page.goto('/pricing/');

  const switcher = new LanguageSwitcher(page);
  const href = await switcher.getSwitcherHref('fr');

  expect(href, 'Ссылка переключателя на французский не найдена в DOM').toBeTruthy();
  expect(href, `Переключатель должен вести на /fr/pricing/, а ведёт на: ${href}`).toMatch(/\/fr\/pricing\/?$/);
});
