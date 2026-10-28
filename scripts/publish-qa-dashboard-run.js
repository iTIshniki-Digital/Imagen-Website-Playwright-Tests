// Читает JSON-отчёт Playwright (см. playwright.config.ts, репортер 'json'),
// группирует результаты по категориям клиентского чек-листа
// (qa-dashboard-categories.js), грузит скриншоты и видео упавших тестов на
// Google Drive — и использует их же (РОВНО ОДИН раз, не дважды) в двух
// местах:
//   1. перезаписывает ОДИН и тот же файл latest.json на Drive — его читает
//      веб-приложение (docs/) через Worker, см. docs/README-setup.md;
//   2. заводит/обновляет/закрывает issues с лейблом qa-bug на GitHub —
//      основной способ видеть баги, см. scripts/README-qa-dashboard.md.
//
// Раньше это были два отдельных скрипта (publish-qa-dashboard-run.js и
// sync-qa-github-issues.js), каждый сам по себе парсил отчёт — из-за этого
// у issues никогда не было скриншотов: их грузил на Drive только первый
// скрипт, а issues заводил второй, который про эту загрузку просто не знал
// (обнаружено 2026-10-19 на живом прогоне — issues создавались пустыми).
// Теперь один проход, один набор загруженных файлов, один источник правды.
//
// Почему "перезаписывает один и тот же файл", а не создаёт новый каждый
// раз: у веб-приложения нет способа найти "последний" файл в папке Drive
// без отдельного listing-запроса — проще держать fileId фиксированным
// (создаётся один раз заранее, см. README ниже) и обновлять его содержимое
// через files.update. Если этот файл недоступен для перезаписи (создан не
// тем же Google-аккаунтом, например, залит руками при первоначальной
// настройке) — скрипт сам создаёт новый от своего имени и громко просит
// обновить id в двух местах (секрет GitHub + переменная Worker'а).
//
// Требует переменные окружения:
//   GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN  — те же,
//     что upload-report-to-drive.js
//   GDRIVE_FOLDER_ID            — та же папка, что и у отчётов
//   GDRIVE_LATEST_JSON_FILE_ID  — id ОДНОГО файла на Drive (см.
//     scripts/README-qa-dashboard.md). Не задан — пропускаем публикацию
//     в веб-приложение, но issues всё равно заводим (если есть GH_TOKEN).
//   GDRIVE_API_KEY               — тот же ключ, что DRIVE_API_KEY в
//     cloudflare-worker/oauth-proxy.js, нужен для надёжных ссылок на
//     скриншоты (см. комментарий у uploadFailureMedia). Не задан —
//     скриншоты просто не прикладываются, остальное не страдает.
//   GH_TOKEN                    — для gh CLI (создание/закрытие issues).
//     Не задан — пропускаем issues, но Drive всё равно публикуем (если
//     заданы GDRIVE_*). Ничего из этого не валит сам прогон тестов.
//   SLACK_WEBHOOK_URL            — Incoming Webhook канала в Slack, см.
//     scripts/README-qa-dashboard.md. Не задан — просто не шлём отчёт в
//     Slack, остальное не страдает.
// Необязательные (контекст запуска, подставляются воркфлоу):
//   GITHUB_RUN_ID, GITHUB_RUN_NUMBER, GITHUB_ACTOR, GITHUB_EVENT_NAME,
//   BROWSERS, SPEC_FILES, GREP, RETRIES, REPORT_DRIVE_URL, SOURCE_ISSUE

const fs = require('fs');
const { execFileSync } = require('child_process');
const { google } = require('googleapis');
const { categoryForFile, categoryName } = require('./qa-dashboard-categories');

const RESULTS_JSON = 'playwright-report/results.json';
const BUG_LABEL = 'qa-bug';

// Видео прикладываем не ко всем упавшим проверкам, а только там, где один
// статичный скриншот не объясняет суть — многошаговые воронки (упало на
// каком-то шаге, скриншот покажет только последний) и интерактивность/
// скролл (важна последовательность, не конечное состояние). Для всего
// остального (статичные assert'ы — цены, битые ссылки, доступность,
// консоль) скриншота достаточно, видео только грузит Drive и отвлекает.
// Пополните список, если найдётся ещё один тест, где без видео непонятно.
const VIDEO_WORTHY_FILES = new Set([
  'signup-funnel.spec.ts',
  'quiz-full-walkthrough.spec.ts',
  'localized-funnel.spec.ts',
  'video-funnel.spec.ts',
  'video-quiz-full-walkthrough.spec.ts',
  'mobile-funnel.spec.ts',
  'interactive-widgets.spec.ts',
  'scroll-behavior.spec.ts',
  'real-estate.spec.ts',
]);

