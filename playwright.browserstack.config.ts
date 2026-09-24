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
  },
  projects: [
    {
      name: 'safari@iPhone 15:17@browserstack-mobile',
      use: { baseURL: 'https://imagen-ai.com' },
    },
  ],
});
