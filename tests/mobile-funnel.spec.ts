import { devices, expect, test as base } from '@playwright/test';
import { MobileOnboardingPage } from '../pages/MobileOnboardingPage';
import { TEST_EMAIL } from '../pages/testData';

// checklist #17 / #18 / #19 — мобильная воронка. Эмуляция iPhone 13 в обычных
// браузерах. Реальное устройство проверяется отдельно в browserstack/.
//
// Сайт пересобран на Astro 2026-10 — промо-попапа на сайте больше нет
// (разведка 2026-10-27), поэтому его закрытие убрано из обоих тестов.
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
  test('the mobile hero reaches onboarding in one tap', async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await page.goto('/', { waitUntil: 'load' });

    const onboarding = new MobileOnboardingPage(page);
    const taps = await onboarding.tapHeroUntilOnboarding(3);
    testInfo.annotations.push({ type: 'hero-taps-to-onboarding', description: String(taps) });

    expect(taps, 'The hero button should lead to /q/ with a single tap.').toBe(1);
  });

  test('onboarding completes and points the visitor to email, not a phone download', async ({ page }, testInfo) => {
    // Онбординг — ~13 экранов с паузами на отрисовку, за 30с не укладывается.
    test.setTimeout(150000);
    await page.goto('/', { waitUntil: 'load' });

    const onboarding = new MobileOnboardingPage(page);
    await onboarding.tapHeroUntilOnboarding(3);
    await onboarding.walkToEmailScreen();

    testInfo.annotations.push({ type: 'onboarding-answers', description: String(onboarding.answered) });
    expect(onboarding.answered, 'Onboarding should ask at least 5 multiple-choice questions').toBeGreaterThanOrEqual(5);

    const { consentPreChecked } = await onboarding.submitEmail(TEST_EMAIL);
    testInfo.annotations.push({ type: 'consent-checkbox-pre-checked', description: String(consentPreChecked) });

    await expect(
      page.getByText(/check your email on desktop/i),
      'No "Check your email on desktop" confirmation after submitting email on the mobile funnel'
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(/download (for )?(mac|pc|windows)/i),
      'There should be no app-download buttons on a mobile phone'
    ).toHaveCount(0);
  });
});
