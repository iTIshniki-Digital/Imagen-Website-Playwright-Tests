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
//
// Десктопный Mac Safari (checklist #21) проверен вживую 2026-10-01 и
// НЕВОЗМОЖЕН через этот SDK в принципе — не "другой, более старый
// механизм", как предполагалось раньше, а чётко подтверждено: добавление
// в browserstack.yml второй платформы (browserName: safari, os: OS X,
// osVersion: Sonoma) и запуск дали прямую ошибку от самого BrowserStack —
// `browserType.connect: Error: Invalid 'browser'. Use 'chrome', 'edge',
// 'playwright-chromium', 'playwright-webkit' or 'playwright-firefox'
// only` — то есть их Playwright-connect эндпоинт для ДЕСКТОПА в принципе
// не отдаёт настоящий Safari.app, только Chrome/Edge/движки самого
// Playwright (safari здесь работает только для МОБИЛЬНЫХ устройств, как
// у нас и настроено). `playwright-webkit` на macOS-машине BrowserStack —
// единственный близкий вариант, но это тот же движок WebKit, что уже
// гоняется локально/в CI, просто на другой ОС под капотом — не похоже на
// осмысленное дополнительное покрытие ради своей цены/сложности. Для
// настоящего десктопного Safari нужен их отдельный продукт на базе
// Selenium/WebDriver ("Automate"), а не этот Playwright-SDK — отдельная
// интеграция, не доделанная (и, вероятно, не стоящая усилий сейчас).
export default defineConfig({
  testDir: './tests',
  testMatch: ['homepage.spec.ts'],
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: 'https://imagen-ai.com',
    // grep в node_modules/playwright-core подтвердил: валидные значения
    // reducedMotion — 'reduce' | 'no-preference' | 'no-override' ("none"
    // из ошибки BrowserStack — это их термин, не playwright-овский).
    // 'no-override' буквально значит "не переопределять" — похоже, именно
    // это и ждёт BrowserStack, а не 'no-preference' (которое пробовали
    // раньше и которое, видимо, Playwright 1.63 шлёт по умолчанию).
    reducedMotion: 'no-override',
  },
  projects: [
    {
      name: 'safari@iPhone 15:17@browserstack-mobile',
      use: { baseURL: 'https://imagen-ai.com', reducedMotion: 'no-override' },
    },
  ],
});
