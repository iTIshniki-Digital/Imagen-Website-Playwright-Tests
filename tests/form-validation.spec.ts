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
    await expect(page, "An empty email shouldn't let the form past step-2").toHaveURL(/\/step-2\//);
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
    await expect(page, "An invalid email shouldn't let the form past step-2").toHaveURL(/\/step-2\//);
  });

  // РАНЬШЕ (до 2026-10-27, старый Elementor-сайт) это было НАХОДКОЙ, а не
  // ожиданием: форма step-2 реально отправлялась и уводила дальше по
  // воронке, даже если чекбокс "terms" не отмечен — ни фронтенд, ни бэкенд
  // это не проверяли. Мы сообщили об этом клиенту как о юридическом риске.
  //
  // Разведка 2026-10-27 на новом (Astro) сайте: клиент это ПОЧИНИЛ — terms
  // теперь (а) отмечен по умолчанию и (б) реально валидируется на клиенте
  // (client-side validation blocks submit, fname focus переходит на чекбокс,
  // показывается #s2-terms-error). Тест теперь проверяет обратное — что
  // починка держится, а не что баг есть.
  test('unchecked terms checkbox blocks submission (client fixed the 2026-09-26 finding)', async ({ page }) => {
    const stepTwoPage = new StepTwoPage(page);
    await page.goto('/step-2/');

    await stepTwoPage.firstNameInput.fill('Playwright');
    await stepTwoPage.lastNameInput.fill('QA');
    await stepTwoPage.emailInput.fill(`playwright-qa-terms-${Date.now()}@example.com`);
    await stepTwoPage.hearAboutUsSelect.selectOption({ label: 'Other' }, { force: true });
    await stepTwoPage.termsCheckbox.uncheck({ force: true });
    await stepTwoPage.submitButton.click({ force: true });

    await expect(
      page,
      'Submitting with unchecked terms should keep the visitor on step-2'
    ).toHaveURL(/\/step-2\//, { timeout: 5000 });
    await expect(
      page.locator('#s2-terms-error'),
      'No validation error shown for the unchecked terms checkbox'
    ).not.toBeEmpty();
  });
});
