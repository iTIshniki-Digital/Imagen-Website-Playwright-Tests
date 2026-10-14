# QA — запуск тестов и результаты через GitHub

Всё живёт в самом репозитории — никакого стороннего сайта. Форма на
сайте (wordpress-plugin/) и дашборд на claude.ai из этой схемы выведены
(подробности в самом низу).

## Основной способ — веб-приложение (GitHub Pages)

**https://itishnikidigital.github.io/Imagen-Website-Playwright-Tests/**

Настоящее веб-приложение: вход через GitHub, форма запуска, прогресс,
результаты по категориям, баги, история — одна страница. Исходники —
`docs/index.html` + `docs/app.js`. Разовая настройка (OAuth App,
Cloudflare Worker, Drive API-ключ) — **`docs/README-setup.md`**, это
отдельная инструкция, начните с неё.

## Запасной способ — GitHub Issue Form (без настройки, работает всегда)

Если приложение выше ещё не настроено или просто неудобно открывать:

1. **Issues → New issue → шаблон "QA test run"** — форма с чекбоксами
   браузеров/категорий (ничего не отмечено = полный набор), полем
   фильтра, полем cookies. Описание шаблона —
   `.github/ISSUE_TEMPLATE/qa-run.yml`.
2. Submit new issue.
3. `.github/workflows/qa-issue-trigger.yml` ловит открытие issue,
   `.github/scripts/handle-qa-run-issue.js` разбирает ответы формы (тот
   же белый список браузеров/путей/фильтра, что везде) и запускает
   `playwright.yml`. Если что-то не так — комментирует issue причиной,
   ничего не падает молча.

## Что происходит после запуска (общее для обоих способов)

`scripts/sync-qa-github-issues.js` (шаг в `playwright.yml`) по
завершении прогона:
- если запуск был через issue — комментирует туда итог и закрывает его;
- заводит/обновляет issue с лейблом `qa-bug` на каждую упавшую проверку
  (скриншот и видео — прямо в теле issue); когда проверка снова проходит
  — закрывает issue автоматически с комментарием "Fixed";
- пишет сводку по категориям прямо на страницу прогона (Job Summary,
  вкладка Actions → этот прогон);
- публикует `latest.json` + скриншоты/видео на Google Drive
  (`scripts/publish-qa-dashboard-run.js`) — это и читает вкладка "Latest
  Run" веб-приложения.

## 0. Права записи для GitHub Actions (обязательно, один раз)

Оба workflow заводят/комментируют/закрывают issues и один из них
запускает другой — для этого токену нужны права на запись.

Сейчас это решено через **personal access token в секрете
`QA_BOT_TOKEN`** (создан 2026-10-14) — обходит нехватку админских прав
на репозиторий/организацию:

- PAT создан в личных настройках аккаунта
  (`https://github.com/settings/tokens/new`, scope `repo`) —
  это НЕ требует роли Admin на репозитории.
- Положен как обычный repository secret: Settings → Secrets and
  variables → Actions → `QA_BOT_TOKEN`.
- Оба workflow сначала пробуют его, и только если не задан — встроенный
  `GITHUB_TOKEN` (`secrets.QA_BOT_TOKEN || secrets.GITHUB_TOKEN`).

Если токен истечёт — Actions начнёт падать на шагах с issues с ошибкой
авторизации; чинится так же — новый PAT, обновить значение секрета.

(Альтернатива, если когда-нибудь появится Admin/Owner доступ: Repository
→ Settings → Actions → General → Workflow permissions → "Read and write
permissions" → Save, и тогда секрет `QA_BOT_TOKEN` можно удалить —
фолбэк на встроенный токен сработает сам.)

## 1. Создать фиксированный файл latest.json на Drive

Нужно и веб-приложению (вкладка "Latest Run"), и — опционально — старому
дашборду на claude.ai. Issue Form/issues работают без этого файла.

1. Откройте ту же папку Google Drive, куда уже падают отчёты (куда
   указывает секрет `GDRIVE_FOLDER_ID` в GitHub).
2. Создайте в ней пустой файл с содержимым `{}`, назовите `latest.json`.
3. Скопируйте его id из адресной строки:
   `https://drive.google.com/file/d/`**`ВОТ_ЭТОТ_ID`**`/view`.
4. GitHub → репозиторий → Settings → Secrets and variables → Actions →
   New repository secret → имя `GDRIVE_LATEST_JSON_FILE_ID`, значение —
   этот id.
5. Тот же id нужен в `docs/app.js` (`DRIVE_LATEST_JSON_FILE_ID`) — см.
   `docs/README-setup.md`, шаг 4.

## Поддерживать категории в соответствии

Категории — категории ручного чек-листа клиента (дашборд
`marketing-server/services/qa-dashboard`), слово в слово. Список должен
совпадать в ПЯТИ местах — поменяли один, поменяйте все:
- `scripts/qa-dashboard-categories.js`
- `docs/app.js` (константа `CATEGORIES`)
- `.github/ISSUE_TEMPLATE/qa-run.yml` (чекбоксы "What to check")
- `wordpress-plugin/imagen-qa-test-runner.php` (`imagen_qa_scopes`,
  сейчас не используется для запуска, но держим на всякий случай)
- бывший claude.ai дашборд (не актуально, он выведен из процесса)

## Что выведено из процесса (не удалено, просто не используется)

- **Форма на сайте** (`wordpress-plugin/`) — можно деактивировать на
  сайте, когда будет удобно; код и REST-эндпоинт оставлены рабочими.
- **Дашборд на claude.ai**
  (https://claude.ai/artifact/4vmBWLsZUtj8W7GTcpCQje, "Imagen QA Runs") —
  по решению от 2026-10-14 весь рабочий процесс переведён на GitHub,
  чтобы не завязывать его на личный аккаунт Claude. Страница помечена
  баннером как отключённая, но не удалена. Если когда-нибудь снова
  понадобится — попросите Claude "синхронизируй дашборд", он заберёт
  `latest.json` и скриншоты/видео с Google Drive и запишет в него (через
  `scripts/fetch-qa-dashboard-run.js` + `assets`/`write_db` самого
  Artifact-инструмента — подробности были расписаны раньше в этом же
  файле, в истории git).
