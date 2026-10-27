import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { advanceQuizStep } from './quizWalker';

// Квиз на /photo-quiz/ пересобран на Astro 2026-10 вместе со всем сайтом.
// Разметка стала НАМНОГО стабильнее старой Elementor-версии — разведка
// 2026-10-27 прошла квиз от начала до экрана скачивания несколько раз
// подряд без единого зависания. Общая механика экранов — см. quizWalker.ts.
//
// ВАЖНО: экран платного предложения (кнопка "Claim my ... month", класс
// .pqoffer__claim) — эту кнопку намеренно НИКОГДА не нажимаем, она ведёт
// к реальному оформлению подписки. Вместо неё — ссылка "Or try a limited
// free trial" (класс .pq-link), только её и жмём.
export class PhotoQuizPage extends BasePage {
  readonly claimPaidPlanButton: Locator;
  readonly freeTrialLink: Locator;
  readonly downloadMacButton: Locator;
  readonly downloadPcButton: Locator;

  constructor(page: Page) {
    super(page);
    this.claimPaidPlanButton = page.locator('.pqoffer__claim');
    this.freeTrialLink = page.locator('.pq-link', { hasText: /free trial/i });
    this.downloadMacButton = page.locator('.pqtrial__download', { hasText: 'Mac' });
    this.downloadPcButton = page.locator('.pqtrial__download', { hasText: 'PC' });
  }

  /**
   * Проходит по вопросам до экрана платного предложения и там
   * останавливается. Порядок и количество экранов по факту фиксированы
   * (не "рандомизированы", как считалось на старом сайте) — но метод всё
   * равно устойчив к любому их количеству/порядку, читая состояние
   * экрана на каждом шаге, а не полагаясь на заранее известную схему.
   */
  async answerUntilOffer(maxSteps = 30): Promise<void> {
    await this.dismissCookieBanner();

    for (let i = 0; i < maxSteps; i++) {
      const offerVisible = await this.claimPaidPlanButton.first().isVisible().catch(() => false);
      if (offerVisible) return;

      await advanceQuizStep(this.page);
    }
  }
}