async function main() {
  if (!fs.existsSync(RESULTS_JSON)) {
    console.warn(`${RESULTS_JSON} не найден — нечего публиковать.`);
    return;
  }

  const report = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));
  const run = buildRunSummary(report);
  console.log(
    `Разобрано: ${run.totals.passed} passed, ${run.totals.failed} failed, ${run.totals.skipped} skipped ` +
      `(${run.totals.total} всего, ${run.totals.failingChecks.length} упавших проверок)`
  );

  // Каждый этап в своём try/catch: сбой одного (истёк Google-токен, лимит
  // GitHub API) не должен молча отменять остальные — особенно Slack, который
  // идёт последним и раньше просто не отправлялся, если что-то упало выше.
  const drive = makeDriveClient();
  if (drive) {
    try {
      await uploadFailureMedia(run, drive);
      await publishLatestJson(run, drive);
    } catch (err) {
      console.warn(`Публикация на Drive не удалась: ${err.message}`);
    }
  } else {
    console.warn('GDRIVE_* не заданы — пропускаю загрузку на Drive (скриншоты/видео/latest.json).');
  }

  if (hasGh()) {
    try {
      syncGithubIssues(run);
    } catch (err) {
      console.warn(`Синхронизация issues не удалась: ${err.message}`);
    }
  } else {
    console.warn('gh CLI/GH_TOKEN недоступны — пропускаю issues.');
  }

  try {
    writeJobSummary(run);
  } catch (err) {
    console.warn(`Job Summary не записан: ${err.message}`);
  }
  await notifySlack(run);
}

/* ------------------------------------------------------------- Google Drive */

function makeDriveClient() {
  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!clientId || !clientSecret || !refreshToken || !folderId) return null;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  // GDRIVE_API_KEY — тот же read-only ключ, что уже используется в
  // cloudflare-worker/oauth-proxy.js (DRIVE_API_KEY) — нужен для ссылок на
  // скриншоты, см. комментарий у screenshotUrl ниже. Не обязателен: без
  // него скриншоты просто не прикладываются (видео и latest.json не
  // страдают, у них свой формат ссылок).
  return { client: google.drive({ version: 'v3', auth: oauth2Client }), folderId, apiKey: process.env.GDRIVE_API_KEY };
}

