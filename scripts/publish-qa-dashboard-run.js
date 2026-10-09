// Читает JSON-отчёт Playwright (см. playwright.config.ts, репортер 'json'),
// группирует результаты по категориям клиентского чек-листа
// (qa-dashboard-categories.js), грузит скриншоты упавших тестов на Google
// Drive и перезаписывает один и тот же файл latest.json на Drive — его
// забирает наш дашборд (claude.ai Artifact) при открытии.
//
// Почему "перезаписывает один и тот же файл", а не создаёт новый каждый
// раз: у Artifact-страницы нет способа найти "последний" файл в папке Drive
// без авторизованного API-ключа с правом listing — проще держать fileId
// фиксированным (создаётся один раз вручную, см. README ниже) и обновлять
// его содержимое через files.update.
//
// Почему именно сюда, а не напрямую в db артефакта: GitHub Actions не может
// вызвать db-API артефакта — туда может писать либо сам Claude (через
// Artifact-инструмент), либо браузер человека, открывшего страницу. Поэтому
// CI публикует результат в заведомо читаемое место (Drive), а дашборд сам
// забирает его при открытии ("sync", см. кнопку в самом дашборде).
//
// Требует переменные окружения:
//   GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN  — те же,
//     что upload-report-to-drive.js
//   GDRIVE_FOLDER_ID            — та же папка, что и у отчётов
//   GDRIVE_LATEST_JSON_FILE_ID  — id ОДНОГО файла на Drive, созданного один
//     раз заранее (см. scripts/README-qa-dashboard.md), который этот скрипт
//     каждый раз перезаписывает. Если не задан — скрипт выходит с кодом 0 и
//     просто предупреждает: не ломаем прогон тестов из-за ещё не
//     настроенного дашборда.
// Необязательные (контекст запуска, подставляются воркфлоу):
//   GITHUB_RUN_ID, GITHUB_RUN_NUMBER, GITHUB_ACTOR, GITHUB_EVENT_NAME,
//   BROWSERS, SPEC_FILES, GREP, RETRIES, REPORT_DRIVE_URL

const fs = require('fs');
const { google } = require('googleapis');
const { categoryForFile, categoryName, UNCATEGORIZED_SLUG } = require('./qa-dashboard-categories');

const RESULTS_JSON = 'playwright-report/results.json';

async function main() {
  const latestFileId = process.env.GDRIVE_LATEST_JSON_FILE_ID;
  if (!latestFileId) {
    console.warn(
      'GDRIVE_LATEST_JSON_FILE_ID не задан — пропускаю публикацию в QA-дашборд (сам прогон тестов это не затрагивает). ' +
        'См. scripts/README-qa-dashboard.md для разовой настройки.'
    );
    return;
  }

  if (!fs.existsSync(RESULTS_JSON)) {
    console.warn(`${RESULTS_JSON} не найден — пропускаю публикацию в QA-дашборд.`);
    return;
  }

  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    console.error('GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET / GDRIVE_REFRESH_TOKEN / GDRIVE_FOLDER_ID не заданы.');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const report = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));
  const run = buildRunSummary(report);

  console.log(
    `Разобрано: ${run.totals.passed} passed, ${run.totals.failed} failed, ${run.totals.skipped} skipped ` +
      `(${run.totals.total} всего, ${run.totals.failingChecks.length} упавших проверок)`
  );

  // Скриншоты упавших проверок — каждый отдельным файлом, "anyone with
  // link" (иначе дашборд, открытый не из того же Google-аккаунта, не
  // сможет отрисовать <img>). Это меняет режим доступа именно для этих
  // файлов — zip с полным отчётом остаётся закрытым, как раньше.
  for (const check of run.totals.failingChecks) {
    if (!check.screenshotPath || !fs.existsSync(check.screenshotPath)) continue;
    try {
      const { data } = await drive.files.create({
        requestBody: { name: `${run.runId}__${check.key}.png`.replace(/[^A-Za-z0-9_.-]/g, '_'), parents: [folderId] },
        media: { mimeType: 'image/png', body: fs.createReadStream(check.screenshotPath) },
        fields: 'id',
      });
      await drive.permissions.create({ fileId: data.id, requestBody: { role: 'reader', type: 'anyone' } });
      check.screenshotUrl = `https://drive.google.com/uc?export=view&id=${data.id}`;
    } catch (err) {
      console.warn(`Не удалось загрузить скриншот для ${check.key}: ${err.message}`);
    }
    delete check.screenshotPath; // локальный путь не нужен в итоговом JSON
  }
  // screenshotPath временный и есть только у объектов из failingChecks;
  // сами check-объекты внутри run.categories — те же ссылки, так что
  // screenshotUrl, записанный выше, уже попал туда.

  const jsonBody = JSON.stringify(run, null, 0);
  await drive.files.update({
    fileId: latestFileId,
    media: { mimeType: 'application/json', body: bufferStream(jsonBody) },
  });
  // На случай, если файл раньше создавался без публичного доступа.
  await drive.permissions
    .create({ fileId: latestFileId, requestBody: { role: 'reader', type: 'anyone' } })
    .catch(() => {}); // уже может быть выдано — не фатально

  console.log(`QA-дашборд обновлён: https://www.googleapis.com/drive/v3/files/${latestFileId}?alt=media`);
}

