import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

// /questionnaire/ — подтверждено вживую 2026-09-30: это НЕ другая тема
// того же квиза, что на /photo-quiz/ (см. PhotoQuizPage) — это совсем
// другой виджет, Elementor Pro "Form Steps" (12 шагов, элементы
// `.elementor-field-type-step`/`.e-form__step`). Какой из двух виджетов
// покажется после /step-2/, зависит от URL редиректа (подтверждено:
// прямой заход на /photo-quiz/ и на /questionnaire/ каждый раз давал
// один и тот же соответствующий виджет, 2 из 2 на каждый) — то есть это
// не рандом внутри одной страницы, а выбор между двумя разными страницами.
//
// Структура сильно отличается от PhotoQuizPage: реальные вопросы — это
// НЕ 12 задействованных "шагов" (те — пустые служебные маркеры с
// data-атрибутами для JS-визарда, `<div class="e-field-step
// elementor-hidden" data-label="page1" data-nextbutton="Continue">`, без
// текста и полей вообще), а обычные Elementor-поля формы
// (`.elementor-field-group-<имя_поля>`), идущие ПОСЛЕ этих маркеров
// плоским списком. Radio/checkbox `<input>` визуально скрыты (стандартный
// паттерн "стилизованный чекбокс/радио через label") — кликаем по
// `<label>`, а не по `<input>`.
//
// Определить, какой вопрос сейчас показан на экране, через любую простую
// проверку видимости (bounding rect, computed style, даже Playwright'овский
// дешёвый `:visible`-фильтр для списков) НЕ получается — подтверждено
// вживую: все лейблы всех вопросов одновременно проходят такую проверку
// (сайт прячет неактивные шаги через обрезку/трансформацию родительского
// контейнера, а не через display на самих полях). Единственный надёжный
// сигнал — попытка РЕАЛЬНОГО клика (Playwright делает honest hit-test по
// центру элемента перед кликом): клик по лейблу вопроса, который сейчас
// не на экране, либо падает по таймауту, либо явно говорит "outside of
// the viewport" — а клик по лейблу актуального вопроса реально проходит и
// меняет состояние нижележащего input (подтверждено вживую). Поэтому
// answerAllSteps() перебирает известные группы полей по порядку и просто
// пробует клик с коротким таймаутом на каждой — вместо того чтобы гадать
// по разметке, какая из них активна.
export class QuestionnairePage extends BasePage {
  readonly continueButton: Locator;

  constructor(page: Page) {
    super(page);
    this.continueButton = page.getByRole('button', { name: /^continue$/i });
  }

  /**
   * Проходит все шаги формы до конца (пока не иссякнут и вопросы, и
   * доступная для нажатия кнопка Continue). Текстовые уточняющие поля
   * ("Please write..." после выбора "Other") намеренно пропускаются —
   * они необязательные, форма проходит дальше и без них.
   *
   * Подтверждено вживую 2026-10-01: на /video/questionnaire-2/ (22 группы
   * полей — заметно больше, чем на /questionnaire/) визарду иногда нужно
   * ДО 6 СЕКУНД, чтобы вообще стать кликабельным — та же природа, что и
   * "первый экран квиза не активируется сразу" в PhotoQuizPage, просто
   * здесь это не разовый старт, а зависит от объёма формы. Один неудачный
   * проход по всем группам подряд — это нормально, пока он не повторяется;
   * даём до 3 подряд пустых проходов с паузой, прежде чем сдаться.
   */
  async answerAllSteps(maxSteps = 40): Promise<number> {
    await this.dismissCookieBanner();

    const answeredGroups = new Set<string>();
    let consecutiveEmptySweeps = 0;

    for (let i = 0; i < maxSteps; i++) {
      const continueClicked = await this.tryClickContinue();
      if (continueClicked) {
        consecutiveEmptySweeps = 0;
        await this.page.waitForTimeout(700);
        continue;
      }

      const clickedGroupKey = await this.clickFirstReachableOption(answeredGroups);
      if (clickedGroupKey) {
        consecutiveEmptySweeps = 0;
        answeredGroups.add(clickedGroupKey);
        await this.page.waitForTimeout(500);
        continue;
      }

      // Ни Continue, ни один из известных вопросов сейчас не доступны.
      // Может, визард ещё не успел инициализироваться — а может, дошли
      // до конца формы или застряли на чём-то новом.
      consecutiveEmptySweeps++;
      if (consecutiveEmptySweeps >= 3) break;
      await this.page.waitForTimeout(2000);
    }

    return answeredGroups.size;
  }

  private async tryClickContinue(): Promise<boolean> {
    const button = this.continueButton.first();
    if ((await button.count()) === 0) return false;

    const enabled = await button.isEnabled().catch(() => false);
    if (!enabled) return false;

    await button.click({ timeout: 3000 }).catch(() => {});
    return true;
  }

  private async clickFirstReachableOption(answeredGroups: Set<string>): Promise<string | null> {
    const groups = this.page.locator('[class*="elementor-field-group-"]').filter({ has: this.page.locator('label') });
    const groupCount = await groups.count();

    for (let g = 0; g < groupCount; g++) {
      const group = groups.nth(g);
      const className = (await group.getAttribute('class')) || '';
      const key = className.match(/elementor-field-group-(\S+)/)?.[1] ?? `idx-${g}`;

      if (answeredGroups.has(key)) continue;
      if (key.endsWith('_other')) continue; // необязательное уточнение к "Other" — пропускаем

      const labels = group.locator('label');
      const labelCount = await labels.count();
      if (labelCount < 2) continue; // .nth(0) — подпись вопроса, реальные варианты начинаются с .nth(1)

      try {
        await labels.nth(1).click({ timeout: 2000 });
        return key;
      } catch {
        continue; // этот вопрос сейчас не на экране — пробуем следующий по порядку
      }
    }
    return null;
  }
}
