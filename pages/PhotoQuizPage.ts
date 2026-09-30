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
// answerUntilOffer() доходит до экрана оффера (подтверждено вживую
// 2026-09-30), но полное прохождение занимает от 90 до 150+ секунд живого
// времени и переменное число шагов — слишком долго для быстрого теста,
// который должен гонять часто. Поэтому вызывается не из signup-funnel.spec.ts
// (там проверяется только сам факт попадания на страницу квиза — быстро и
// надёжно), а из отдельного tests/quiz-full-walkthrough.spec.ts с большим
// таймаутом, предназначенного именно для такой глубокой проверки.
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
   * рандомизирован).
   *
   * ВАЖНО про два режима вопросов (найдено вживую 2026-09-30 при разборе
   * зависания на вопросе "Your go-to software..."): часть вопросов
   * переходит на следующий экран СРАЗУ по клику на ответ (Continue вообще
   * не показывается); другая часть — похоже, с множественным выбором —
   * держит Continue видимым одновременно с ответами, клик по ответу там
   * только выделяет вариант, а переход дальше требует отдельного клика по
   * Continue. Старая версия этого метода считала "Continue стал виден"
   * доказательством того, что клик по ответу уже сработал — из-за этого
   * зацикливалась на вопросах второго типа (кликала один и тот же ответ
   * 29+ раз подряд, никогда не нажимая саму кнопку). Теперь это два явных
   * состояния на экран: сначала выбираем ответ (если ещё не выбирали на
   * этом самом экране), потом, если есть Continue, жмём его.
   */
  async answerUntilOffer(maxSteps = 40): Promise<void> {
    await this.dismissCookieBanner();
    await this.waitForFirstScreenReady();

    let lastTitle: string | null = null;
    let selectedOnThisScreen = false;

    for (let i = 0; i < maxSteps; i++) {
      const offerVisible = await this.claimPaidPlanButton.first().isVisible().catch(() => false);
      if (offerVisible) break;

      // ВАЖНО (найдено вживую 2026-09-30, стоило теста, зависшего на 240с):
      // .textContent() без явного timeout ждёт появления элемента ДО
      // ДЕФОЛТНОГО таймаута (30с!), если .q-title сейчас нет вообще — а на
      // маркетинговых интерстишлах (например "Imagen for Weddings") его и
      // правда нет. isVisible()/count() возвращают мгновенно даже при 0
      // совпадений, но textContent()/isDisabled()/isEnabled() — нет,
      // поэтому именно здесь короткий timeout обязателен.
      const currentTitle = await this.questionTitle.textContent({ timeout: 1000 }).catch(() => null);
      if (currentTitle !== lastTitle) {
        lastTitle = currentTitle;
        selectedOnThisScreen = false;
      }

      const answerCount = await this.answers.count();
      const hasContinue = (await this.continueButton.count()) > 0;

      if (answerCount > 0 && !selectedOnThisScreen) {
        // selectedOnThisScreen ставим true, только если клик реально
        // прошёл — иначе (например, что-то на секунду перекрыло .answer,
        // как было с cookie-баннером) следующая итерация просто повторит
        // ту же попытку, а не молча решит, что ответ уже выбран.
        const clicked = await this.answers
          .first()
          .click({ timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        selectedOnThisScreen = clicked;
        await this.page.waitForTimeout(700);
        continue;
      }

      if (hasContinue) {
        try {
          await this.continueButton.click({ timeout: 5000 });
        } catch {
          // Похоже на множественный выбор: одного варианта не хватило,
          // чтобы разблокировать Continue — добавляем ещё один и пробуем снова.
          if (answerCount > 1) {
            await this.answers.nth(1).click({ timeout: 3000 }).catch(() => {});
            await this.page.waitForTimeout(500);
            await this.continueButton.click({ timeout: 5000 }).catch(() => {});
          }
        }
        await this.page.waitForTimeout(700);
        continue;
      }

      if (answerCount > 0) {
        // selectedOnThisScreen уже true, но экран не сдвинулся и Continue
        // не появился — клик мог не провзаимодействовать с SPA (см.
        // историю правок), пробуем ещё раз.
        await this.answers.first().click({ timeout: 3000 }).catch(() => {});
        await this.page.waitForTimeout(700);
        continue;
      }

      break;
    }
  }

  /**
   * Подтверждено вживую 2026-09-30: примерно в четверти заходов первый
   * экран квиза не активируется — его `.screen`-обёртка остаётся с
   * `display:none` (весь ответ есть в DOM, но невидим и некликабелен),
   * хотя заголовок вопроса уже читается из DOM. Похоже на редкий сбой
   * инициализации виджета на стороне сайта: подождать дольше не помогает
   * (проверяли до 8с) — состояние не самовосстанавливается. Один reload
   * здесь безопасен (в отличие от reload ПОСЛЕ начала квиза — см.
   * комментарий к классу): мы ещё ничего не выбрали, терять нечего.
   */
  private async waitForFirstScreenReady(maxAttempts = 2): Promise<void> {
    const ready = this.answers.first().or(this.continueButton).or(this.claimPaidPlanButton);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const becameReady = await ready
        .first()
        .waitFor({ state: 'visible', timeout: 6000 })
        .then(() => true)
        .catch(() => false);
      if (becameReady) return;
      if (attempt < maxAttempts) await this.page.reload();
    }
  }
}
