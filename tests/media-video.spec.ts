import { test, expect } from './fixtures';
import urlSweepList from '../data/url-sweep-list.json';

// checklist #35 — битые картинки уже ловятся глобально (responsiveChecks.ts),
// это докрывает вторую половину пункта: видео-превью (самостоятельно
// хостящиеся <video>, не YouTube/Vimeo iframe — те сторонние и не наша
// зона ответственности). Подтверждено вживую 2026-09-30: видео на сайте —
// самохостящиеся .webm (например /editing/), с обычным HTMLMediaElement
// API — проверяем через .error и networkState, не через скриншот.
test.describe('Video widgets across key pages', () => {
  for (const { name, path } of urlSweepList.urlsToCheck) {
    test(`${name} (${path}) videos load without error`, async ({ page }) => {
      await page.goto(path);

      // Прокрутка триггерит ленивую загрузку видео, как и у картинок
      // (см. pages/responsiveChecks.ts) — тот же приём, без обращения к
      // общему хелперу: здесь не нужны scrollWidth/clientWidth, а вязать
      // отдельную от responsive-проверок фичу на общий код ради экономии
      // пяти строк — лишняя связанность.
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
      await page.waitForTimeout(1000);

      const brokenVideos = await page.evaluate(() =>
        Array.from(document.querySelectorAll('video'))
          .filter((v) => v.error !== null || v.networkState === HTMLMediaElement.NETWORK_NO_SOURCE)
          .map((v) => `${v.currentSrc || v.getAttribute('src') || '(no src)'} — error code ${v.error?.code ?? 'n/a'}`)
      );

      expect(brokenVideos, `Битые видео на ${path}:\n${brokenVideos.join('\n')}`).toEqual([]);
    });
  }
});
