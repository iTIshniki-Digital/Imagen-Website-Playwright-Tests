# Imagen QA Runs — веб-приложение, разовая настройка

Это настоящее веб-приложение (не Issues, не claude.ai): страница на
GitHub Pages, вход через ваш же GitHub-аккаунт, результаты и управление
прогонами — всё в одном месте. Исходники — `docs/index.html` +
`docs/app.js`, лежат в этом же репозитории.

Доступ к данным — ровно тот, что уже есть у вошедшего в GitHub-аккаунт:
страница ничего не хранит и не обходит права репозитория, она просто
делает те же запросы к GitHub API, что сделали бы вы сами.

Нужно настроить **4 вещи**, один раз. Каждая — несколько кликов, без
терминала (кроме деплоя Worker'а — тоже через веб-интерфейс Cloudflare,
но можно и через `wrangler`, на ваш выбор).

## Шаг 1 — GitHub OAuth App (вход через GitHub)

1. https://github.com/settings/applications/new (это в ваших личных
   настройках — прав админа организации не требует).
2. Заполнить:
   - **Application name**: `Imagen QA Runs`
   - **Homepage URL**: `https://itishniki-digital.github.io/Imagen-Website-Playwright-Tests/`
   - **Authorization callback URL**: та же самая ссылка, слово в слово —
     `https://itishniki-digital.github.io/Imagen-Website-Playwright-Tests/`
3. Register application.
4. Скопируйте **Client ID** — он не секретный, пойдёт в код страницы.
5. **Generate a new client secret** → скопируйте значение (показывается
   один раз) — он уйдёт не в код, а в Cloudflare Worker на шаге 2.

## Шаг 2 — Cloudflare Worker (обмен кода на токен входа)

Зачем он вообще нужен: GitHub требует, чтобы client secret использовался
только с сервера, никогда в коде страницы в браузере. Worker — это и
есть тот самый маленький "сервер", только бесплатный и без поддержки
инфраструктуры с нашей стороны.

1. https://dash.cloudflare.com/ → зарегистрироваться (если ещё нет
   аккаунта — бесплатно, без карты для этого объёма).
2. Workers & Pages → Create → Create Worker.
3. Назовите как угодно (например `imagen-qa-oauth`) → Deploy (с
   заготовкой — её сейчас заменим).
4. Edit code (или "Quick edit") → стереть всё → вставить содержимое
   файла `cloudflare-worker/oauth-proxy.js` из этого репозитория → Save
   and deploy.
5. Settings → Variables and Secrets → Add:
   - `GITHUB_CLIENT_ID` — Client ID из шага 1 (можно как обычную переменную)
   - `GITHUB_CLIENT_SECRET` — тот самый секрет из шага 1, тип **Secret**
   - `ALLOWED_ORIGIN` — `https://itishniki-digital.github.io`
   Save and deploy.
6. Скопируйте адрес воркера сверху страницы — вида
   `https://imagen-qa-oauth.<ваш-субдомен>.workers.dev`.

## Шаг 3 — Google Drive API-ключ (чтение результатов прогона)

Тот же файл `latest.json`, что CI уже обновляет на каждый прогон (см.
`scripts/README-qa-dashboard.md`, раздел про `GDRIVE_LATEST_JSON_FILE_ID`
— если ещё не создавали этот файл и секрет, сделайте сначала это).

1. https://console.cloud.google.com/ → тот же проект, что уже
   использовался для OAuth-токена отчётов (там же выписывались
   `GDRIVE_CLIENT_ID`/`GDRIVE_CLIENT_SECRET`).
2. APIs & Services → Library → **Google Drive API** → Enable (если ещё
   не включено).
3. APIs & Services → Credentials → Create Credentials → **API key**.
4. Edit the key:
   - API restrictions → Restrict key → только Google Drive API.
   - Application restrictions → HTTP referrers → добавить
     `https://itishniki-digital.github.io/*`.
5. Скопируйте ключ.

## Шаг 4 — Вписать все значения в код и включить Pages

1. Откройте `docs/app.js` в этом репозитории, самое начало файла
   (блок `CONFIG`), впишите:
   ```js
   var GITHUB_CLIENT_ID = "...";           // шаг 1.4
   var WORKER_URL = "https://....workers.dev"; // шаг 2.6
   var DRIVE_LATEST_JSON_FILE_ID = "...";  // id файла latest.json на Drive
   var DRIVE_API_KEY = "...";              // шаг 3.5
   ```
2. Commit, push в `main`.
3. GitHub → репозиторий → **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: **main**, папка **/docs** → Save.
4. Через минуту-две откройте
   `https://itishniki-digital.github.io/Imagen-Website-Playwright-Tests/`
   — должна появиться кнопка "Sign in with GitHub".

Готово — дальше это уже настоящее приложение: форма, запуск, прогресс,
результаты, баги, история, всё на одной странице.

## Если что-то не работает

- **"Sign-in failed (state mismatch)"** — обычно открыли ссылку входа в
  новой вкладке поверх старой попытки; просто нажмите "Sign in" заново.
- **Страница после входа говорит "no access to repo"** — у аккаунта,
  которым вошли, нет доступа к `iTIshniki-Digital/Imagen-Website-Playwright-Tests`;
  нужен обычный доступ коллаборатора (см. `scripts/README-qa-dashboard.md`).
- **"Start run" пишет про 403** — тот же случай, доступа мало для
  запуска (нужен хотя бы Write).
- **Latest Run — "Drive isn't configured"** — не заполнен шаг 3/4 выше,
  либо файл `latest.json` ещё ни разу не перезаписывался CI (прогонов
  через новый pipeline ещё не было).
