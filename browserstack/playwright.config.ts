import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

// Почему эта папка отдельная и на Playwright 1.49.1, а не 1.63 основного набора:
// Playwright 1.63 при создании контекста всегда шлёт reducedMotion
// ("no-preference") — даже если в конфиге его не задавать, — а BrowserStack
// для iPhone ждёт "none", которого Playwright отправить не может. Сессия
// падает на newContext. В 1.49.1 этого поля по умолчанию нет — проверено
// вживую 2026-10-05: тест стартует на реальном iPhone 15 / iOS 17.
//
// Имя project должно совпадать с тем, что SDK выводит из browserstack.yml
// (проверено: "safari-iPhone 15:17-browserstack-mobile").
export default defineConfig({
  testDir: './tests',
  timeout: 180000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'https://imagen-ai.com',
  },
  projects: [
    {
      name: 'safari-iPhone 15:17-browserstack-mobile',
    },
  ],
});
