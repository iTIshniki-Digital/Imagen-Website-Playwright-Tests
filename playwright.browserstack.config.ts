import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });

// Отдельный конфиг для реального iPhone через BrowserStack (checklist:
// "iPhone Safari flow"). НЕ смешиваем с основным playwright.config.ts —
// там локальные/CI браузеры, тут реальное устройство в облаке BrowserStack,
// разная инфраструктура и свой лимит платных минут, гонять весь набор из
// 117 тестов сюда не нужно — только то, что осмысленно на живом телефоне.
// Название project ниже должно точно соответствовать browserstack.yml:
// "{browserName}@{deviceName}:{osVersion}@browserstack-mobile"
export default defineConfig({
  testDir: './tests',
  testMatch: ['homepage.spec.ts'],
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: 'https://imagen-ai.com',
    // ИЗВЕСТНЫЙ БЛОКЕР, подтверждено 2026-09-30: реальное подключение к
    // BrowserStack работает (креды верные, доходит до newContext), но
    // падает с "expectedValue of reducedMotion: none does not match
    // providedValue: no-preference". Проверено: не помогает (а) явный
    // reducedMotion тут и на уровне project.use — значение игнорируется,
    // патчится самим SDK (node_modules/browserstack-node-sdk/.../patches.js);
    // (б) обновление browserstack-node-sdk до последней версии (1.71.2);
    // (в) другое устройство/iOS (пробовали iPhone 14/iOS16 — та же ошибка).
    // Похоже на баг/несовместимость самого SDK с @playwright/test 1.63.x,
    // не лечится через конфиг с нашей стороны. Не тратить время на новые
    // попытки без свежей версии SDK или ответа от поддержки BrowserStack.
    reducedMotion: 'no-preference',
  },
  projects: [
    {
      name: 'safari@iPhone 15:17@browserstack-mobile',
      use: { baseURL: 'https://imagen-ai.com', reducedMotion: 'no-preference' },
    },
  ],
});
