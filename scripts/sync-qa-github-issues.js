// После прогона: заводит/закрывает issues по упавшим/починенным проверкам
// (label qa-bug, маркер <!-- qa-check-key: ... --> в теле — по нему ищем
// "тот же" баг между прогонами) и, если прогон был запущен через issue
// (см. .github/workflows/qa-issue-trigger.yml, input source_issue),
// комментирует туда итог и закрывает его.
//
// Отдельно от scripts/publish-qa-dashboard-run.js (тот — для Google Drive
// и дашборда claude.ai), но использует тот же разбор отчёта — требует
// playwright-report/results.json.
//
// Требует: GH_TOKEN (обычно secrets.GITHUB_TOKEN), выполняется внутри
// checkout репозитория. SOURCE_ISSUE — опционально (номер issue-триггера).

const fs = require('fs');
const { execFileSync } = require('child_process');
const { buildRunSummary } = require('./publish-qa-dashboard-run');

const RESULTS_JSON = 'playwright-report/results.json';
const BUG_LABEL = 'qa-bug';

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

// Один запрос на все открытые qa-bug issues вместо поиска по каждому
// ключу отдельно — из тела каждого вытаскиваем его qa-check-key и строим
// карту key -> номер issue, дальше всё сравнение локальное.
function loadOpenBugIssues() {
  let out;
  try {
    out = gh(['issue', 'list', '--label', BUG_LABEL, '--state', 'open', '--json', 'number,body', '--limit', '200']);
  } catch (err) {
    console.warn(`Не удалось получить список открытых qa-bug issues: ${err.message}`);
    return new Map();
  }
  const list = JSON.parse(out || '[]');
  const map = new Map();
  for (const issue of list) {
    // checkKey сам может содержать пробелы (titlePath через " > "), поэтому
    // граница — закрывающий --> HTML-комментария, не \s.
    const m = (issue.body || '').match(/<!--\s*qa-check-key:\s*(.+?)\s*-->/);
    if (m) map.set(m[1], issue.number);
  }
  return map;
}

function main() {
  if (!fs.existsSync(RESULTS_JSON)) {
    console.warn(`${RESULTS_JSON} не найден — нечего синхронизировать.`);
    return;
  }

  ensureLabel(BUG_LABEL, 'd73a4a', 'Auto-filed by the QA pipeline from a failing check');
  ensureLabel('qa-run', '0e8a16', 'Opened by the QA dashboard to request a test run');

  const report = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));
  const run = buildRunSummary(report);

  const passedKeys = new Set();
  Object.values(run.categories).forEach((cat) => {
    (cat.checks || []).forEach((c) => {
      if (c.status === 'passed') passedKeys.add(c.key);
    });
  });

  const openBugIssues = loadOpenBugIssues(); // checkKey -> issue number, один запрос на всё

  // Завести/обновить issue на каждую упавшую проверку.
  for (const check of run.totals.failingChecks) {
    const existing = openBugIssues.get(check.key);
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
        gh(['issue', 'comment', String(existing), '--body', `Still failing as of run ${run.runId}.\n\n${body}`]);
      } catch (err) {
        console.warn(`Не удалось прокомментировать issue #${existing}: ${err.message}`);
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

  writeJobSummary(run);

  console.log(`Готово: ${run.totals.failingChecks.length} issue(s) заведено/обновлено, ${passedKeys.size} проверок прошли.`);
}

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

main();
