import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { TEST_EMAIL } from './testData';

// Проверено вживую 2026-09-25: форма id="step2" на /step-2/, email уже
// предзаполнен после hero-сабмита (см. HomePage.submitHeroEmail). Поле
// "How did you hear about us?" и чекбокс terms кастомно стилизованы
// (нативный элемент визуально скрыт) — поэтому клики через { force: true },
// иначе Playwright ругается на "element is not visible".
export class StepTwoPage extends BasePage {
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly hearAboutUsSelect: Locator;
  readonly termsCheckbox: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    const form = page.locator('#step2');
    this.firstNameInput = form.locator('#step_2_fname');
    this.lastNameInput = form.locator('input[name="lname"]');
    this.emailInput = form.locator('#step_2_email');
    this.hearAboutUsSelect = form.locator('select[name="how_did_you"]');
    this.termsCheckbox = form.locator('input[name="terms"]');
    this.submitButton = form.locator('#submit');
  }

  async fillAndSubmit(firstName: string, lastName: string, email: string = TEST_EMAIL): Promise<void> {
    await expect(
      this.firstNameInput,
      'Форма step-2 не найдена — возможно, изменилась вёрстка после hero-CTA'
    ).toBeVisible({ timeout: 10000 });

    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);
    // Заполняем email явно, а не полагаемся на prefill — он приходит только
    // от form-варианта hero CTA, у link-варианта поле пустое (см. HomePage).
    await this.emailInput.fill(email);
    await this.hearAboutUsSelect.selectOption({ label: 'Other' }, { force: true });
    await this.termsCheckbox.check({ force: true });
    await this.submitButton.click({ force: true });
  }
}
