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

  // Намеренно не утверждаем конкретный следующий URL: судя по опыту
  // основной воронки (pages/PhotoQuizPage.ts), дальше вероятен похожий
  // сильно рандомизированный квиз-виджет — не стоит гнаться за конкретным
  // экраном. Проверяем только, что сабмит реально сработал и увёл дальше.
  await expect(page, 'После отправки формы должны уйти с /video/step-2/').not.toHaveURL(/\/video\/step-2\/?$/, { timeout: 15000 });
});
