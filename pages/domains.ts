// Домены клиента (imagen-ai.com и его поддомены). Используется и для
// фильтрации ссылок в NavigationPage, и для того, чтобы не отправлять
// служебные заголовки (например, Cloudflare bypass) на сторонние домены.
export const FIRST_PARTY_HOSTS = [
  'imagen-ai.com',
  'account.imagen-ai.com',
  'support.imagen-ai.com',
  'api-docs.imagen-ai.com',
];

export function isFirstPartyUrl(href: string): boolean {
  try {
    const host = new URL(href, 'https://imagen-ai.com').host;
    return FIRST_PARTY_HOSTS.some((firstPartyHost) => host === firstPartyHost || host.endsWith(`.${firstPartyHost}`));
  } catch {
    return false;
  }
}
