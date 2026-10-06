import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { closePromoPopup } from './promoPopup';

// Мобильная воронка (checklist #17/#18). Разведка 2026-10-05 показала, что это
// НЕ та же воронка, что на десктопе: hero-кнопка «Get started» на мобильном —
// это <a> без href, тап по ней ведёт на /q/. /q/ — отдельный онбординг из ~12
// экранов (вопросы с вариантами, интерстициалы «Continue», имя, email), который
// заканчивается экраном «Check your email on desktop»: ссылку на скачивание
// присылают на почту, а не отдают на телефоне.
//
// Что мешает первому тапу: при загрузке на мобильном открывается промо-попап
// Elementor (.elementor-popup-modal, «The next evolution of your workflow is
// here»). Это полноэкранный оверлей, он перекрывает hero-кнопку и блокирует
// прокрутку, поэтому тап уходит в попап. Попап появляется с задержкой, поэтому
// его надо дождаться и закрыть крестиком — так же поступит посетитель.

export const HERO_MOBILE_CTA = 'xpath=//a[contains(@class,"elementor-button") and not(@href) and not(ancestor::header)]';

export class MobileOnboardingPage extends BasePage {
  /** Количество отвеченных вопросов (варианты выбраны) за один проход. */
  answered = 0;

  constructor(page: Page) {
    super(page);
  }

  /**
   * Закрывает промо-попап, если он появился. Ждёт его недолго: попап открывается
   * с задержкой, а на страницах без него просто возвращает false.
   */
  async closePromoPopupIfShown(): Promise<boolean> {
    return closePromoPopup(this.page);
  }

  /**
   * Тапает мобильную hero-кнопку до перехода на /q/. Возвращает число тапов,
   * понадобившихся для перехода. Норма — 1: попап к этому моменту уже закрыт
   * (см. closePromoPopupIfShown). Больше 1 значит, что что-то всё ещё
   * перекрывает кнопку.
   */
  async tapHeroUntilOnboarding(maxTaps = 3): Promise<number> {
    const cta = this.page.locator(HERO_MOBILE_CTA).filter({ hasText: /get started/i }).first();
    await expect(cta, 'На мобильной главной не нашлась hero-кнопка «Get started»').toBeAttached();
    await cta.scrollIntoViewIfNeeded();

    for (let tap = 1; tap <= maxTaps; tap++) {
      // Прокрутка перед каждым тапом: кнопка ниже сгиба (вьюпорт iPhone 390×664), и без неё
      // координаты указывают за экран — тап уходит мимо, как и было в прогонах 2026-10-06.
      await cta.scrollIntoViewIfNeeded();
      const box = await cta.boundingBox();
      if (!box) throw new Error('hero-кнопка скрыта — не могу тапнуть');
      // Клик мышью по координатам: touchscreen.tap на этой странице не давал
      // перехода, пока попап перекрывал кнопку.
      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      try {
        await this.page.waitForURL(/\/q\//, { timeout: 8000 });
        return tap;
      } catch {
        // первый тап проигнорирован — повторяем
      }
    }
    throw new Error(`hero-кнопка не привела на /q/ после ${maxTaps} тапов`);
  }

  /**
   * Проходит онбординг до экрана email, каждый вопрос — первым вариантом,
   * интерстициалы — «Continue». Идёт по тексту экрана, а не по номерам шагов,
   * чтобы не ломаться, когда клиент меняет вопросы.
   */
  async walkToEmailScreen(maxSteps = 25): Promise<void> {
    let lastBody = '';
    let repeats = 0;

    for (let step = 0; step < maxSteps; step++) {
      const body = await this.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
      if (/Where to send your link/i.test(body)) return;

      if (body === lastBody) {
        repeats++;
        expect(repeats, `Онбординг завис на экране: «${body.slice(0, 120)}»`).toBeLessThan(3);
      } else {
        repeats = 0;
      }
      lastBody = body;

      if (/What's your name/i.test(body)) {
        await this.page.getByPlaceholder('First name').fill('Playwright');
        await this.page.getByPlaceholder('Last name').fill('QA');
        await this.page.getByText('Continue', { exact: true }).first().click();
        await this.page.waitForTimeout(1500);
        continue;
      }

      const clickable = await this.firstClickableOption();
      expect(clickable, `Нет кнопки или варианта для продолжения на экране: «${body.slice(0, 120)}»`).not.toBeNull();
      if (clickable !== 'Continue') this.answered++;

      await this.page.getByText(clickable!, { exact: true }).first().click({ timeout: 4000 });
      await this.page.waitForTimeout(1200);
    }

    throw new Error(`Онбординг не дошёл до экрана email за ${maxSteps} шагов`);
  }

  /**
   * Первый видимый вариант ответа или кнопка продолжения. «Continue» предпочтителен
   * на интерстициалах, где вариантов нет.
   */
  private async firstClickableOption(): Promise<string | null> {
    return this.page.evaluate(() => {
      const isClickable = (el: Element) => {
        const text = ((el as HTMLElement).innerText || '').trim();
        if (!text || text.length > 40 || !(el as HTMLElement).offsetParent) return false;
        const cs = getComputedStyle(el);
        return cs.cursor === 'pointer' || el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button';
      };
      const items = Array.from(document.querySelectorAll('button, a, [role=button], div, span, label'))
        .filter(isClickable)
        .map((el) => ((el as HTMLElement).innerText || '').trim().split('\n')[0]);
      const unique = Array.from(new Set(items));
      if (unique.includes('Continue')) return 'Continue';
      return unique[0] ?? null;
    });
  }

  /**
   * Экран «Where to send your link?»: email, согласие, отправка. Поле-ловушку
   * `website` не трогаем — оно должно оставаться пустым (иначе форма молча
   * отклонит отправку, как у hero-формы).
   */
  async submitEmail(email: string): Promise<{ consentPreChecked: boolean }> {
    await this.page.getByPlaceholder('Email address').fill(email);

    const consent = this.page.locator('input[type="checkbox"]').first();
    const consentPreChecked = await consent.isChecked();
    if (!consentPreChecked) {
      await this.page.getByText('I agree to the terms of use', { exact: false }).first().click();
    }

    await this.page.getByText('Send me the download link', { exact: true }).first().click();
    return { consentPreChecked };
  }
}
