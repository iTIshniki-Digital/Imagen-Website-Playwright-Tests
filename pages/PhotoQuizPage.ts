import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

// Квиз на /photo-quiz/ (он же /questionnaire/, см. HomePage) — одна
// страница, экраны показываются/скрываются через JS, не отдельные URL.
// Подтверждено вживую 2026-09-30: это сильно рандомизированный виджет —
// между заходами варьируются тема оформления, URL, ПОРЯДОК вопросов,
// их количество (видели от ~8 до заметно больше) и типы экранов:
//   - h2.q-title + несколько div.answer (обычный вопрос)
//   - чисто маркетинговые интерстишлы без вопроса — слайдер "до/после" +
//     буллеты (например "Imagen for Weddings"), с кнопкой Continue БЕЗ
//     класса .screen-continue-btn (добавлен текстовый фолбэк, см. ниже)
// ВАЖНО про reload: на /step-2/ он обязателен (см. StepTwoPage) — но
// ЗДЕСЬ, на /photo-quiz/, делать reload перед взаимодействием оказалось
// вредно: ломает прохождение почти сразу. Не переносить этот паттерн
// бездумно с одной страницы на другую — сайт ведёт себя по-разному.
//
// ВАЖНО: экран платного предложения ("Claim my ... month", класс
// offer-screen-btn) — эту кнопку намеренно НИКОГДА не нажимаем, она ведёт
// к реальному оформлению подписки. Вместо неё есть ссылка "Or try a
// limited free trial" — только её и жмём.
//
// answerUntilOffer() написан и работает (подтверждено — доходит до новых,
// ранее не виденных экранов вроде "Imagen for Weddings"), но полное
// прохождение до самого экрана оффера занимает от 90 до 150+ секунд
// живого времени на реальном сайте и переменное число шагов — слишком
// долго и вариативно для быстрого стабильного теста. Метод оставлен
// доступным (пригодится для ручной отладки или отдельного долгого
// теста), но НЕ вызывается ни из одного теста в этой сборке — см.
// tests/signup-funnel.spec.ts, который проверяет более скромную,
// быстро достижимую границу.
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
    // Кроме экранов с вопросом (.screen-continue-btn) встречаются и чисто
    // маркетинговые интерстишлы (слайдер "до/после" + буллеты, например
    // "Imagen for Weddings") с кнопкой "Continue" без этого класса —
    // добавляем текстовый фолбэк.
    this.continueButton = page
      .locator('.screen-continue-btn:visible')
      .or(page.getByRole('button', { name: /^continue$/i }))
      .first();
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
   *
   * Порядок, количество и оформление вопросов варьируются между заходами
   * (подтверждено вживую 2026-09-30 — это не баг теста, сайт настолько
   * рандомизирован). Изредка клик по ответу не успевает провзаимодействовать
   * с SPA до истечения паузы — заголовок вопроса не меняется, хотя клик
   * прошёл без ошибок и hit-test подтверждает точное попадание. Поэтому
   * после клика проверяем, что состояние экрана реально изменилось, и
   * повторяем клик, если нет — вместо того чтобы слепо идти дальше.
   */
  async answerUntilOffer(maxSteps = 30): Promise<void> {
    for (let i = 0; i < maxSteps; i++) {
      const offerVisible = await this.claimPaidPlanButton.first().isVisible().catch(() => false);
      if (offerVisible) break;

      const answerCount = await this.answers.count();
      if (answerCount > 0) {
        const titleBefore = await this.questionTitle.textContent().catch(() => null);
        let advanced = false;

        for (let attempt = 0; attempt < 3 && !advanced; attempt++) {
          await this.answers.first().click();
          await this.page.waitForTimeout(700);

          const offerNow = await this.claimPaidPlanButton.first().isVisible().catch(() => false);
          const titleAfter = await this.questionTitle.textContent().catch(() => null);
          const hasContinueNow = (await this.continueButton.count()) > 0;
          advanced = offerNow || titleAfter !== titleBefore || hasContinueNow;
        }
        continue;
      }

      const hasContinue = (await this.continueButton.count()) > 0;
      if (hasContinue) {
        await this.continueButton.click();
        await this.page.waitForTimeout(600);
        continue;
      }

      break;
    }
  }
}
