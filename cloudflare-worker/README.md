# OAuth proxy — Cloudflare Worker

Деплой и настройка — см. `docs/README-setup.md`, шаг 2.

`oauth-proxy.js` — весь код. Единственная задача: принять одноразовый
`code` от GitHub OAuth и обменять его на access token, используя
`GITHUB_CLIENT_SECRET` (секрет, который нельзя класть в код страницы
`docs/app.js` — он публичный, его видит любой через "View source").
