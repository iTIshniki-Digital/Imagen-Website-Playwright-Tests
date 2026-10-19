// Две задачи, обе — вещи, которые НЕЛЬЗЯ делать прямо в коде страницы
// (docs/app.js), потому что код страницы читает кто угодно ("View
// source"), а тут нужны настоящие секреты:
//
// 1. exchange_code — обменять одноразовый код от "Sign in with GitHub"
//    на access token. GitHub требует для этого client_secret приложения.
//
// 2. drive_latest — отдать содержимое latest.json с Google Drive, но
//    только тому, у кого есть токен с реальным доступом к репозиторию
//    (проверяем сами, прямым запросом к GitHub с ЕГО токеном). Раньше
//    ключ от Drive лежал прямо в docs/app.js — а значит, кто угодно,
//    читающий исходник страницы (не только залогиненные), мог забрать
//    результаты тестов в обход входа через GitHub. Теперь ключ знает
//    только этот Worker, и каждый запрос проверяется.
//
// Деплой — см. docs/README-setup.md.
//
// Переменные окружения (Settings → Variables and Secrets в Cloudflare):
//   GITHUB_CLIENT_ID          — из настроек OAuth App на GitHub
//   GITHUB_CLIENT_SECRET      — оттуда же, тип Secret
//   ALLOWED_ORIGIN            — https://<откуда отдаётся docs/app.js>, без / на конце
//   GITHUB_OWNER              — владелец репозитория (сейчас iTIshniki-Digital)
//   GITHUB_REPO               — имя репозитория (Imagen-Website-Playwright-Tests)
//   DRIVE_LATEST_JSON_FILE_ID — id файла latest.json на Google Drive
//   DRIVE_API_KEY             — Google Cloud API-ключ, тип Secret

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400, cors);
    }

    if (body && body.action === 'drive_latest') {
      return handleDriveLatest(body, env, cors);
    }
    return handleExchangeCode(body, env, cors); // поведение по умолчанию — назад совместимо с полями {code}
  },
};

async function handleExchangeCode(body, env, cors) {
  const code = body && body.code;
  if (!code || typeof code !== 'string') {
    return json({ error: 'missing_code' }, 400, cors);
  }

  const ghResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const data = await ghResponse.json();
  // data либо {access_token, token_type, scope}, либо {error, error_description} —
  // в обоих случаях просто пересылаем как есть, фронтенд сам разбирает.
  return json(data, ghResponse.status, cors);
}

async function handleDriveLatest(body, env, cors) {
  const token = body && body.token;
  if (!token || typeof token !== 'string') {
    return json({ error: 'missing_token' }, 400, cors);
  }
  if (!env.DRIVE_LATEST_JSON_FILE_ID || !env.DRIVE_API_KEY) {
    return json({ error: 'not_configured' }, 500, cors);
  }

  // Проверяем доступ САМИ, не доверяя фронтенду: тем же токеном дёргаем
  // GitHub и смотрим, видит ли он этим токеном наш репозиторий вообще.
  const repoCheck = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'imagen-qa-oauth-proxy',
    },
  });
  if (!repoCheck.ok) {
    return json({ error: 'forbidden', status: repoCheck.status }, 403, cors);
  }

  const driveUrl =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(env.DRIVE_LATEST_JSON_FILE_ID)}` +
    `?alt=media&key=${encodeURIComponent(env.DRIVE_API_KEY)}`;
  const driveResponse = await fetch(driveUrl);
  if (!driveResponse.ok) {
    return json({ error: 'drive_fetch_failed', status: driveResponse.status }, 502, cors);
  }
  const data = await driveResponse.json();
  return json(data, 200, cors);
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
