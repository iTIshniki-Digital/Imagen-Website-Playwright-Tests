import { test, expect } from './fixtures';
import { VideoPage } from '../pages/VideoPage';

test('video email submit redirects to /video/step-2/', async ({ page }) => {
  const videoPage = new VideoPage(page);
  await videoPage.goto();

  await videoPage.submitEmail();

  await expect(page).toHaveURL(/\/video\/step-2\/?/);
});
