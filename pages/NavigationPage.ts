import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

// Первая сторона — то, за что отвечает клиент. Внешние ссылки (соцсети и т.п.)
// не проверяем: их доступность вне зоны ответственности этого сайта.
const FIRST_PARTY_HOSTS = ['imagen-ai.com', 'account.imagen-ai.com', 'support.imagen-ai.com', 'api-docs.imagen-ai.com'];

export interface NavLink {
  text: string;
  href: string;
}

export class NavigationPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Все ссылки в шапке и подвале ТЕКУЩЕЙ страницы. Читаем вживую из DOM,
   * а не из захардкоженного списка — иначе тест устареет при первой же
   * правке навигации в Elementor.
   */
  async getHeaderAndFooterLinks(): Promise<NavLink[]> {
    const rawLinks = await this.page.$$eval('header a[href], footer a[href]', (elements) =>
      elements.map((el) => ({
        text: (el.textContent || '').trim().replace(/\s+/g, ' '),
        href: el.getAttribute('href') || '',
      }))
    );

    const seen = new Set<string>();
    return rawLinks.filter((link) => {
      if (!link.href || link.href.startsWith('#') || link.href.startsWith('javascript:')) return false;
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    });
  }

  isFirstParty(href: string): boolean {
    try {
      const host = new URL(href, 'https://imagen-ai.com').host;
      return FIRST_PARTY_HOSTS.some((firstPartyHost) => host === firstPartyHost || host.endsWith(`.${firstPartyHost}`));
    } catch {
      return false;
    }
  }
}
