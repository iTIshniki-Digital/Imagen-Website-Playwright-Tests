import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

// Проверено вживую 2026-09-30 на /video/step-2/: та же схема формы, что
// у основного step-2 (pages/StepTwoPage.ts) — имя/фамилия/email/submit
// "Sign up & download". В отличие от основного step-2, тут не видели ни
// dropdown "how did you hear", ни чекбокс terms — форма проще.
export class VideoStepTwoPage extends BasePage {
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    this.firstNameInput = page.locator('input[name="fname"]');
    this.lastNameInput = page.locator('input[name="lname"]');
    this.emailInput = page.locator('input[name="email"]');
    this.submitButton = page.getByRole('button', { name: /sign up.*download/i });
  }

  async fillAndSubmit(firstName: string, lastName: string, email: string): Promise<void> {
    await expect(
      this.firstNameInput,
      'Форма /video/step-2/ не найдена — возможно, изменилась вёрстка'
    ).toBeVisible({ timeout: 10000 });
    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);
    await this.emailInput.fill(email);
    await this.submitButton.click();
  }
}
