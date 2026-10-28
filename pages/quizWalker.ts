import { Page } from '@playwright/test';

// Общая механика квиз-виджетов сайта (Astro, разведка 2026-10-27) —
// /photo-quiz/, /questionnaire/, /video/questionnaire-2/ и мобильный /q/
// устроены одинаково, просто под разными классами контейнера экрана:
//   - .pq__screen — /photo-quiz/, /questionnaire/
//   - .vq__screen — /video/questionnaire-2/
//   - .mq-screen — /q/ (мобильный онбординг, дефис, а не двойное
//     подчёркивание, как у остальных двух — проверено вживую)
// В каждом случае: один <section data-step> виден, у остальных атрибут
// hidden; экран-вопрос — fieldset[data-question] с input[type=radio]
// или type=checkbox ("Select all that apply" — хватает отметить один
// вариант, чтобы разблокировать Continue); единая кнопка продвижения —
// [data-quiz-next], задизейблена через aria-disabled="true" до ответа.
// Экраны без вопроса (чисто маркетинговые интерстишлы, авто-переходящие
// intro/congrats) просто не содержат fieldset[data-question].
export const QUIZ_SCREEN_SELECTOR = '.pq__screen:not([hidden]), .vq__screen:not([hidden]), .mq-screen:not([hidden])';

export type QuizStepResult = 'answered' | 'advanced' | 'waiting' | 'no-screen';

/**
 * Делает ровно один шаг по текущему видимому экрану квиза: отвечает на
 * вопрос первым вариантом, если он ещё не отвечен, иначе жмёт Continue,
 * если он доступен. Если ни то, ни другое не подошло — возможно, экран
 * ждёт собственного события (авто-переход) — вызывающий код сам решает,
 * сколько ждать и когда считать это концом.
 */
export async function advanceQuizStep(page: Page): Promise<QuizStepResult> {
  const state = await page.evaluate((screenSelector) => {
    const visible = document.querySelector(screenSelector) as HTMLElement | null;
    if (!visible) return { noScreen: true as const };
    const fieldset = visible.querySelector('fieldset[data-question]');
    const next = visible.querySelector('[data-quiz-next]');
    return {
      noScreen: false as const,
      hasQuestion: !!fieldset,
      answered: fieldset ? fieldset.querySelectorAll('input:checked').length > 0 : true,
      isCheckbox: fieldset ? !!fieldset.querySelector('input[type="checkbox"]') : false,
      hasNext: !!next,
      nextDisabled: next ? next.getAttribute('aria-disabled') === 'true' : true,
    };
  }, QUIZ_SCREEN_SELECTOR);

  // Экрана нет — либо виджет ещё не отрисовался (в WebKit бывает на 1-2с
  // дольше), либо квиз действительно закончился уходом со страницы. Раньше
  // тут сразу возвращали 'no-screen', и цикл вызывающего кода прокручивал
  // все итерации вхолостую за долю секунды, не дав квизу появиться.
  if (state.noScreen) {
    const appeared = await page
      .locator(QUIZ_SCREEN_SELECTOR)
      .first()
      .waitFor({ state: 'attached', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    return appeared ? 'waiting' : 'no-screen';
  }

  // Клики — только настоящие (locator.click), не element.click() из evaluate:
  // с 2026-10-28 виджет игнорирует события с isTrusted=false (видимо, часть
  // антибот-защиты) — ответ не засчитывался, Continue оставался disabled.
  const screen = page.locator(QUIZ_SCREEN_SELECTOR).first();

  if (state.hasQuestion && !state.answered) {
    const label = screen.locator('fieldset[data-question] label').first();
    // Чекбоксы ("Select all that apply") — через check(): он не снимет уже
    // поставленную галочку и сам дождётся, что она встала. Обычный click()
    // иногда засчитывался с опозданием, цикл кликал ещё раз — и снимал её
    // (Continue так и оставался disabled). Радио — click(): на них data-auto
    // сразу уводит на следующий экран, и check() ругался бы на смену состояния.
    const act = state.isCheckbox ? label.check({ timeout: 5000 }) : label.click({ timeout: 5000 });
    const clicked = await act.then(() => true).catch(() => false);
    await page.waitForTimeout(400);
    return clicked ? 'answered' : 'waiting';
  }

  if (state.hasNext && !state.nextDisabled) {
    await screen
      .locator('[data-quiz-next]')
      .first()
      .click({ timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(700);
    return 'advanced';
  }

  await page.waitForTimeout(1000);
  return 'waiting';
}
