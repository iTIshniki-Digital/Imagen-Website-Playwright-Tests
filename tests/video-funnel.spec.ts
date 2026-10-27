import { test, expect } from './fixtures';
import { VideoPage } from '../pages/VideoPage';
import { StepTwoPage } from '../pages/StepTwoPage';
import { TEST_EMAIL } from '../pages/testData';

test('video email submit redirects to /video/step-2/', async ({ page }) => {
  const videoPage = new VideoPage(page);
  await videoPage.goto();

  await videoPage.submitEmail();

  await expect(page).toHaveURL(/\/video\/step-2\/?/);
});

// Сайт пересобран на Astro 2026-10 — /video/step-2/ оказался тем же
// компонентом form.s2__form, что обычный /step-2/ (просто
// data-product="video"), разведка 2026-10-27 — поэтому переиспользуем
// StepTwoPage вместо отдельного класса.
test('video step-2 form submits and leaves /video/step-2/', async ({ page }) => {
  const stepTwoPage = new StepTwoPage(page);
  await page.goto('/video/step-2/');

  await stepTwoPage.fillAndSubmit('Playwright', 'QA', TEST_EMAIL);

  // Подтверждено вживую 2026-10-27: ведёт на /video/questionnaire/ (без
  // "-2" на конце — изменилось при пересборке сайта). waitForURL вместо
  // блайндового waitForTimeout+URL-чтения — ждёт перехода по-настоящему.
  await page.waitForURL(/\/video\/questionnaire\//, { timeout: 15000 });
});
