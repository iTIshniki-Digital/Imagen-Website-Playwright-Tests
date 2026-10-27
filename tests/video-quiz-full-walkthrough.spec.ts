import { test, expect } from './fixtures';
import { VideoPage } from '../pages/VideoPage';
import { StepTwoPage } from '../pages/StepTwoPage';
import { QuestionnairePage } from '../pages/QuestionnairePage';
import { TEST_EMAIL } from '../pages/testData';

// Полное прохождение видео-анкеты (checklist #15/#16) — отдельно от
// быстрого video-funnel.spec.ts по той же причине, что и
// quiz-full-walkthrough.spec.ts: полный проход через все шаги формы
// занимает заметно дольше, чем должен занимать быстрый прогон.
//
// Сайт пересобран на Astro 2026-10 (разведка 2026-10-27): /video/step-2/ —
// тот же компонент StepTwoPage, что у основной воронки (data-product=
// "video"), а итоговый адрес анкеты — /video/questionnaire/ (без "-2" на
// конце, раньше было /video/questionnaire-2/). Сама анкета — тот же
// .vq__screen-виджет, что на /questionnaire/ (см. QuestionnairePage/
// quizWalker.ts) — переиспользуем, не пишем новый класс.
test.describe('Video quiz full walkthrough', () => {
  test('video funnel reaches the end of the questionnaire and the download page', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    const videoPage = new VideoPage(page);
    const stepTwoPage = new StepTwoPage(page);

    await videoPage.goto();
    await videoPage.submitEmail();
    await expect(page).toHaveURL(/\/video\/step-2\/?/);

    await stepTwoPage.fillAndSubmit('Playwright', 'QA', TEST_EMAIL);
    await page.waitForURL(/\/video\/questionnaire\//, { timeout: 15000 });

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
    await expect(page.locator(':visible').filter({ hasText: /you.re all set/i }).first(), 'No "You’re all set" confirmation on /video/download/').toBeVisible();
  });
});
