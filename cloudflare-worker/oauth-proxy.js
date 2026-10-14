// Единственная задача этого Worker'а — обменять одноразовый код, который
// GitHub присылает после входа ("Sign in with GitHub"), на настоящий
// access token. Этот обмен ОБЯЗАТЕЛЬНО должен идти с сервера: GitHub
// требует client_secret приложения, а секрет нельзя класть в JS статичной
// страницы (его увидит любой через просмотр кода страницы). Сам Worker
// никаких данных не хранит и не читает — только пересылает один запрос
// и возвращает ответ. Токен дальше живёт только в браузере пользователя.
//
// Деплой — см. cloudflare-worker/README.md.
//
// Переменные окружения (Settings → Variables and Secrets в Cloudflare):
//   GITHUB_CLIENT_ID      — из настроек OAuth App на GitHub
//   GITHUB_CLIENT_SECRET  — оттуда же, Secret (шифруется Cloudflare)
//   ALLOWED_ORIGIN         — https://<org>.github.io (без слэша на конце) —
//     единственный источник, которому разрешено дёргать этот Worker.

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
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid_json' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const code = body && body.code;
    if (!code || typeof code !== 'string') {
      return new Response(JSON.stringify({ error: 'missing_code' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
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
    return new Response(JSON.stringify(data), {
      status: ghResponse.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
