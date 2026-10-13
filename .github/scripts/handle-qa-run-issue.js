// Обрабатывает issue, открытое по шаблону "QA test run"
// (.github/ISSUE_TEMPLATE/qa-run.yml) — запускается из
// .github/workflows/qa-issue-trigger.yml на каждое новое issue.
//
// GitHub сам рендерит форму в Markdown такого вида (это не наш формат,
// это то, что генерирует сам GitHub Issue Forms):
//   ### Browsers
//
//   - [x] Chrome
//   - [ ] Firefox
//
//   ### Filter by test name (optional)
//
//   pricing
// (пустое текстовое поле рендерится как "_No response_")
//
// Если в теле issue нет секции "### Browsers" — это не наш шаблон (обычное
// issue), тихо выходим, ничего не комментируем. Если секция есть, но
// значения не проходят проверку — комментируем issue причиной и тоже не
// запускаем прогон (та же защита, что раньше была в форме на сайте —
// дальше по цепочке значения ещё раз проверяются в playwright.yml, но тут
// нужна, потому что issue может открыть кто угодно с доступом к репо).

const { execFileSync } = require('child_process');
const path = require('path');
const { CATEGORIES } = require(path.join(__dirname, '..', '..', 'scripts', 'qa-dashboard-categories'));

// Должно слово в слово совпадать с лейблами чекбоксов "Browsers" в
// .github/ISSUE_TEMPLATE/qa-run.yml.
const BROWSER_LABEL_TO_SLUG = { Chrome: 'chromium', Firefox: 'firefox', 'Safari (WebKit)': 'webkit' };

const SPEC_RE = /^tests\/[A-Za-z0-9._-]+\.spec\.ts$/;
const GREP_RE = /^[A-Za-z0-9 _.,:()/|-]{1,120}$/;

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function comment(issueNumber, body) {
  gh(['issue', 'comment', String(issueNumber), '--body', body]);
}

// Достаёт текст между "### <heading>" и следующим "### " (или концом тела).
function extractSection(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('###\\s*' + escaped + '\\s*\\n([\\s\\S]*?)(?=\\n###\\s|$)');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function checkedLabels(sectionText) {
  if (!sectionText) return [];
  const labels = [];
  const re = /^- \[x\]\s*(.+)$/gim;
  let m;
  while ((m = re.exec(sectionText))) labels.push(m[1].trim());
  return labels;
}

function textField(sectionText) {
  if (!sectionText) return '';
  const t = sectionText.trim();
  return t === '_No response_' ? '' : t;
}

function main() {
  const body = process.env.ISSUE_BODY || '';
  const issueNumber = process.env.ISSUE_NUMBER;
  if (!issueNumber) {
    console.error('ISSUE_NUMBER не задан');
    process.exit(1);
  }

  const browsersSection = extractSection(body, 'Browsers');
  if (browsersSection === null) {
    console.log('В issue нет секции "### Browsers" — не форма QA-прогона, ничего не делаем.');
    return;
  }

  const browserLabels = checkedLabels(browsersSection);
  let browsers = browserLabels.map((l) => BROWSER_LABEL_TO_SLUG[l]).filter(Boolean);
  if (!browsers.length) browsers = ['chromium']; // ничего не отмечено — по умолчанию Chrome, как написано в форме

  const categoryLabels = checkedLabels(extractSection(body, 'What to check'));
  const files = [];
  for (const label of categoryLabels) {
    const cat = Object.values(CATEGORIES).find((c) => c.name === label);
    if (!cat) {
      comment(
        issueNumber,
        `Couldn't start the run: "${label}" under "What to check" doesn't match a known category — ` +
          `the issue template and scripts/qa-dashboard-categories.js are out of sync. Ping whoever maintains the test suite.`
      );
      return;
    }
    cat.files.forEach((f) => { if (files.indexOf(f) === -1) files.push(f); });
  }
  if (files.length > 12) {
    comment(issueNumber, `Couldn't start the run: too many test files selected (${files.length}, max 12). Pick fewer categories.`);
    return;
  }
  const specFiles = files.join(' ');
  // На всякий случай — тот же формат проверяем, что и везде (защита от будущих
  // изменений в qa-dashboard-categories.js, которые могли бы дать что-то не то).
  if (specFiles && !files.every((f) => SPEC_RE.test(f))) {
    comment(issueNumber, `Couldn't start the run: internal error building spec_files ("${specFiles}").`);
    return;
  }

  const grep = textField(extractSection(body, 'Filter by test name (optional)'));
  if (grep && !GREP_RE.test(grep)) {
    comment(issueNumber, `Couldn't start the run: invalid name filter "${grep}".`);
    return;
  }

  const cookies = textField(extractSection(body, 'A/B test cookies (optional)'));
  if (cookies && (cookies.length > 2000 || /[\r\n]/.test(cookies) || cookies.indexOf('=') === -1)) {
    comment(issueNumber, `Couldn't start the run: invalid cookies string.`);
    return;
  }

  const optionsLabels = checkedLabels(extractSection(body, 'Options'));
  const retries = optionsLabels.some((l) => l.indexOf('Retry failed tests once') === 0) ? 'true' : 'false';

  gh([
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
  ]);

  const summary = [
    browsers.join(', '),
    specFiles ? `${files.length} file(s)` : 'full suite',
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

main();
