import { devices, expect, test as base } from '@playwright/test';
import { MobileOnboardingPage } from '../pages/MobileOnboardingPage';
import { TEST_EMAIL } from '../pages/testData';

// checklist #17 / #18 / #19 — мобильная воронка. Эмуляция iPhone 13 в обычных
// браузерах. Реальное устройство проверяется отдельно в browserstack/.
// Перед тапом по hero закрывается промо-попап Elementor (см. pages/MobileOnboardingPage.ts).
//
// Мобильный тест идёт через фикстуру без page.route (как и в тестах цен):
// перехват запросов меняет поведение страницы (см. pricing-rendered.spec.ts),
// поэтому здесь он не нужен и не включён.

const test = base.extend({});
test.use({
  ...devices['iPhone 13'],
  baseURL: 'https://imagen-ai.com',
  extraHTTPHeaders: process.env.E2E_BYPASS_TOKEN ? { 'x-e2e-bypass': process.env.E2E_BYPASS_TOKEN } : {},
});

test.describe('Mobile funnel (iPhone 13 emulation)', () => {
  test('the mobile hero reaches onboarding in one tap once the promo popup is closed', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'load' });

    const onboarding = new MobileOnboardingPage(page);
    const popupClosed = await onboarding.closePromoPopupIfShown();
    testInfo.annotations.push({ type: 'promo-popup-shown-on-load', description: String(popupClosed) });

    const taps = await onboarding.tapHeroUntilOnboarding(3);
    testInfo.annotations.push({ type: 'hero-taps-to-onboarding', description: String(taps) });

    expect(
      taps,
      'После закрытия промо-попапа hero-кнопка должна вести на /q/ с одного тапа. Если нет — что-то по-прежнему перекрывает её.'
    ).toBe(1);
  });

  test('onboarding completes and points the visitor to email, not a phone download', async ({ page }, testInfo) => {
    // Онбординг — ~14 экранов с паузами на отрисовку, за 30с не укладывается.
    test.setTimeout(150000);
    await page.goto('/', { waitUntil: 'load' });

    const onboarding = new MobileOnboardingPage(page);
    await onboarding.closePromoPopupIfShown();
    await onboarding.tapHeroUntilOnboarding(3);
    await onboarding.walkToEmailScreen();

    testInfo.annotations.push({ type: 'onboarding-answers', description: String(onboarding.answered) });
    expect(onboarding.answered, 'Онбординг должен задать хотя бы 5 вопросов с вариантами ответа').toBeGreaterThanOrEqual(5);

    const { consentPreChecked } = await onboarding.submitEmail(TEST_EMAIL);
    testInfo.annotations.push({ type: 'consent-checkbox-pre-checked', description: String(consentPreChecked) });

    await expect(
      page.getByText(/check your email on desktop/i),
      'После отправки email на мобильной воронке не показан экран «Check your email on desktop»'
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(TEST_EMAIL),
      'Экран «Check your email» не показывает введённый адрес'
    ).toBeVisible();
    await expect(
      page.getByText(/download (for )?(mac|pc|windows)/i),
      'На мобильном телефоне не должно быть кнопок скачивания приложения'
    ).toHaveCount(0);
  });
});
