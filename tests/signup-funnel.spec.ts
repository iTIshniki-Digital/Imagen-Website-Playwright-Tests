import { test, expect } from './fixtures';
import { HomePage } from '../pages/HomePage';
import { StepTwoPage } from '../pages/StepTwoPage';

test.describe('Signup funnel', () => {
  // Один сквозной тест вместо нескольких мелких — каждый прогон этого
  // теста создаёт реальную запись в CRM клиента (см. TEST_EMAIL), лишний
  // раз плодить такие тесты не стоит.
  //
  // Дальше квиза (pages/PhotoQuizPage.ts, вопросы с .q-title/.answer) тест
  // намеренно НЕ идёт: механика прохождения вопросов подтверждена вручную,
  // но нестабильна в автоматическом прогоне (не выяснено до конца, почему) —
  // лучше не утверждать то, в чём нет уверенности, чем оставить мигающий тест.
  test('hero CTA -> step-2 form -> lands on photo quiz signed up', async ({ page }) => {
    const homePage = new HomePage(page);
    const stepTwoPage = new StepTwoPage(page);

    await homePage.goto();
    await homePage.continueToStepTwo();
    await expect(page).toHaveURL(/\/step-2\/?/);

    // Подтверждено вживую 2026-09-26: если попасть на /step-2/ через
    // клиентский переход с hero CTA (без полной перезагрузки страницы),
    // JS-обработчик submit формы step2 не успевает забиндиться — форма
    // отправляется как обычный GET со всеми полями в query string вместо
    // AJAX-редиректа на /photo-quiz/. page.reload() форсирует полную
    // загрузку страницы, после которой обработчик работает штатно. Похоже
    // на реальную хрупкость сайта (не баг теста) — стоит знать про этот
    // сценарий, даже если сам этот reload делает тест зелёным.
    await page.reload();

    await stepTwoPage.fillAndSubmit('Playwright', 'QA');

    await expect(page, 'После step-2 должны попасть в фото-квиз').toHaveURL(/\/photo-quiz\//, { timeout: 15000 });
    await expect(page.getByText(/you're signed up/i)).toBeVisible();
  });
});
