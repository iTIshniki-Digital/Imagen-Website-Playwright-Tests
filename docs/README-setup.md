# Imagen QA Runs — веб-приложение, разовая настройка

Настоящее веб-приложение: вход через ваш же GitHub-аккаунт, результаты и
управление прогонами — всё в одном месте. Исходники — `docs/index.html`
+ `docs/app.js`, лежат в этом репозитории, но **хостится страница не на
GitHub Pages, а на Cloudflare Pages** — бесплатный план организации на
GitHub не поддерживает приватные Pages (только публичные репозитории
или платный план), а делать репозиторий публичным нельзя — весь код
клиента станет виден всем в интернете.

Сама же работа с данными всё равно идёт через GitHub: вход, запуск
тестов, баги, история — обычные запросы к GitHub API с вашим токеном.
То, что сама страница лежит на Cloudflare, ничего не меняет в правах
доступа — Google Drive (результаты прогона) тоже отдаёт не сама
страница, а Worker, и только тому, у кого есть настоящий доступ к
репозиторию (это он сам каждый раз проверяет).

Нужно настроить **4 вещи**, один раз, без терминала (кроме пары команд
на последнем шаге, можно и через веб-интерфейс).

## Шаг 1 — Cloudflare Pages (хостинг самой страницы)

1. https://dash.cloudflare.com/ → **Workers & Pages** → **Create
   application** → **Upload your static files** (или "Pages" →
   "Connect to Git", если хотите автодеплой из репозитория — тогда
   Cloudflare сам предложит путь к папке `docs/build output directory`,
   укажите `docs`; но простой способ ниже — просто руками загрузить
   папку).
2. Если "Upload your static files": перетащите в загрузку **оба** файла
   — `docs/index.html` и `docs/app.js` (без самой папки `docs`, то есть
   `index.html` должен лежать в КОРНЕ того, что загружаете).
3. Project name — что-то простое и постоянное, например `imagen-qa-runs`
   (от него зависит адрес).
4. Deploy.
5. Итоговый адрес — вида `https://imagen-qa-runs.pages.dev` — запомните
   его, он нужен на следующих двух шагах.

(Каждый раз, когда `docs/index.html`/`docs/app.js` в репозитории
обновятся — нужно будет так же перезалить их в Cloudflare Pages: либо
руками (Deployments → Create deployment → Upload), либо один раз
настроить автодеплой через "Connect to Git" вместо ручной загрузки.)

## Шаг 2 — GitHub OAuth App (вход через GitHub)

1. https://github.com/settings/applications/new (личные настройки — не
   нужны права админа на репозиторий/организацию).
2. Заполнить:
   - **Application name**: `Imagen QA Runs`
   - **Homepage URL**: адрес со страницы 1 (например `https://imagen-qa-runs.pages.dev`)
   - **Redirect URI** (раньше называлось "Authorization callback URL"):
     тот же адрес, слово в слово.
   - Галочку **"Expire user access tokens"** — снять (иначе вход будет
     работать только ~8 часов, а дальше просить войти заново).
3. Register application.
4. Скопируйте **Client ID** — не секретный, пойдёт в код страницы.
5. **Generate a new client secret** → скопируйте значение — он уйдёт не
   в код, а в Cloudflare Worker на шаге 3.

## Шаг 3 — Cloudflare Worker (вход + чтение результатов с Drive)

Зачем он нужен: две вещи, которые нельзя делать в коде страницы —
GitHub требует client secret только с сервера, а ключ Google Drive
нельзя класть в код страницы (его прочитает кто угодно через "View
source", даже без входа). Worker — маленький бесплатный "сервер" на
Cloudflare, который держит оба секрета и сам проверяет, что запрос
пришёл от реального пользователя с доступом к репозиторию.

1. Workers & Pages → Create → **Create Worker** (не Pages — это второй,
   отдельный тип приложения в том же Cloudflare).
2. Имя — например `imagen-qa-oauth` → Deploy (заготовку сейчас заменим).
3. Edit code → стереть всё → вставить содержимое файла
   `cloudflare-worker/oauth-proxy.js` из этого репозитория → Save and
   deploy.
4. Settings → Variables and Secrets → добавить:
   - `GITHUB_CLIENT_ID` — Client ID из шага 2 (обычная переменная)
   - `GITHUB_CLIENT_SECRET` — секрет из шага 2, тип **Secret**
   - `ALLOWED_ORIGIN` — адрес со страницы 1, например `https://imagen-qa-runs.pages.dev` (без / на конце)
   - `GITHUB_OWNER` — `iTIshniki-Digital`
   - `GITHUB_REPO` — `Imagen-Website-Playwright-Tests`
   - `DRIVE_LATEST_JSON_FILE_ID` — id файла `latest.json` на Google Drive
     (см. `scripts/README-qa-dashboard.md`, раздел про
     `GDRIVE_LATEST_JSON_FILE_ID` — тот же id)
   - `DRIVE_API_KEY` — ключ из шага 4 ниже, тип **Secret**
   Save and deploy.
5. Скопируйте адрес воркера — вида `https://imagen-qa-oauth.<субдомен>.workers.dev`.

## Шаг 4 — Google Drive API-ключ

1. https://console.cloud.google.com/apis/credentials → тот же проект,
   что уже использовался для отчётов.
2. Если ключа ещё нет: Create Credentials → **API key** → в появившемся
   окне **API restrictions** → выбрать Google Drive API. Application
   restrictions можно оставить **None** — этот ключ теперь живёт только
   внутри Worker'а (шаг 3), в код страницы не попадает и браузером
   никогда не используется напрямую, так что ограничение по сайту ему
   не нужно.
3. Скопируйте ключ, вставьте в Worker как `DRIVE_API_KEY` (шаг 3.4).

## Шаг 5 — Вписать значения в код страницы

1. Откройте `docs/app.js`, самое начало (блок `CONFIG`), впишите:
   ```js
   var GITHUB_CLIENT_ID = "...";  // шаг 2.4
   var WORKER_URL = "https://....workers.dev"; // шаг 3.5
   ```
   (Drive-ключ и id файла сюда НЕ идут — они теперь только в Worker'е.)
2. Commit, push в `main`.
3. Залейте обновлённые `docs/index.html` + `docs/app.js` в Cloudflare
   Pages (см. конец шага 1 — Deployments → Create deployment → Upload,
   если без автодеплоя).
4. Откройте адрес со страницы 1 — должна появиться кнопка "Sign in with
   GitHub".

Готово — дальше это уже настоящее приложение: форма, запуск, прогресс,
результаты, баги, история, всё на одной странице.

## Если что-то не работает

- **"Sign-in failed (state mismatch)"** — обычно открыли ссылку входа в
  новой вкладке поверх старой попытки; нажмите "Sign in" заново.
- **Страница после входа говорит "no access to repo"** — у аккаунта,
  которым вошли, нет доступа к `iTIshniki-Digital/Imagen-Website-Playwright-Tests`.
- **"Start run" пишет про 403** — тот же случай, доступа мало для
  запуска (нужен хотя бы Write).
- **Latest Run — "Couldn't load the latest run"** — проверьте, что в
  Worker'е заполнены `DRIVE_LATEST_JSON_FILE_ID`/`DRIVE_API_KEY`/
  `GITHUB_OWNER`/`GITHUB_REPO`, и что файл `latest.json` хоть раз
  перезаписывался CI (т.е. был хотя бы один прогон через новый pipeline).
