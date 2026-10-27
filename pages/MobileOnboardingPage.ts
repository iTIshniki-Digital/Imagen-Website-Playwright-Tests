import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { advanceQuizStep } from './quizWalker';

// Мобильная воронка (checklist #17/#18). Сайт пересобран на Astro 2026-10 —
// разведка 2026-10-27:
// - hero-кнопка «Get started» в хедере (a.cta.cta--header) имеет статичный
//   href="/step-2/" (прогрессивное улучшение), но реальный клик
//   перехватывается JS и ведёт на /q/ — отдельный мобильный онбординг.
// - Промо-попапа на мобильном больше нет (как и на десктопе) — весь код
//   его закрытия убран, тапать сразу безопасно.
// - /q/ — тот же виджет-семья, что /photo-quiz/ и /video/questionnaire/
//   (см. pages/quizWalker.ts), просто под классом .mq-screen. Отвечаем на
//   вопросы универсальным advanceQuizStep(), но экран имени (текстовые
//   поля, не radio/checkbox) и финальный экран email — особые, их ведём
//   явно здесь.
export const HERO_MOBILE_CTA = 'a.cta.cta--header';

export class MobileOnboardingPage extends BasePage {
  /** Количество отвеченных вопросов (варианты выбраны) за один проход. */
  answered = 0;

  constructor(page: Page) {
    super(page);
  }

  /** Промо-попапа на сайте больше нет — метод оставлен no-op ради обратной совместимости вызовов. */
  async closePromoPopupIfShown(): Promise<boolean> {
    return false;
  }

  /**
   * Тапает мобильную hero-кнопку до перехода на /q/. Возвращает число тапов
   * (обычно 1 — больше одного означает, что что-то мешает клику).
   */
  async tapHeroUntilOnboarding(maxTaps = 3): Promise<number> {
    const cta = this.page.locator(HERO_MOBILE_CTA).first();
    await expect(cta, 'The "Get started" hero button was not found on the mobile homepage').toBeAttached();
    await cta.scrollIntoViewIfNeeded();

    for (let tap = 1; tap <= maxTaps; tap++) {
      await cta.scrollIntoViewIfNeeded();
      const box = await cta.boundingBox();
      if (!box) throw new Error('hero button is hidden — cannot tap it');
      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      try {
        await this.page.waitForURL(/\/q\//, { timeout: 8000 });
        return tap;
      } catch {
        // первый тап проигнорирован — повторяем
      }
    }
    throw new Error(`hero button did not lead to /q/ after ${maxTaps} taps`);
  }

  /**
   * Проходит онбординг (.mq-screen) до экрана email ("Where to send your
   * link?") и там останавливается. Вопросы/интерстишлы — через общий
   * advanceQuizStep(); экран имени (текстовые поля #q-fname/#q-lname) —
   * отдельно, тот же паттерн, что не подходит под общий квиз-степпер.
   */
  async walkToEmailScreen(maxSteps = 30): Promise<void> {
    for (let step = 0; step < maxSteps; step++) {
      const emailScreen = this.page.locator('.mq-screen:not([hidden]) #q-email');
      if (await emailScreen.count()) return;

      const nameScreen = this.page.locator('.mq-screen:not([hidden]) #q-fname');
      if (await nameScreen.count()) {
        await nameScreen.fill('Playwright');
        await this.page.locator('.mq-screen:not([hidden]) #q-lname').fill('QA');
        await this.page.locator('.mq-screen:not([hidden]) [data-quiz-next]').click();
        await this.page.waitForTimeout(1000);
        continue;
      }

      const result = await advanceQuizStep(this.page);
      if (result === 'answered') this.answered++;
      if (result === 'no-screen') {
        throw new Error('Onboarding left /q/ before reaching the email screen');
      }
    }

    throw new Error(`Onboarding did not reach the email screen within ${maxSteps} steps`);
  }

  /**
   * Экран «Where to send your link?»: email, согласие, отправка. Поле-ловушку
   * #q-hp (name="dvash") не трогаем — оно должно оставаться пустым, иначе
   * форма молча отклонит отправку (та же анти-бот защита, что на step-2).
   */
  async submitEmail(email: string): Promise<{ consentPreChecked: boolean }> {
    await this.page.locator('#q-email').fill(email);

    const consent = this.page.locator('#q-terms');
    const consentPreChecked = await consent.isChecked();
    if (!consentPreChecked) await consent.check();

    await this.page.locator('.mq-screen:not([hidden]) [data-quiz-next]').click();
    return { consentPreChecked };
  }
}
