import { test, expect } from './fixtures';
import { HomePage } from '../pages/HomePage';
import { StepTwoPage } from '../pages/StepTwoPage';
import { PhotoQuizPage } from '../pages/PhotoQuizPage';
import { QuestionnairePage } from '../pages/QuestionnairePage';

// Полное прохождение квиза (checklist #9) и проверка достижения страницы
// загрузки (#10) — отдельно от быстрого signup-funnel.spec.ts, потому что
// полный проход занимает 1.5-3+ минуты живого времени на реальном сайте
// (см. pages/PhotoQuizPage.ts и pages/QuestionnairePage.ts) — слишком
// долго для теста, который должен гонять быстро и часто. Этот тест — для
// глубокой проверки, не для каждого прогона.
//
// Какой из двух виджетов (/photo-quiz/ — вопросы с вариантами, или
// /questionnaire/ — многошаговая Elementor-форма) покажется после
// /step-2/, решает сам сайт; тест обрабатывает оба варианта явно, а не
// гадает про один.
test.describe('Quiz full walkthrough', () => {
  test('reaches the offer screen (photo-quiz) or the end of the form (questionnaire)', async ({ page }) => {
    test.setTimeout(4 * 60 * 1000);

    const homePage = new HomePage(page);
    const stepTwoPage = new StepTwoPage(page);

    await homePage.goto();
    await homePage.continueToStepTwo();
    await expect(page).toHaveURL(/\/step-2\/?/);

    await stepTwoPage.fillAndSubmit('Playwright', 'QA');
    await expect(page).toHaveURL(/\/(photo-quiz|questionnaire)\//, { timeout: 15000 });

    if (/\/photo-quiz\//.test(page.url())) {
      test.info().annotations.push({ type: 'quiz-widget', description: 'photo-quiz' });
      const quizPage = new PhotoQuizPage(page);
      await quizPage.answerUntilOffer();

      await expect(quizPage.claimPaidPlanButton.first(), 'Should reach the paid-plan offer screen').toBeVisible({ timeout: 10000 });

      // Намеренно НИКОГДА не кликаем claimPaidPlanButton — это ведёт к
      // реальному оформлению платной подписки. Только free trial.
      await quizPage.freeTrialLink.first().click();

      await expect(
        quizPage.downloadMacButton.or(quizPage.downloadPcButton).first(),
        'After the free trial, the download page should appear (checklist #10)'
      ).toBeVisible({ timeout: 15000 });
    } else {
      test.info().annotations.push({ type: 'quiz-widget', description: 'questionnaire' });
      const questionnairePage = new QuestionnairePage(page);
      const answeredCount = await questionnairePage.answerAllSteps();

      // Конец формы /questionnaire/ подтверждён вживую 2026-10-05: финальный экран
      // «Congrats! You have 1,500 free edits! You’re all set…» появляется без смены
      // URL (форма на той же странице). Поэтому проверяем сам экран, а не адрес —
      // уход с /step-2/ сам по себе ничего не доказывает.
      expect(answeredCount, 'The questionnaire should actually progress, not just leave step-2').toBeGreaterThan(5);
      await expect(
        page.locator(':visible').filter({ hasText: /you.re all set/i }).first(),
        'The final "You’re all set" screen did not appear after the last /questionnaire/ question'
      ).toBeVisible({ timeout: 15000 });
    }
  });

  // Ветка /questionnaire/ в обычной воронке (без ?promo=true) на новом сайте не
  // встречается вообще — form.s2__form сама решает, куда вести, по наличию этого
  // параметра (см. data-next-questionnaire/data-next-photo-quiz на форме, разведка
  // 2026-10-27). Отдельный тест с ?promo=true гарантирует, что второй виджет (#9)
  // проверяется в каждом прогоне, а не только когда так решит сайт.
  //
  // ВАЖНО: прямой заход на /questionnaire/ без полноценного прохождения /step-2/ не
  // работает — первый экран (intro, спиннер "You're signed up") просто не запускается
  // (разведка 2026-10-27). Идём как реальный посетитель: через форму с ?promo=true.
  test('questionnaire widget (/questionnaire/, via ?promo=true) reaches its end screen', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    const stepTwoPage = new StepTwoPage(page);
    await page.goto('/step-2/?promo=true');
    await stepTwoPage.fillAndSubmit('Playwright', 'QA');
    await expect(page).toHaveURL(/\/questionnaire\//, { timeout: 15000 });

    const questionnairePage = new QuestionnairePage(page);
    const answeredCount = await questionnairePage.answerAllSteps();

    expect(answeredCount, 'The /questionnaire/ form should actually progress').toBeGreaterThan(5);
    await expect(
      page.locator(':visible').filter({ hasText: /you.re all set/i }).first(),
      'The final "You’re all set" screen did not appear on /questionnaire/'
    ).toBeVisible({ timeout: 15000 });
  });
});