// Скриншоты и видео упавших проверок — каждый отдельным файлом, "anyone
// with link" (иначе ни веб-приложение, ни issue на GitHub не покажут
// картинку/видео тому, кто не вошёл под тем же Google-аккаунтом). Это
// меняет режим доступа именно для этих файлов — zip с полным отчётом
// остаётся закрытым, как раньше.
//
// Видео — ссылкой на штатный просмотрщик Drive (.../file/d/<id>/view), а
// не прямым <video src>: прямые ссылки на Drive не всегда отдают
// byte-range (нужен для перемотки), просмотрщик это уже решает сам.
//
// Скриншоты — ссылкой на Drive API (.../alt=media&key=...), а НЕ на
// drive.google.com/uc?export=view: та ссылка отдаёт файл напрямую через
// curl/без Google-сессии, но у браузера, реально залогиненного в какой-то
// Google-аккаунт, вместо картинки иногда открывается промежуточная
// HTML-страница вместо самого файла — проверено вживую 2026-10-19,
// картинки в приложении не показывались, а 303→200 с содержимым PNG
// подтверждались только через curl. v3 files API с ключом отдаёт PNG
// напрямую, без редиректа, тем же способом уже проверенным для
// cloudflare-worker/oauth-proxy.js. Без GDRIVE_API_KEY — пропускаем
// скриншот (видео и сам latest.json не страдают).
async function uploadFailureMedia(run, drive) {
  for (const check of run.totals.failingChecks) {
    if (check.screenshotPath && fs.existsSync(check.screenshotPath)) {
      try {
        const { data } = await drive.client.files.create({
          requestBody: { name: `${run.runId}__${check.key}.png`.replace(/[^A-Za-z0-9_.-]/g, '_'), parents: [drive.folderId] },
          media: { mimeType: 'image/png', body: fs.createReadStream(check.screenshotPath) },
          fields: 'id',
        });
        await drive.client.permissions.create({ fileId: data.id, requestBody: { role: 'reader', type: 'anyone' } });
        check.screenshotUrl = drive.apiKey
          ? `https://www.googleapis.com/drive/v3/files/${data.id}?alt=media&key=${drive.apiKey}`
          : `https://drive.google.com/uc?export=view&id=${data.id}`; // фолбэк, если ключ не задан — тот же риск промежуточной страницы
      } catch (err) {
        console.warn(`Не удалось загрузить скриншот для ${check.key}: ${err.message}`);
      }
    }
    delete check.screenshotPath; // локальный путь не нужен в итоговом JSON

    if (check.videoPath && fs.existsSync(check.videoPath)) {
      try {
        const { data } = await drive.client.files.create({
          requestBody: { name: `${run.runId}__${check.key}.webm`.replace(/[^A-Za-z0-9_.-]/g, '_'), parents: [drive.folderId] },
          media: { mimeType: 'video/webm', body: fs.createReadStream(check.videoPath) },
          fields: 'id',
        });
        await drive.client.permissions.create({ fileId: data.id, requestBody: { role: 'reader', type: 'anyone' } });
        check.videoUrl = `https://drive.google.com/file/d/${data.id}/view`;
      } catch (err) {
        console.warn(`Не удалось загрузить видео для ${check.key}: ${err.message}`);
      }
    }
    delete check.videoPath; // локальный путь не нужен в итоговом JSON
  }
  // screenshotPath/videoPath временные и есть только у объектов из
  // failingChecks; сами check-объекты внутри run.categories — те же ссылки,
  // так что screenshotUrl/videoUrl, записанные выше, уже попали туда — и
  // попадут и в latest.json, и в тела issues ниже, без повторной загрузки.
}

async function publishLatestJson(run, drive) {
  const latestFileId = process.env.GDRIVE_LATEST_JSON_FILE_ID;
  if (!latestFileId) {
    console.warn(
      'GDRIVE_LATEST_JSON_FILE_ID не задан — пропускаю публикацию в веб-приложение. ' +
        'См. scripts/README-qa-dashboard.md для разовой настройки.'
    );
    return;
  }

  const jsonBody = JSON.stringify(run, null, 0);
  let activeFileId = latestFileId;
  try {
    await drive.client.files.update({
      fileId: activeFileId,
      media: { mimeType: 'application/json', body: bufferStream(jsonBody) },
    });
  } catch (err) {
    // Самый вероятный случай — GDRIVE_LATEST_JSON_FILE_ID указывает на файл,
    // созданный не тем же Google-аккаунтом, что стоит за GDRIVE_REFRESH_TOKEN
    // (например, залит руками через веб-интерфейс при первоначальной
    // настройке) — тогда у этого аккаунта нет прав его перезаписывать, хотя
    // создавать новые файлы в той же папке он может (её он видит как Editor).
    // Не падаем молча: создаём новый файл под своим же аккаунтом и громко
    // просим обновить секрет/настройки на новый id — дальше он уже будет
    // перезаписываться нормально.
    console.warn(
      `Не удалось перезаписать файл ${activeFileId} (${err.message}). ` +
        `Похоже, он создан другим Google-аккаунтом — создаю новый latest.json от имени текущего аккаунта.`
    );
    const { data } = await drive.client.files.create({
      requestBody: { name: 'latest.json', parents: [drive.folderId] },
      media: { mimeType: 'application/json', body: bufferStream(jsonBody) },
      fields: 'id',
    });
    activeFileId = data.id;
    console.warn(
      `НОВЫЙ id файла: ${activeFileId} — обновите секрет GDRIVE_LATEST_JSON_FILE_ID в GitHub ` +
        `и переменную DRIVE_LATEST_JSON_FILE_ID в Cloudflare Worker на это значение, иначе веб-приложение продолжит смотреть на старый (пустой) файл.`
    );
  }

  // На случай, если файл раньше создавался без публичного доступа.
  await drive.client.permissions
    .create({ fileId: activeFileId, requestBody: { role: 'reader', type: 'anyone' } })
    .catch(() => {}); // уже может быть выдано — не фатально

  console.log(`Веб-приложение обновлено: https://www.googleapis.com/drive/v3/files/${activeFileId}?alt=media`);
}

