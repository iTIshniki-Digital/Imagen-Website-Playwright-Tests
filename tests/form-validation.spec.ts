import { test, expect } from './fixtures';
import { StepTwoPage } from '../pages/StepTwoPage';

// Идём сразу на /step-2/ напрямую, а не через hero CTA — это отдельный,
// стабильный вход (см. pages/StepTwoPage.ts), не завязанный на то, какой
// A/B-вариант hero сейчас активен, и не требующий page.reload()-обхода,
// нужного только при клиентском переходе с главной.
test.describe('Step-2 form validation (negative cases)', () => {
  test('empty email does not submit the form', async ({ page }) => {
    const stepTwoPage = new StepTwoPage(page);
    await page.goto('/step-2/');

    await stepTwoPage.firstNameInput.fill('Playwright');
    await stepTwoPage.lastNameInput.fill('QA');
    await stepTwoPage.emailInput.fill('');
    await stepTwoPage.hearAboutUsSelect.selectOption({ label: 'Other' }, { force: true });
    await stepTwoPage.termsCheckbox.check({ force: true });
    await stepTwoPage.submitButton.click({ force: true });

    await page.waitForTimeout(1500);
    await expect(page, 'Пустой email не должен пропускать дальше step-2').toHaveURL(/\/step-2\//);
  });

  test('malformed email does not submit the form', async ({ page }) => {
    const stepTwoPage = new StepTwoPage(page);
    await page.goto('/step-2/');

    await stepTwoPage.firstNameInput.fill('Playwright');
    await stepTwoPage.lastNameInput.fill('QA');
    await stepTwoPage.emailInput.fill('not-an-email');
    await stepTwoPage.hearAboutUsSelect.selectOption({ label: 'Other' }, { force: true });
    await stepTwoPage.termsCheckbox.check({ force: true });
    await stepTwoPage.submitButton.click({ force: true });

    await page.waitForTimeout(1500);
    await expect(page, 'Невалидный email не должен пропускать дальше step-2').toHaveURL(/\/step-2\//);
  });

  // НАХОДКА 2026-09-26, не ожидание: форма step-2 реально отправляется
  // и уводит дальше по воронке, даже если чекбокс "terms" не отмечен —
  // ни фронтенд, ни (судя по успешному переходу) бэкенд это не проверяют.
  // Стоит сообщить клиенту: возможно, юридический риск (согласие с
  // условиями по факту не обязательно), а не просто мелкий баг формы.
  test('unchecked terms checkbox does NOT block submission (client finding, not a bug in the test)', async ({ page }) => {
    const stepTwoPage = new StepTwoPage(page);
    await page.goto('/step-2/');

    await stepTwoPage.firstNameInput.fill('Playwright');
    await stepTwoPage.lastNameInput.fill('QA');
    await stepTwoPage.emailInput.fill(`playwright-qa-terms-${Date.now()}@example.com`);
    await stepTwoPage.hearAboutUsSelect.selectOption({ label: 'Other' }, { force: true });
    // Намеренно НЕ ставим галочку terms — проверяем, что реально происходит
    await stepTwoPage.submitButton.click({ force: true });

    await expect(
      page,
      'Форма ушла дальше воронки без согласия с условиями — фиксируем как факт для отчёта клиенту'
    ).not.toHaveURL(/\/step-2\//, { timeout: 10000 });
  });
});
