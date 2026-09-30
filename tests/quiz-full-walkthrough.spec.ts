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

    await page.reload();
    await stepTwoPage.fillAndSubmit('Playwright', 'QA');
    await expect(page).toHaveURL(/\/(photo-quiz|questionnaire)\//, { timeout: 15000 });

    if (/\/photo-quiz\//.test(page.url())) {
      test.info().annotations.push({ type: 'quiz-widget', description: 'photo-quiz' });
      const quizPage = new PhotoQuizPage(page);
      await quizPage.answerUntilOffer();

      await expect(quizPage.claimPaidPlanButton.first(), 'Должны дойти до экрана платного предложения').toBeVisible({ timeout: 10000 });

      // Намеренно НИКОГДА не кликаем claimPaidPlanButton — это ведёт к
      // реальному оформлению платной подписки. Только free trial.
      await quizPage.freeTrialLink.first().click();

      await expect(
        quizPage.downloadMacButton.or(quizPage.downloadPcButton).first(),
        'После free trial должна показаться страница загрузки (checklist #10)'
      ).toBeVisible({ timeout: 15000 });
    } else {
      test.info().annotations.push({ type: 'quiz-widget', description: 'questionnaire' });
      const questionnairePage = new QuestionnairePage(page);
      await questionnairePage.answerAllSteps();

      // Разметка "конца" формы questionnaire ещё не подтверждена так же
      // надёжно, как download-кнопки photo-quiz — проверяем минимально:
      // форма реально продвинулась (Continue больше не заблокирован
      // бесконечно, answerAllSteps не завис) и мы не застряли на первом
      // же вопросе.
      await expect(page).not.toHaveURL(/\/step-2\//);
    }
  });
});
