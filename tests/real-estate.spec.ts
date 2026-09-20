import { test, expect } from './fixtures';
import { RealEstatePage } from '../pages/RealEstatePage';

test('"Start Free Trial" redirects to the real estate questionnaire', async ({ page }) => {
  // ВАЖНО: в исходном ТЗ ожидался редирект на
  // https://account.imagen-ai.com/real-estate/login — проверено вживую
  // 2026-09-20: сейчас кнопка ведёт на /real-estate-questionnaire/ (анкета
  // на самом сайте). Похоже, воронка поменялась с момента составления ТЗ.
  // Тест проверяет РЕАЛЬНОЕ текущее поведение — стоит уточнить у клиента,
  // осознанное ли это изменение.
  const realEstatePage = new RealEstatePage(page);
  await realEstatePage.goto();

  await realEstatePage.clickStartFreeTrial();

  await expect(page).toHaveURL(/\/real-estate-questionnaire\/?$/);
});
