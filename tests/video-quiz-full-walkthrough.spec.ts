import { test, expect } from './fixtures';
import { VideoPage } from '../pages/VideoPage';
import { VideoStepTwoPage } from '../pages/VideoStepTwoPage';
import { QuestionnairePage } from '../pages/QuestionnairePage';
import { TEST_EMAIL } from '../pages/testData';

// Полное прохождение видео-анкеты (checklist #15/#16) — отдельно от
// быстрого video-funnel.spec.ts по той же причине, что и
// quiz-full-walkthrough.spec.ts: полный проход через все шаги формы
// занимает заметно дольше, чем должен занимать быстрый прогон.
//
// Подтверждено вживую 2026-09-30: отправка /video/step-2/ ведёт на
// /video/questionnaire-2/ — тот же виджет Elementor "Form Steps", что и
// на /questionnaire/ основной воронки (10 шагов вместо 12, но идентичная
// структура полей) — переиспользуем QuestionnairePage, не пишем новый
// класс под, по сути, тот же виджет.
test.describe('Video quiz full walkthrough', () => {
  test('video funnel reaches the end of the questionnaire-2 form and the download page', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    const videoPage = new VideoPage(page);
    const videoStepTwoPage = new VideoStepTwoPage(page);

    await videoPage.goto();
    await videoPage.submitEmail();
    await expect(page).toHaveURL(/\/video\/step-2\/?/);

    // Тот же паттерн, что у основного step-2 (pages/StepTwoPage.ts):
    // приход на страницу клиентской навигацией (не полной перезагрузкой)
    // рискует оставить обработчик submit непривязанным. Дёшево и
    // безопасно подстраховаться здесь тем же способом, ничего ещё не
    // введено и терять нечего.
    await page.reload();

    await videoStepTwoPage.fillAndSubmit('Playwright', 'QA', TEST_EMAIL);
    await page.waitForURL(/\/video\/questionnaire-2\//, { timeout: 15000 });

    const questionnairePage = new QuestionnairePage(page);
    const answeredCount = await questionnairePage.answerAllSteps();

    // Подтверждено вживую 2026-10-05: последняя кнопка видео-анкеты называется
    // «Finish setup», не «Continue», и именно она отправляет форму на
    // /video/download/ с текстом «You're all set!». Раньше обход её не нажимал,
    // поэтому тест упирался в предпоследний экран (checklist #15/#16).
    //
    // Два отдельных ожидания, чтобы провал было видно точно: сколько вопросов
    // реально отвечено, и дошли ли до страницы загрузки после формы.
    expect(answeredCount, 'The questionnaire should actually progress, not just leave step-2').toBeGreaterThan(5);

    await expect(page, 'The /video/download/ download page did not open after "Finish setup"').toHaveURL(/\/video\/download\/?/, { timeout: 15000 });
    await expect(page.getByText(/you.re all set/i).first(), 'No "You’re all set" confirmation on /video/download/').toBeVisible();
  });
});
