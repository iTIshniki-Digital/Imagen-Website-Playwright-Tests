// Обрабатывает issue, которое могло быть открыто дашбордом ("Imagen QA
// Runs", claude.ai Artifact) как запрос на прогон тестов. Запускается из
// .github/workflows/qa-issue-trigger.yml на каждое новое issue.
//
// Дашборд открывает issue с телом вида:
//   ...текст...
//   ```qa-run
//   {"browsers":"chromium","specs":"tests/a.spec.ts","grep":"","cookies":"","retries":"false"}
//   ```
// Если такого блока нет — это обычное issue, ничего не делаем и выходим
// молча (не комментируем чужие issues). Если блок есть, но невалиден —
// комментируем issue понятной причиной и тоже не запускаем прогон (эта
// проверка — то же, что делает сама форма на сайте/plugin, здесь нужна,
// потому что issue может открыть кто угодно с доступом к репозиторию, не
// обязательно через сам дашборд).
//
// Требует: GH_TOKEN (есть в GITHUB_TOKEN автоматически), выполняется внутри
// checkout репозитория (gh сам определяет repo по git remote).

const { execFileSync } = require('child_process');

const BROWSERS_ALLOWED = ['chromium', 'firefox', 'webkit'];
const SPEC_RE = /^tests\/[A-Za-z0-9._-]+\.spec\.ts$/;
const GREP_RE = /^[A-Za-z0-9 _.,:()/|-]{1,120}$/;

function gh(args, input) {
  return execFileSync('gh', args, { input, encoding: 'utf8' });
}

function main() {
  const body = process.env.ISSUE_BODY || '';
  const issueNumber = process.env.ISSUE_NUMBER;
  if (!issueNumber) {
    console.error('ISSUE_NUMBER не задан');
    process.exit(1);
  }

  const match = body.match(/```qa-run\s*\n([\s\S]*?)\n```/);
  if (!match) {
    console.log('В issue нет блока ```qa-run``` — не наш случай, ничего не делаем.');
    return;
  }

  let cfg;
  try {
    cfg = JSON.parse(match[1]);
  } catch (err) {
    comment(issueNumber, `Couldn't start the run: the qa-run block isn't valid JSON (${err.message}).`);
    return;
  }

  const browsers = String(cfg.browsers || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!browsers.length || !browsers.every((b) => BROWSERS_ALLOWED.includes(b))) {
    comment(issueNumber, `Couldn't start the run: invalid browsers "${cfg.browsers}". Allowed: ${BROWSERS_ALLOWED.join(', ')}.`);
    return;
  }

  const specFiles = String(cfg.specs || '').trim();
  if (specFiles) {
    const parts = specFiles.split(/\s+/);
    if (parts.length > 12 || !parts.every((f) => SPEC_RE.test(f))) {
      comment(issueNumber, `Couldn't start the run: invalid spec_files "${specFiles}" (paths like tests/name.spec.ts, max 12).`);
      return;
    }
  }

  const grep = String(cfg.grep || '').trim();
  if (grep && !GREP_RE.test(grep)) {
    comment(issueNumber, `Couldn't start the run: invalid name filter "${grep}".`);
    return;
  }

  const cookies = String(cfg.cookies || '').trim();
  if (cookies && (cookies.length > 2000 || /[\r\n]/.test(cookies) || cookies.indexOf('=') === -1)) {
    comment(issueNumber, `Couldn't start the run: invalid cookies string.`);
    return;
  }

  const retries = cfg.retries === true || cfg.retries === 'true' ? 'true' : 'false';

  const dispatchArgs = [
    'workflow',
    'run',
    'playwright.yml',
    '-f',
    `browsers=${browsers.join(',')}`,
    '-f',
    `raw_client_cookies=${cookies}`,
    '-f',
    `spec_files=${specFiles}`,
    '-f',
    `grep=${grep}`,
    '-f',
    `retries=${retries}`,
    '-f',
    `source_issue=${issueNumber}`,
  ];
  gh(dispatchArgs);

  const summary = [
    browsers.join(', '),
    specFiles ? `${specFiles.split(/\s+/).length} file(s)` : 'full suite',
    grep ? `filter "${grep}"` : null,
    retries === 'true' ? 'with retry' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  comment(
    issueNumber,
    `Run queued: ${summary}.\n\nResults will be posted here, and this issue closed, when it finishes (usually 20–30 minutes). ` +
      `[Watch it live](https://github.com/${process.env.GITHUB_REPOSITORY}/actions/workflows/playwright.yml).`
  );
}

function comment(issueNumber, body) {
  gh(['issue', 'comment', String(issueNumber), '--body', body]);
}

main();
