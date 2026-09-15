import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import dotenv from 'dotenv';
import path from 'path';
// quiet: true — у dotenv v17 в консоль по умолчанию летит рандомная
// самореклама сторонних продуктов автора пакета при каждом запуске (см.
// node_modules/dotenv/lib/main.js) — не нужно засорять этим логи CI.
dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });

if (!process.env.E2E_BYPASS_TOKEN) {
  // Без этого токена Cloudflare на стороне клиента вернёт 403 почти на
  // каждый запрос (см. правило x-e2e-bypass в Cloudflare WAF). Локально —
  // положите значение в .env (см. .env.example), в CI — в GitHub Secrets.
  console.warn('[playwright.config] E2E_BYPASS_TOKEN не задан — запросы к сайту, скорее всего, будут блокироваться Cloudflare.');
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  // 'line' печатает результат каждого теста СРАЗУ по завершении — в логах
  // GitHub Actions это критично для диагностики: default-репортер там
  // буферизует прогресс одним куском ближе к концу прогона, из-за чего
  // непонятно, что происходит, пока весь job не закончится.
  reporter: process.env.CI ? [['html'], ['line']] : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: 'https://imagen-ai.com',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Cloudflare bypass-заголовок добавляется НЕ здесь (extraHTTPHeaders
     * улетел бы на все домены, включая сторонние API самого сайта, и ломал
     * бы им CORS), а точечно — только на запросы к доменам клиента — через
     * кастомный fixture в tests/fixtures.ts (page.route + фильтр по хосту). */
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
