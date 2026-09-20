import { test, expect } from './fixtures';
import localesData from '../data/locales-data.json';

test.describe('Locale rendering', () => {
  for (const locale of localesData.locales) {
    test(`${locale.code} (${locale.path}) renders localized content`, async ({ page }) => {
      const response = await page.goto(locale.path);
      expect(response?.ok(), `Страница ${locale.path} вернула ${response?.status()}`).toBeTruthy();

      const lang = await page.evaluate(() => document.documentElement.lang);
      expect(lang, `У страницы ${locale.path} пустой <html lang="">`).toBeTruthy();

      if (locale.code === 'en') return;

      const title = await page.title();

      // Свежий английский вариант для сравнения — в отдельной вкладке того же
      // контекста (наследует bypass-заголовок), чтобы не терять состояние
      // текущей страницы локали.
      const englishPage = await page.context().newPage();
      await englishPage.goto('/');
      const englishLang = await englishPage.evaluate(() => document.documentElement.lang);
      const englishTitle = await englishPage.title();
      await englishPage.close();

      // Сравниваем с английским, а не с захардкоженным переводом — так тест
      // не привязан к точной строке перевода и ловит главный признак "не
      // перевели": lang/title совпадают с английской версией.
      expect(
        lang,
        `lang ("${lang}") не отличается от английского ("${englishLang}") — похоже, локаль не переключилась`
      ).not.toBe(englishLang);
      expect(title, 'Title совпадает с английским — страница не переведена').not.toBe(englishTitle);
    });
  }
});