function bufferStream(text) {
  const { Readable } = require('stream');
  return Readable.from([Buffer.from(text, 'utf8')]);
}

function buildRunSummary(report) {
  const checksByKey = new Map(); // key -> { key, title, file, category, projects: {}, screenshotPath, screenshotUrl }

  for (const spec of iterateSpecs(report.suites || [])) {
    const slug = categoryForFile(spec.file);
    if (slug === null) continue; // example.spec.ts — осознанно пропускаем

    for (const test of spec.tests || []) {
      const results = test.results || [];
      const last = results[results.length - 1];
      if (!last) continue;

      const ok = last.status === (test.expectedStatus || 'passed');
      const status = ok ? 'passed' : last.status === 'skipped' ? 'skipped' : 'failed';
      const expectedFail = ok && (test.expectedStatus === 'failed' || test.expectedStatus === 'timedOut');

      const key = `${slug}::${spec.titlePath ? spec.titlePath.join(' > ') : spec.title}`;
      if (!checksByKey.has(key)) {
        checksByKey.set(key, {
          key,
          title: spec.title,
          file: spec.file,
          category: slug,
          projects: {},
        });
      }
      const check = checksByKey.get(key);
      const errorMessage = last.error?.message || last.errors?.[0]?.message || null;
      check.projects[test.projectName] = {
        status,
        expectedFail,
        durationMs: last.duration || 0,
        error: errorMessage ? String(errorMessage).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 400) : null,
      };

      if (status === 'failed') {
        const shot = (last.attachments || []).find((a) => a.name === 'screenshot' && a.path);
        if (shot && !check.screenshotPath) check.screenshotPath = shot.path;
      }
    }
  }

  const categories = {};
  const failingChecks = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const check of checksByKey.values()) {
    const projectStatuses = Object.values(check.projects).map((p) => p.status);
    const overall = projectStatuses.includes('failed')
      ? 'failed'
      : projectStatuses.every((s) => s === 'skipped')
        ? 'skipped'
        : 'passed';
    check.status = overall;
    if (overall === 'passed') passed++;
    else if (overall === 'skipped') skipped++;
    else {
      failed++;
      failingChecks.push(check);
    }

    if (!categories[check.category]) {
      categories[check.category] = { name: categoryName(check.category), checks: [] };
    }
    categories[check.category].checks.push(check);
  }

  const date = new Date().toISOString().slice(0, 10);
  const runId = `${date}_gh${process.env.GITHUB_RUN_ID || 'local'}`;

  return {
    runId,
    date,
    finishedAt: new Date().toISOString(),
    trigger: {
      source: process.env.GITHUB_EVENT_NAME === 'schedule' ? 'schedule' : 'manual',
      actor: process.env.GITHUB_ACTOR || null,
      browsers: process.env.BROWSERS || null,
      specFiles: process.env.SPEC_FILES || null,
      grep: process.env.GREP || null,
      retries: process.env.RETRIES === 'true',
    },
    runNumber: process.env.GITHUB_RUN_NUMBER || null,
    reportUrl: process.env.REPORT_DRIVE_URL || null,
    totals: { passed, failed, skipped, total: passed + failed + skipped, failingChecks },
    categories,
  };
}

// Рекурсивно обходит suites (файл -> describe-блоки -> describe-блоки -> spec)
// и возвращает плоский список spec'ов с их file/title/titlePath/tests.
function* iterateSpecs(suites, titlePath = []) {
  for (const suite of suites) {
    const nextPath = suite.title ? [...titlePath, suite.title] : titlePath;
    for (const spec of suite.specs || []) {
      yield { ...spec, file: spec.file || suite.file, titlePath: [...nextPath, spec.title] };
    }
    if (suite.suites && suite.suites.length) {
      yield* iterateSpecs(suite.suites, nextPath);
    }
  }
}

module.exports = { buildRunSummary, iterateSpecs };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    // Публикация в дашборд — дополнительная функция, не должна ронять
    // основной прогон тестов (отчёт на Drive к этому моменту уже загружен
    // предыдущим шагом). Код выхода 0: сообщаем об ошибке, но не валим job.
    process.exitCode = 0;
  });
}