function bufferStream(text) {
  const { Readable } = require('stream');
  return Readable.from([Buffer.from(text, 'utf8')]);
}

/* -------------------------------------------------------------- GitHub Issues */

function hasGh() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
    return !!process.env.GH_TOKEN;
  } catch {
    return false;
  }
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function ensureLabel(name, color, description) {
  try {
    gh(['label', 'create', name, '--color', color, '--description', description, '--force']);
  } catch (err) {
    console.warn(`Не удалось создать/обновить label "${name}": ${err.message}`);
  }
}

const IGNORE_LABEL = 'qa-ignored';

// Один запрос на все qa-bug issues (любое состояние) вместо поиска по
// каждому ключу отдельно — из тела каждого вытаскиваем его qa-check-key и
// раскладываем по трём корзинам, дальше всё сравнение локальное:
//   open         — сейчас открыт, при новом падении просто комментируем;
//   ignored      — закрыт и помечен qa-ignored (кто-то решил, что это не
//                  баг) — такие вообще не трогаем, не пересоздаём;
//   closedOther  — закрыт как починенный, но без qa-ignored — если
//                  проверка падает снова, это регресс, переоткрываем ТОТ
//                  ЖЕ issue, а не плодим дубликат.
function loadBugIssues() {
  let out;
  try {
    out = gh(['issue', 'list', '--label', BUG_LABEL, '--state', 'all', '--json', 'number,body,state,labels', '--limit', '500']);
  } catch (err) {
    console.warn(`Не удалось получить список qa-bug issues: ${err.message}`);
    return { open: new Map(), ignored: new Set(), closedOther: new Map() };
  }
  const list = JSON.parse(out || '[]');
  const open = new Map();
  const ignored = new Set();
  const closedOther = new Map();
  for (const issue of list) {
    // checkKey сам может содержать пробелы (titlePath через " > "), поэтому
    // граница — закрывающий --> HTML-комментария, не \s.
    const m = (issue.body || '').match(/<!--\s*qa-check-key:\s*(.+?)\s*-->/);
    if (!m) continue;
    const key = m[1];
    if (issue.state === 'open') {
      open.set(key, issue.number);
    } else if ((issue.labels || []).some((l) => l.name === IGNORE_LABEL)) {
      ignored.add(key);
    } else {
      closedOther.set(key, issue.number);
    }
  }
  return { open, ignored, closedOther };
}

