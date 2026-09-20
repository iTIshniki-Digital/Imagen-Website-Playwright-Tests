import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class RealEstatePage extends BasePage {
  readonly startFreeTrialButton: Locator;

  constructor(page: Page) {
    super(page);
    this.startFreeTrialButton = page.getByRole('link', { name: /start free trial/i }).first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/real-estate/');
  }

  async clickStartFreeTrial(): Promise<void> {
    await this.startFreeTrialButton.click();
  }
}
