import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { TEST_EMAIL } from './testData';

export class HomePage extends BasePage {
  // Сайт на Elementor — CSS-классы вида "elementor-element-3f8a1b2" нестабильны
  // и меняются при каждой правке в редакторе, поэтому НЕ используем их как локаторы.
  // getByRole ищет по семантике (роль + видимый текст), это переживает верстку.
  readonly navGetStartedButton: Locator;

  // Подтверждено вживую, что hero-CTA — это активный A/B-тест минимум с
  // двумя разными реализациями, переключающимися без предупреждения:
  //   - 2026-09-24/25: submit-кнопка внутри формы id="go_to_step2_new_hp"
  //     с email-полем (#form-field-email) — без заполненного email кнопка
  //     ничего не делает.
  //   - 2026-09-26: та же форма скрыта (display:none), вместо неё простая
  //     ссылка <a>Get Started</a> без формы, ведёт на /step-2/ напрямую.
  // Раньше это уже приводило к ложному отчёту "hero CTA пропала" (старый
  // локатор искал только ссылки и не видел форму). Теперь оба варианта
  // поддержаны явно — какой из них активен на конкретном прогоне, решаем
  // рантаймом, а не жёстко фиксируем один.
  readonly heroForm: Locator;
  readonly heroEmailInput: Locator;
  readonly heroFormSubmitButton: Locator;
  readonly heroLinkVariant: Locator;

  constructor(page: Page) {
    super(page);

    this.navGetStartedButton = page.locator('header').getByRole('link', { name: /get started/i }).first();

    this.heroForm = page.locator('#go_to_step2_new_hp');
    this.heroEmailInput = this.heroForm.locator('#form-field-email');
    this.heroFormSubmitButton = this.heroForm.getByRole('button', { name: /get started/i });

    this.heroLinkVariant = page
      .getByRole('link', { name: /get started/i })
      .filter({ hasNot: page.locator('xpath=ancestor::header') });
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async clickNavGetStarted(): Promise<void> {
    await this.navGetStartedButton.click();
  }

  /**
   * Проходит hero-CTA к /step-2/, каким бы A/B-вариантом она сейчас ни
   * была (форма с email или простая ссылка). Возвращает, какой вариант
   * сработал — полезно залогировать в тесте, чтобы было видно в отчёте.
   */
  async continueToStepTwo(email: string = TEST_EMAIL): Promise<'form' | 'link'> {
    const formVisible = await this.heroEmailInput.isVisible().catch(() => false);
    if (formVisible) {
      await this.heroEmailInput.fill(email);
      // form_fields[invalid] — honeypot-поле Elementor против ботов: если
      // его заполнить, форма молча отклонит отправку. Не трогаем.
      await this.heroFormSubmitButton.click();
      return 'form';
    }

    await expect(
      this.heroLinkVariant.first(),
      'Hero "Get Started" was found as neither a form nor a link — possibly a new A/B variant or a real layout change'
    ).toBeVisible({ timeout: 10000 });
    await this.heroLinkVariant.first().click();
    return 'link';
  }
}
