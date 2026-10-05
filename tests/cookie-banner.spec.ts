import { test, expect } from './fixtures';

// checklist #31 — cookie-баннер. Подтверждён в живую (Accept / Manage /
// Privacy Policy), но появляется НЕ на каждом визите: в разведке 2026-10-05
// на прямых загрузках и через воронку (главная → /step-2/ → квиз) в нескольких
// сессиях баннера не было, при том что раньше он появлялся через ту же
// воронку. Его триггер пока не выяснен.
//
// Поэтому тест проверяет баннер, только если он реально показан: тогда
// Accept должен его скрыть, и он не должен возвращаться после перезагрузки.
// Если баннера в прогоне нет — тест помечается как пропущенный (skip), а не
// как пройденный: в отчёте это видно, и не выдаёт проверку, которой не было.

const ACCEPT = /^accept$/i;
const FUNNEL = ['/', '/step-2/', '/photo-quiz/'];

test.describe('Consent banner (#31)', () => {
  test('Accept dismisses the banner and it stays dismissed after reload', async ({ page }) => {
    // Три загрузки воронки с паузами: на WebKit это дольше стандартных 30 с.
    test.setTimeout(120000);
    const accept = page
      .getByRole('link', { name: ACCEPT })
      .or(page.getByRole('button', { name: ACCEPT }))
      .first();

    let shownOn: string | null = null;
    for (const path of FUNNEL) {
      await page.goto(path);
      await page.waitForTimeout(2500);
      if (await accept.isVisible().catch(() => false)) {
        shownOn = path;
        break;
      }
    }

    test.skip(
      shownOn === null,
      'Баннер не появился ни на одной странице воронки в этой сессии. Он появляется не на каждом визите — проверка пропущена, а не пройдена (см. checklist #31).'
    );

    await accept.click();
    await expect(accept, `После «Accept» на ${shownOn} баннер не скрылся`).toBeHidden({ timeout: 5000 });

    await page.reload();
    await page.waitForTimeout(2500);
    await expect(accept, `Баннер снова показан на ${shownOn} после «Accept» и перезагрузки`).toBeHidden();
  });
});
