import { test, expect } from './fixtures';
import { VideoPage } from '../pages/VideoPage';
import { VideoStepTwoPage } from '../pages/VideoStepTwoPage';
import { TEST_EMAIL } from '../pages/testData';

test('video email submit redirects to /video/step-2/', async ({ page }) => {
  const videoPage = new VideoPage(page);
  await videoPage.goto();

  await videoPage.submitEmail();

  await expect(page).toHaveURL(/\/video\/step-2\/?/);
});

test('video step-2 form submits and leaves /video/step-2/', async ({ page }) => {
  const videoStepTwoPage = new VideoStepTwoPage(page);
  await page.goto('/video/step-2/');

  await videoStepTwoPage.fillAndSubmit('Playwright', 'QA', TEST_EMAIL);

  // Подтверждено вживую 2026-09-30: ведёт на конкретный, стабильный адрес
  // /video/questionnaire-2/ — не расплывчатое "куда-то ушли". Первая
  // попытка проверить это блайндовым waitForTimeout+URL-чтением ловила
  // ложное "не ушли" — навигация просто ещё не успела случиться к моменту
  // проверки; waitForURL ждёт её по-настоящему.
  await page.waitForURL(/\/video\/questionnaire-2\//, { timeout: 15000 });
});
