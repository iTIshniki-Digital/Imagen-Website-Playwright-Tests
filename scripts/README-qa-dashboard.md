# QA Dashboard — разовая настройка

Дашборд: https://claude.ai/artifact/4vmBWLsZUtj8W7GTcpCQje ("Imagen QA Runs")

Он не умеет сам найти свежий файл на Google Drive — вместо этого CI каждый
прогон перезаписывает ОДИН и тот же файл `latest.json`, а дашборд читает его
по фиксированному id через Drive API. Поэтому нужно один раз создать этот
файл и сообщить его id и CI, и дашборду. Всего 4 значения, все вводятся в
вебе, без терминала.

## 1. Создать фиксированный файл latest.json на Drive

1. Откройте ту же папку Google Drive, куда уже падают отчёты (куда
   указывает секрет `GDRIVE_FOLDER_ID` в GitHub — это тот же аккаунт/папка,
   что для `scripts/upload-report-to-drive.js`).
2. Создайте в ней пустой текстовый файл с содержимым `{}` и назовите его
   `latest.json` (Google Drive → New → File upload, или New → Google
   Docs → переименовать и экспортировать — главное, чтобы в папке лежал
   файл с любым валидным JSON-содержимым; CI полностью перезапишет его
   при первом прогоне).
3. Откройте файл, скопируйте его id из адресной строки:
   `https://drive.google.com/file/d/`**`ВОТ_ЭТОТ_ID`**`/view`.
4. GitHub → репозиторий → Settings → Secrets and variables → Actions →
   New repository secret → имя `GDRIVE_LATEST_JSON_FILE_ID`, значение —
   этот id.

После этого шага CI начнёт публиковать результаты каждого прогона в этот
файл (см. `scripts/publish-qa-dashboard-run.js`) — сам прогон тестов при
этом ничего не ломает, даже если что-то тут настроено неверно
(`continue-on-error: true` в воркфлоу).

## 2. Создать Drive API-ключ только на чтение

Дашборд — страница в браузере, у неё нет доступа к тем же GitHub-секретам,
что у CI. Чтобы прочитать `latest.json`, ей нужен отдельный, ограниченный
ключ:

1. [Google Cloud Console](https://console.cloud.google.com/) → тот же
   проект, что уже используется для OAuth-токена отчётов (там же, где
   выписывались `GDRIVE_CLIENT_ID`/`GDRIVE_CLIENT_SECRET`).
2. APIs & Services → Library → найдите **Google Drive API** → Enable
   (если ещё не включено).
3. APIs & Services → Credentials → Create Credentials → API key.
4. Сразу ограничьте ключ (Edit API key):
   - **API restrictions** → Restrict key → только Google Drive API.
   - **Application restrictions** → HTTP referrers → добавьте
     `https://claude.ai/*`.
5. Скопируйте ключ.

Это ключ только на ЧТЕНИЕ публичных файлов Drive API (сам файл
`latest.json` должен быть расшарен как "Anyone with the link" — скрипт
`publish-qa-dashboard-run.js` делает это сам при каждой публикации) — он
не даёт доступа ни к чему приватному в аккаунте.

## 3. Собрать и загрузить плагин WordPress (если ещё не обновлён)

Плагин `wordpress-plugin/imagen-qa-test-runner.php` версии 1.2.0 добавляет
отдельный REST-вход для дашборда (без логина в WordPress, по ключу). Если
на сайте ещё стоит более старая версия — загрузите новый zip (см. в конце
сообщения, где его взять) через Plugins → Add New → Upload Plugin →
Replace current with uploaded.

После обновления откройте WordPress admin → Settings → Imagen QA Runner —
там появился новый блок **"QA Dashboard access"** с двумя значениями:
**Endpoint URL** и **Dashboard key**.

## 4. Вставить все 4 значения в сам дашборд

Откройте дашборд → вкладка **Run Tests** → карточка **Dashboard settings**
внизу страницы, впишите:

| Поле в дашборде | Откуда взять |
|---|---|
| WordPress REST endpoint | Settings → Imagen QA Runner → "Endpoint URL" |
| Dashboard key | Settings → Imagen QA Runner → "Dashboard key" |
| Google Drive file ID (latest.json) | id из шага 1 |
| Google API key (Drive, read-only) | ключ из шага 2 |

Save settings — всё хранится в данных самого артефакта, не в коде
страницы, так что при смене ключа (например, после "Regenerate key" в
WordPress) достаточно поправить значение тут же, без обращения ко мне.

## Дальше само

- **Start run** (вкладка Run Tests) — запускает прогон через тот же
  GitHub Actions workflow, что и форма на сайте.
- **Sync from Drive** (кнопка в шапке) — подтягивает последний
  опубликованный прогон и раскладывает его по категориям; падающие
  проверки сами попадают во вкладку **Open Bugs**, а при следующем
  успешном прогоне, где та же проверка прошла, помечаются как fixed
  автоматически.
- Категории — это категории ручного чек-листа клиента (дашборд
  `marketing-server/services/qa-dashboard`), слово в слово: тот же список
  должен совпадать в трёх местах — `scripts/qa-dashboard-categories.js`,
  `wordpress-plugin/imagen-qa-test-runner.php` (`imagen_qa_scopes`) и в
  самом дашборде (константа `CATEGORIES` в его HTML). Поменяли один —
  поменяйте все три.
