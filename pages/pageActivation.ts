import { Page } from '@playwright/test';

// WP Rocket откладывает выполнение JS Elementor до первого реального действия
// пользователя (движение курсора / колесо мыши). Подтверждено вживую 2026-10-05
// на /business/ (карусели), /video/questionnaire-2/ (анкета) и на мобильной
// hero-кнопке. Программный scrollIntoView этим действием не считается: до
// колеса `elementorFrontend` не определён, визард анкеты не запущен, карусели не
// инициализируются, и клики по вариантам ничего не меняют.
//
// Поэтому перед работой с виджетом тест ведёт себя как посетитель: двигает
// курсор и прокручивает колесом, а затем ждёт, пока Elementor поднимется.
export async function wakeUpPageScripts(page: Page, timeout = 15000): Promise<void> {
  await page.mouse.move(300, 300);
  await page.mouse.wheel(0, 150);
  await page.waitForFunction(
    () => typeof (window as unknown as { elementorFrontend?: unknown }).elementorFrontend === 'object',
    null,
    { timeout }
  );
  await page.mouse.wheel(0, -150);
  await page.waitForTimeout(300);
}