function syncGithubIssues(run) {
  ensureLabel(BUG_LABEL, 'd73a4a', 'Auto-filed by the QA pipeline from a failing check');
  ensureLabel('qa-run', '0e8a16', 'Opened by the QA dashboard to request a test run');
  ensureLabel(IGNORE_LABEL, '6a737d', 'Not a real bug — the pipeline stops recreating/reopening it. Remove this label to start tracking it again.');

  const passedKeys = new Set();
  Object.values(run.categories).forEach((cat) => {
    (cat.checks || []).forEach((c) => {
      if (c.status === 'passed') passedKeys.add(c.key);
    });
  });

  const { open: openBugIssues, ignored: ignoredKeys, closedOther: closedOtherIssues } = loadBugIssues();

  // Завести/обновить issue на каждую упавшую проверку — screenshotUrl/
  // videoUrl тут уже настоящие Drive-ссылки, загруженные выше в этом же
  // прогоне, не повторная загрузка.
  let ignoredCount = 0;
  for (const check of run.totals.failingChecks) {
    if (ignoredKeys.has(check.key)) {
      ignoredCount++;
      continue; // помечено qa-ignored — не пересоздаём и не комментируем
    }

    const existing = openBugIssues.get(check.key);
    const regressed = !existing && closedOtherIssues.get(check.key);
    const body = [
      `<!-- qa-check-key: ${check.key} -->`,
      `**Category:** ${check.category}`,
      `**Run:** ${run.runId}${run.reportUrl ? ` ([full report](${run.reportUrl}))` : ''}`,
      '',
      Object.entries(check.projects || {})
        .filter(([, p]) => p.error)
        .map(([proj, p]) => `**${proj}:** ${p.error}`)
        .join('\n\n'),
      check.screenshotUrl ? `\n![screenshot](${check.screenshotUrl})` : '',
      check.videoUrl ? `\n[▶ Watch recording of the failing run](${check.videoUrl})` : '',
    ]
      .filter((s) => s !== undefined)
      .join('\n');

    if (existing) {
      try {
        // Тело — ВСЕГДА текущее состояние (свежий скриншот/видео/ошибка),
        // не только коммент: веб-приложение (docs/app.js) при отрисовке
        // бага читает именно body, а не историю комментариев — если
        // оставить только коммент, в интерфейсе будет видна версия
        // скриншота с момента первого создания issue, а не последняя
        // рабочая (так и нашли этот баг 2026-10-19 — старые issues
        // годами переживали смену формата ссылки на скриншот).
        gh(['issue', 'edit', String(existing), '--body', body]);
        gh(['issue', 'comment', String(existing), '--body', `Still failing as of run ${run.runId}.`]);
      } catch (err) {
        console.warn(`Не удалось обновить issue #${existing}: ${err.message}`);
      }
    } else if (regressed) {
      try {
        gh(['issue', 'reopen', String(regressed)]);
        gh(['issue', 'edit', String(regressed), '--body', body]); // см. комментарий выше про свежее тело
        gh(['issue', 'comment', String(regressed), '--body', `Regressed — failing again as of run ${run.runId}.`]);
      } catch (err) {
        console.warn(`Не удалось переоткрыть issue #${regressed}: ${err.message}`);
      }
    } else {
      try {
        gh(['issue', 'create', '--title', `QA: ${check.title}`, '--label', BUG_LABEL, '--body', body]);
      } catch (err) {
        console.warn(`Не удалось завести issue для ${check.key}: ${err.message}`);
      }
    }
  }
  // Закрыть issues по проверкам, которые снова прошли.
  for (const key of passedKeys) {
    const existing = openBugIssues.get(key);
    if (existing) {
      try {
        gh(['issue', 'close', String(existing), '--comment', `Fixed — passed again in run ${run.runId}.`]);
      } catch (err) {
        console.warn(`Не удалось закрыть issue #${existing}: ${err.message}`);
      }
    }
  }

  // Если прогон запущен через issue — отчитаться туда и закрыть его.
  const sourceIssue = process.env.SOURCE_ISSUE;
  if (sourceIssue) {
    const t = run.totals;
    const msg = [
      `Run finished: ${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped.`,
      run.reportUrl ? `[Full report](${run.reportUrl})` : null,
      t.failed ? `${t.failed} issue(s) filed/updated with the \`${BUG_LABEL}\` label.` : 'No failures — all good.',
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      gh(['issue', 'comment', sourceIssue, '--body', msg]);
      gh(['issue', 'close', sourceIssue]);
    } catch (err) {
      console.warn(`Не удалось закрыть исходный issue #${sourceIssue}: ${err.message}`);
    }
  }

  console.log(
    `Issues: ${run.totals.failingChecks.length - ignoredCount} заведено/обновлено` +
      (ignoredCount ? ` (+ ${ignoredCount} пропущено, ${IGNORE_LABEL})` : '') +
      `, ${passedKeys.size} проверок прошли.`
  );
}

/* ------------------------------------------------------------- Job Summary */

