import { Page } from '@playwright/test';

// Общая механика квиз-виджетов сайта (Astro, разведка 2026-10-27) —
// /photo-quiz/, /questionnaire/ и /video/questionnaire-2/ устроены
// одинаково, просто под разными классами контейнера экрана:
//   - .pq__screen — /photo-quiz/, /questionnaire/
//   - .vq__screen — /video/questionnaire-2/
// В каждом случае: один <section data-step> виден, у остальных атрибут
// hidden; экран-вопрос — fieldset[data-question] с input[type=radio]
// или type=checkbox ("Select all that apply" — хватает отметить один
// вариант, чтобы разблокировать Continue); единая кнопка продвижения —
// [data-quiz-next], задизейблена через aria-disabled="true" до ответа.
// Экраны без вопроса (чисто маркетинговые интерстишлы, авто-переходящие
// intro/congrats) просто не содержат fieldset[data-question].
const SCREEN_SELECTOR = '.pq__screen:not([hidden]), .vq__screen:not([hidden])';

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
      hasNext: !!next,
      nextDisabled: next ? next.getAttribute('aria-disabled') === 'true' : true,
    };
  }, SCREEN_SELECTOR);

  if (state.noScreen) return 'no-screen';

  if (state.hasQuestion && !state.answered) {
    const clicked = await page.evaluate((screenSelector) => {
      const visible = document.querySelector(screenSelector) as HTMLElement | null;
      const label = visible?.querySelector('fieldset[data-question] label') as HTMLElement | null;
      label?.click();
      return !!label;
    }, SCREEN_SELECTOR);
    await page.waitForTimeout(400);
    return clicked ? 'answered' : 'waiting';
  }

  if (state.hasNext && !state.nextDisabled) {
    await page.evaluate((screenSelector) => {
      const visible = document.querySelector(screenSelector) as HTMLElement | null;
      (visible?.querySelector('[data-quiz-next]') as HTMLElement | null)?.click();
    }, SCREEN_SELECTOR);
    await page.waitForTimeout(700);
    return 'advanced';
  }

  await page.waitForTimeout(1000);
  return 'waiting';
}
