import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { wakeUpPageScripts } from './pageActivation';

// /questionnaire/ и /video/questionnaire-2/ — один и тот же виджет Elementor Pro
// "Form Steps" (подтверждено вживую 2026-09-30 и 2026-10-05). Не путать с
// /photo-quiz/ (PhotoQuizPage): тот — другой виджет, классический квиз.
//
// Устройство виджета (разведка 2026-10-05): все группы полей
// `.elementor-field-group-<имя>` лежат плоским списком, а вопрос вставляется в
// группу, когда её шаг становится активным. Поэтому список групп, снятый при
// загрузке, не отражает, что на экране сейчас. Надёжный сигнал — то, что видно
// пользователю прямо сейчас: варианты ответов (radio/checkbox внутри <label>) в
// окне просмотра и кнопка, которой визард идёт дальше.
//
// Прежний обход шёл по сохранённым ключам групп и знал только «Continue». На
// видео-анкете финальная кнопка называется «Finish setup» — обход её не нажимал,
// и анкета «застревала» на предпоследнем экране. Сейчас обход идёт по
// состоянию экрана и понимает все три кнопки продвижения.
export class QuestionnairePage extends BasePage {
  // Кнопки продвижения визарда. «Finish setup» — финальная на видео-анкете.
  private static readonly FORWARD_BUTTON = /^(continue|next|finish setup)$/i;

  constructor(page: Page) {
    super(page);
  }

  /**
   * Проходит анкету до конца: отвечает на все видимые вопросы первым вариантом и
   * жмёт кнопку продвижения. Останавливается, когда URL сменился (форма отправлена,
   * например, на /video/download/) или когда больше нечего делать.
   *
   * Возвращает число реально отмеченных ответов. Ответ засчитывается, только если
   * после клика группа вопроса стала отмеченной, — клик, который не сработал,
   * не считается.
   */
  async answerAllSteps(maxSteps = 60): Promise<number> {
    // Без первого действия пользователя визард не запускается вообще (см. pageActivation.ts).
    await wakeUpPageScripts(this.page);
    await this.dismissCookieBanner();

    const startUrl = this.page.url();
    const tried = new Set<string>();
    let answered = 0;
    let idle = 0;

    try {
      for (let i = 0; i < maxSteps; i++) {
        if (this.page.url() !== startUrl) break;

        const option = await this.nextVisibleOption(tried);
        if (option) {
          tried.add(option.key);
          await this.page.mouse.click(option.x, option.y);
          await this.page.waitForTimeout(600);
          if (await this.groupHasChecked(option.groupClass)) answered++;
          idle = 0;
          continue;
        }

        if (await this.clickForward()) {
          idle = 0;
          await this.page.waitForTimeout(1200);
          continue;
        }

        // После запуска визард отрисовывает следующий шаг примерно через 4 с —
        // поэтому даём до 8 пустых секунд подряд, прежде чем решить, что анкета кончилась.
        idle++;
        if (idle >= 8) break;
        await this.page.waitForTimeout(1000);
      }
    } catch (error) {
      // Последняя кнопка («Finish setup») уводит страницу на следующий экран: контекст
      // текущей страницы уничтожается. Это не ошибка прохода, а его конец.
      if (!/Execution context was destroyed|navigation/i.test((error as Error).message)) throw error;
    }

    return answered;
  }

  /**
   * Первый видимый в окне неотвеченный вариант. Если ни одного такого нет, а
   * неотвеченный вариант есть ниже экрана, прокручивает к нему и возвращает null —
   * следующий проход увидит его уже в окне.
   */
  private async nextVisibleOption(tried: Set<string>): Promise<{ key: string; groupClass: string; x: number; y: number } | null> {
    return this.page.evaluate((triedKeys: string[]) => {
      const tried = new Set(triedKeys);
      const viewportHeight = window.innerHeight;
      let offscreen: HTMLElement | null = null;

      for (const label of Array.from(document.querySelectorAll<HTMLLabelElement>('.elementor-field-group label'))) {
        const input = (label.querySelector('input') || label.control) as HTMLInputElement | null;
        if (!input || (input.type !== 'radio' && input.type !== 'checkbox')) continue;

        const group = label.closest('.elementor-field-group');
        if (!group) continue;
        const groupClass = (group.className.match(/elementor-field-group-(\S+)/) || [])[1] || '';
        if (Array.from(group.querySelectorAll('input')).some((i) => i.checked)) continue;

        const text = label.innerText.trim();
        const key = `${groupClass}::${text}`;
        if (tried.has(key)) continue;

        const r = label.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.top >= 0 && r.bottom <= viewportHeight) {
          return { key, groupClass, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        offscreen = offscreen ?? label;
      }

      offscreen?.scrollIntoView({ block: 'center' });
      return null;
    }, [...tried]);
  }

  private async groupHasChecked(groupClass: string): Promise<boolean> {
    return this.page.evaluate((cls: string) => {
      // Точное совпадение ключа: 'hear_about' не должен цепляться за 'hear_about_other'.
      const group = Array.from(document.querySelectorAll('.elementor-field-group')).find(
        (g) => (g.className.match(/elementor-field-group-(\S+)/) || [])[1] === cls
      );
      return !!group && Array.from(group.querySelectorAll('input')).some((i) => i.checked);
    }, groupClass);
  }

  private async clickForward(): Promise<boolean> {
    const button = this.page.getByRole('button', { name: QuestionnairePage.FORWARD_BUTTON }).filter({ visible: true }).first();
    if ((await button.count()) === 0) return false;
    if (!(await button.isEnabled().catch(() => false))) return false;

    await button.click({ timeout: 3000 }).catch(() => {});
    return true;
  }
}
