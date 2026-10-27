import { Page } from '@playwright/test';
import { isThirdPartyNoise } from './BasePage';

export interface ResponsiveHealth {
  scrollWidth: number;
  clientWidth: number;
  brokenImages: string[];
}

/**
 * Прокручивает страницу целиком (триггерит ленивую загрузку картинок) и
 * возвращает данные для проверки горизонтального скролла и битых картинок.
 * Общая логика для homepage-теста (responsive.spec.ts) и обхода ключевых
 * страниц (tablet-sweep.spec.ts) — чтобы не дублировать её в двух местах.
 */
export async function checkResponsiveHealth(page: Page): Promise<ResponsiveHealth> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const distance = 400;
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        total += distance;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  // Подтверждено вживую 2026-09-30: после запуска клиентом нового раздела
  // на главной ("It's here!" в шапке) сеть на homepage больше не выходит
  // в полный простой в разумное время — что-то на странице продолжает
  // фоновую активность (скорее всего новый виджет/трекер из этого
  // релиза). Скролл выше уже дал ленивому контенту время подгрузиться,
  // поэтому не блокируем весь тест, если networkidle не наступит —
  // ограничиваем ожидание и продолжаем: сама проверка scrollWidth и
  // битых картинок ниже всё равно отработает на актуальном состоянии DOM.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  // Сравниваем с clientWidth (реальная видимая ширина БЕЗ учёта
  // вертикального скроллбара), а не с числом из конфига viewport —
  // так браузерный скроллбар не даёт ложных срабатываний.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  // НАЙДЕНО 2026-10-27 (Astro-пересборка): часть картинок (например, в
  // горизонтальных каруселях вроде .hrev__photo) используют собственный
  // лейзи-лоад сайта — атрибута src у них нет вообще, реальный путь лежит
  // в data-src, src подставится своим JS, когда карусель докрутится до
  // картинки. Вертикальный скролл страницы это не триггерит. Без src
  // naturalWidth==0 у них всегда — исключаем такие картинки как "ещё не
  // загруженные", а не "битые": настоящая битая картинка имеет src, который
  // не загрузился.
  const brokenImages = (
    await page.$$eval('img', (images) =>
      images.filter((img) => img.complete && img.naturalWidth === 0 && img.getAttribute('src')).map((img) => img.src)
    )
  ).filter((src) => !isThirdPartyNoise(src));

  return { scrollWidth, clientWidth, brokenImages };
}
