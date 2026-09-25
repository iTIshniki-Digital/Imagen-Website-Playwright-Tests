import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

// Проверено вживую 2026-09-25 (see pages/PhotoQuizPage.ts): квиз на
// /photo-quiz/ — одна страница, экраны показываются/скрываются через JS,
// не отдельные URL. Паттерн экрана с вопросом: h2.q-title + div.answer
// (несколько вариантов), после ответа либо сразу открывается следующий
// вопрос, либо нужно нажать .screen-continue-btn — оба варианта
// встречаются, поэтому проверяем оба на каждом шаге.
//
// ВАЖНО: последний экран (после ~8 вопросов) — платное предложение
// ("Claim my ... month", класс offer-screen-btn). Эту кнопку намеренно
// НИКОГДА не нажимаем — она ведёт к реальному оформлению подписки. Вместо
// неё есть ссылка "Or try a limited free trial" — только её и жмём.
//
// Дальше страницы "Download for Mac/PC" НЕ подтверждено вживую (экран
// после клика на free trial ведёт себя нестабильно при автоматических
// прогонах — нужно больше живой отладки), поэтому downloadButton здесь
// есть, но никакой тест пока не утверждает, что он появляется.
export class PhotoQuizPage extends BasePage {
  readonly questionTitle: Locator;
  readonly answers: Locator;
  readonly continueButton: Locator;
  readonly freeTrialLink: Locator;
  readonly claimPaidPlanButton: Locator;
  readonly downloadMacButton: Locator;
  readonly downloadPcButton: Locator;

  constructor(page: Page) {
    super(page);
    this.questionTitle = page.locator('.q-title:visible').first();
    this.answers = page.locator('.answer:visible');
    this.continueButton = page.locator('.screen-continue-btn:visible').first();
    this.freeTrialLink = page.getByText(/limited free trial/i);
    this.claimPaidPlanButton = page.locator('.offer-screen-btn');
    this.downloadMacButton = page.locator('.free-trial-download-btn', { hasText: 'Mac' });
    this.downloadPcButton = page.locator('.free-trial-download-btn', { hasText: 'PC' });
  }

  /**
   * Проходит по вопросам до экрана платного предложения и там
   * останавливается — это подтверждённая вживую граница. Переход по
   * freeTrialLink дальше НЕ делаем здесь: что происходит после него, ещё
   * не подтверждено достаточно стабильно, см. комментарий к классу.
   */
  async answerUntilOffer(maxSteps = 15): Promise<void> {
    for (let i = 0; i < maxSteps; i++) {
      const offerVisible = await this.claimPaidPlanButton.first().isVisible().catch(() => false);
      if (offerVisible) break;

      const answerCount = await this.answers.count();
      if (answerCount > 0) {
        await this.answers.first().click({ force: true });
        await this.page.waitForTimeout(600);
        continue;
      }

      const hasContinue = (await this.continueButton.count()) > 0;
      if (hasContinue) {
        await this.continueButton.click({ force: true });
        await this.page.waitForTimeout(600);
        continue;
      }

      break;
    }
  }
}
