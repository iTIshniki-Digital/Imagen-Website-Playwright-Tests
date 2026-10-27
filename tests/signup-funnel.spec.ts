import { test, expect } from './fixtures';
import { HomePage } from '../pages/HomePage';
import { StepTwoPage } from '../pages/StepTwoPage';

test.describe('Signup funnel', () => {
  // Один сквозной тест вместо нескольких мелких — каждый прогон этого
  // теста создаёт реальную запись в CRM клиента (см. TEST_EMAIL), лишний
  // раз плодить такие тесты не стоит.
  test('hero CTA -> step-2 form -> lands on the photo quiz', async ({ page }) => {
    const homePage = new HomePage(page);
    const stepTwoPage = new StepTwoPage(page);

    await homePage.goto();
    await homePage.continueToStepTwo();
    await expect(page).toHaveURL(/\/step-2\/?/);

    // Новый сайт (Astro, разведка 2026-10-27): hero-форма отправляется
    // обычным GET (не AJAX), то есть переход на /step-2/ сам по себе уже
    // полная загрузка страницы — лишний page.reload(), нужный раньше для
    // Elementor-формы, тут не требуется и больше не используется.
    await stepTwoPage.fillAndSubmit('Playwright', 'QA');

    // Ещё один подтверждённый вживую A/B-тест: редирект после step-2 ведёт
    // то на /photo-quiz/, то на /questionnaire/ — тот же квиз-виджет под
    // двумя разными URL и даже разными темами оформления. Принимаем оба,
    // не привязываемся к приветственному тексту — он не универсален.
    await expect(page, 'After step-2 we should land on the quiz').toHaveURL(/\/(photo-quiz|questionnaire)\//, { timeout: 15000 });

    // Дальше в квиз намеренно не идём. Подтверждено вживую 2026-09-30: у
    // виджета не просто разное оформление между заходами, а РАЗНАЯ
    // разметка — один вариант использует .q-title/.answer (см.
    // pages/PhotoQuizPage.ts), в другом (тёмная тема с кнопками
    // Previous/Continue) тот же вопрос виден на экране, но .q-title его
    // не находит — то есть там другой класс/структура. Пытаться собрать
    // селекторы под каждый вариант — большая отдельная задача, не быстрый
    // фикс. Граница, которую можно утверждать надёжно: воронка hero ->
    // step-2 -> квиз реально доводит до квиза, вне зависимости от того,
    // какой вариант оформления/URL достался в этот раз.
  });
});