// Markdown в $GITHUB_STEP_SUMMARY — GitHub сам рендерит его прямо на
// странице прогона (вкладка Actions), без захода куда-либо ещё.
function writeJobSummary(run) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return; // не в Actions (локальный запуск) — не пишем

  const t = run.totals;
  const rows = Object.entries(run.categories)
    .map(([slug, cat]) => {
      const checks = cat.checks || [];
      const passed = checks.filter((c) => c.status === 'passed').length;
      const failed = checks.filter((c) => c.status === 'failed').length;
      const skipped = checks.filter((c) => c.status === 'skipped').length;
      const status = failed ? '❌' : skipped && !passed ? '⚪' : '✅';
      return `| ${status} ${cat.name} | ${passed} | ${failed} | ${skipped} |`;
    })
    .join('\n');

  const tail = [
    run.reportUrl ? `[Full HTML report (Google Drive)](${run.reportUrl})` : null,
    t.failed ? `${t.failed} failing check(s) filed/updated as \`${BUG_LABEL}\` issues — see the Issues tab.` : null,
  ].filter(Boolean);

  const md = [
    `## QA Run — \`${run.runId}\``,
    '',
    `**${t.passed} passed · ${t.failed} failed · ${t.skipped} skipped** out of ${t.total}`,
    '',
    '| Category | Passed | Failed | Skipped |',
    '|---|---|---|---|',
    rows,
    '',
    tail.join('\n\n'),
  ].join('\n');

  try {
    fs.appendFileSync(summaryFile, md + '\n');
  } catch (err) {
    console.warn(`Не удалось записать job summary: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ Slack */

// После каждого прогона, не только при падениях — см. обсуждение с
// пользователем 2026-10-19 ("после каждого прогона, рекомендую"). Без
// SLACK_WEBHOOK_URL просто ничего не отправляет, не ломает остальное.
async function notifySlack(run) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('SLACK_WEBHOOK_URL не задан — отчёт в Slack не отправляется.');
    return;
  }

  const t = run.totals;
  const allGood = t.failed === 0;
  const headerEmoji = allGood ? '✅' : '❌';

  const failingCats = Object.entries(run.categories)
    .map(([, cat]) => {
      const checks = cat.checks || [];
      const failed = checks.filter((c) => c.status === 'failed').length;
      return { name: cat.name, failed };
    })
    .filter((c) => c.failed > 0);

  const catLines = failingCats.length
    ? failingCats.map((c) => `❌ *${c.name}* — ${c.failed} fail`).join('\n') +
      (failingCats.length < Object.keys(run.categories).length
        ? `\n_(${Object.keys(run.categories).length - failingCats.length} more categories all passed)_`
        : '')
    : '✅ Every category passed.';

  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;

  const links = [runUrl ? `<${runUrl}|View in GitHub Actions>` : null, run.reportUrl ? `<${run.reportUrl}|Full HTML report>` : null]
    .filter(Boolean)
    .join(' · ');

  const body = {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${headerEmoji} QA Run — ${run.runId}`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${t.passed} passed · ${t.failed} failed · ${t.skipped} skipped* out of ${t.total}${run.trigger && run.trigger.actor ? ` · triggered by ${run.trigger.actor}` : ''}${run.trigger && run.trigger.siteVariant ? ` · site variant: ${run.trigger.siteVariant}` : ''}`,
        },
      },
      { type: 'section', text: { type: 'mrkdwn', text: catLines } },
      ...(links ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: links }] }] : []),
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`Slack webhook вернул ${res.status}: ${await res.text()}`);
    else console.log('Отчёт отправлен в Slack.');
  } catch (err) {
    console.warn(`Не удалось отправить отчёт в Slack: ${err.message}`);
  }
}

/* ------------------------------------------------------------- Report parsing */

function buildRunSummary(report) {
  const checksByKey = new Map(); // key -> { key, title, file, category, projects: {}, screenshotPath, screenshotUrl, videoPath, videoUrl }

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
        // Видео — только для файлов из VIDEO_WORTHY_FILES (см. определение
        // выше): Playwright записывает его для каждого упавшего теста
        // ('retain-on-failure'), но грузим и прикладываем не всё подряд —
        // там, где скриншота достаточно, видео только отвлекает.
        if (VIDEO_WORTHY_FILES.has(spec.file)) {
          const vid = (last.attachments || []).find((a) => a.name === 'video' && a.path);
          if (vid && !check.videoPath) check.videoPath = vid.path;
        }
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
      // Какой вариант A/B-теста /intelligent-studio/ был закреплён на прогон (cookie
      // site_version_site) — null значит "случайный, как у обычного посетителя".
      // Остальные cookies намеренно не сохраняем: сюда может попасть что угодно.
      siteVariant: ((process.env.RAW_CLIENT_COOKIES || '').match(/(?:^|;\s*)site_version_site=([^;]+)/) || [])[1] || null,
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
    // Публикация — дополнительная функция, не должна ронять основной прогон
    // тестов (отчёт на Drive к этому моменту уже загружен предыдущим шагом).
    // Код выхода 0: сообщаем об ошибке, но не валим job.
    process.exitCode = 0;
  });
}
