import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { TEST_EMAIL } from './testData';

// Сайт пересобран на Astro 2026-10 — форма теперь form.s2__form (не
// id="step2"), поля #s2-fname/#s2-lname/#s2-email/#s2-heard/#s2-terms,
// кнопка button.s2__submit. Поля обычные, нативно видимые (не кастомно
// спрятанный Elementor-инпут, как было раньше) — { force: true } больше
// не нужен, но не мешает оставить ради устойчивости к мелким правкам
// стилей. terms-чекбокс теперь ПО УМОЛЧАНИЮ отмечен (разведка 2026-10-27).
//
// Тот же компонент используется и на /video/step-2/ (data-product="video"
// вместо "photo"), но там НЕТ поля #s2-heard ("How did you hear about
// us?") — форма короче (разведка 2026-10-27). fillAndSubmit() поэтому
// трогает select, только если он реально есть на экране.
//
// НАЙДЕНО 2026-10-27 — причина флейкового "форма ушла обычным GET со
// всеми полями в query string вместо редиректа на квиз": в
// /_astro/form-guard.*.js есть осознанная анти-бот защита с порогом
// minSeconds: 2 — сабмит молча отклоняется (preventDefault, без видимой
// ошибки), если с момента инициализации формы прошло меньше 2 секунд.
// Playwright кликает быстрее человека, поэтому без паузы попадает точно
// в это окно. Решение — не гадать таймаутом на глазок, а явно ждать
// заведомо больше порога перед кликом по submit.
export class StepTwoPage extends BasePage {
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly hearAboutUsSelect: Locator;
  readonly termsCheckbox: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    const form = page.locator('form.s2__form');
    this.firstNameInput = form.locator('#s2-fname');
    this.lastNameInput = form.locator('#s2-lname');
    this.emailInput = form.locator('#s2-email');
    this.hearAboutUsSelect = form.locator('#s2-heard');
    this.termsCheckbox = form.locator('#s2-terms');
    this.submitButton = form.locator('button.s2__submit');
  }

  async fillAndSubmit(firstName: string, lastName: string, email: string = TEST_EMAIL): Promise<void> {
    await expect(
      this.firstNameInput,
      'The step-2 form (#s2-fname) was not found — the layout may have changed after the hero CTA'
    ).toBeVisible({ timeout: 10000 });

    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);
    // Заполняем email явно, а не полагаемся только на prefill — так тест
    // не зависит от того, пришли ли сюда через hero-форму или напрямую.
    await this.emailInput.fill(email);
    if (await this.hearAboutUsSelect.count()) {
      await this.hearAboutUsSelect.selectOption({ label: 'Other' }, { force: true });
    }
    await this.termsCheckbox.check({ force: true });

    // См. комментарий класса — анти-бот гвард требует >= 2с с инициализации
    // формы. Заполнение полей выше уже съедает часть этого времени, но не
    // надёжно — ждём с запасом, а не полагаемся на случайную задержку.
    await this.page.waitForTimeout(2500);
    await this.submitButton.click({ force: true });
  }
}
