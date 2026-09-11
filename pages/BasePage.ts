import { Page } from '@playwright/test';

/**
 * Общий родитель для всех Page Object классов.
 * Хранит инстанс `page` и даёт единое место для сквозной логики
 * (например, сбор ошибок консоли), которая понадобится всем страницам.
 */
export class BasePage {
  constructor(protected readonly page: Page) {}
}
