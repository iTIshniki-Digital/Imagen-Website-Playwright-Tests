import { Page } from '@playwright/test';

// Сторонние скрипты (аналитика, реклама, чаты) часто шумят в консоли и
// дёргают свои сети независимо от того, сломан сайт или нет. Игнорируем
// известный шум, чтобы тесты не падали из-за чужого кода.
const IGNORED_PATTERNS: RegExp[] = [
  /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|gtag/i,
  /connect\.facebook\.net|facebook\.com\/tr/i,
  /hotjar\.com/i,
  /clarity\.ms/i,
  /doubleclick\.net/i,
  /intercom\.io|intercomcdn\.com/i,
  /hs-scripts\.com|hsforms\.com|hubspot/i,
  /bat\.bing\.com/i,
  /linkedin\.com\/px|snap\.licdn\.com/i,
  /analytics\.tiktok\.com/i,
  /ads-twitter\.com|analytics\.x\.com/i,
  /pinterest\.com\/ct|ct\.pinterest\.com/i,
  /reddit\.com\/rp\.gif|alb\.reddit\.com/i,
];

// Экспортируем — тем же списком фильтруем не только console/network,
// но и другие "шумные" сигналы (например, битые сторонние трекинг-пиксели
// в тесте на broken images).
export function isThirdPartyNoise(text: string): boolean {
  return IGNORED_PATTERNS.some((pattern) => pattern.test(text));
}

export interface PageIssues {
  consoleErrors: string[];
  failedRequests: string[];
}

/**
 * Общий родитель для всех Page Object классов.
 * Хранит инстанс `page` и даёт единое место для сквозной логики
 * (сбор ошибок консоли/сети), которая понадобится всем страницам.
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  /**
   * Вешает слушатели console/network и возвращает объект, который будет
   * наполняться найденными проблемами по ходу теста. Вызывать ДО navigation —
   * иначе пропустим ошибки самой ранней стадии загрузки.
   */
  trackIssues(): PageIssues {
    const issues: PageIssues = { consoleErrors: [], failedRequests: [] };

    this.page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (isThirdPartyNoise(msg.text())) return;
      issues.consoleErrors.push(msg.text());
    });

    this.page.on('pageerror', (error) => {
      // Неотловленные исключения в JS-бандле страницы (не то же самое, что console.error).
      issues.consoleErrors.push(error.message);
    });

    this.page.on('response', (response) => {
      const url = response.url();
      if (isThirdPartyNoise(url)) return;
      if (response.status() >= 400) {
        issues.failedRequests.push(`${response.status()} ${url}`);
      }
    });

    return issues;
  }
}
