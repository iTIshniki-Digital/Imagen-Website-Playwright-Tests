import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { advanceQuizStep, QUIZ_SCREEN_SELECTOR } from './quizWalker';

// /questionnaire/ (и /video/questionnaire-2/, см. VideoPage) — тот же
// виджет, что и /photo-quiz/, просто под классами .vq__screen на видео-
// версии вместо .pq__screen (разведка 2026-10-27, см. quizWalker.ts).
//
// ВАЖНО про /questionnaire/: прямой заход на страницу НЕ инициализирует
// виджет — первый экран (.pq__intro, спиннер "You're signed up") так и
// остаётся показанным, без перехода дальше. Нужно реально дойти через
// /step-2/?promo=true — обычная (без promo) воронка всегда ведёт на
// /photo-quiz/, а на /questionnaire/ — только с этим параметром (см.
// HomePage/StepTwoPage и data-next-questionnaire на форме step-2).
export class QuestionnairePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Проходит анкету до конца: отвечает на все экраны первым вариантом,
   * жмёт Continue. Останавливается, когда на экране показался текст из
   * stopTextRegex (по умолчанию — финальное "You're all set"), или когда
   * видимых экранов квиза больше нет (ушли на отдельную страницу,
   * например /video/download/), или когда исчерпан maxSteps.
   *
   * Возвращает число реально отвеченных вопросов (не шагов — интерстишлы
   * и Continue без вопроса не считаются).
   */
  async answerAllSteps(maxSteps = 40, stopTextRegex: RegExp = /you.re all set/i): Promise<number> {
    await this.dismissCookieBanner();

    let answered = 0;
    for (let i = 0; i < maxSteps; i++) {
      // Текст финиша ищем только в текущем видимом экране квиза, а не во
      // всём body: на странице есть role="status" (live-регион для
      // скринридеров), и в нём "You're all set" может оказаться ещё до
      // финала — тогда цикл выходил на первой же итерации с 0 ответов.
      const screen = this.page.locator(QUIZ_SCREEN_SELECTOR).first();
      const screenText = (await screen.count())
        ? await screen.innerText().catch(() => '')
        : await this.page.locator('main').innerText().catch(() => '');
      if (stopTextRegex.test(screenText)) break;

      const result = await advanceQuizStep(this.page);
      if (result === 'answered') answered++;
      if (result === 'no-screen') break;
    }
    return answered;
  }
}
