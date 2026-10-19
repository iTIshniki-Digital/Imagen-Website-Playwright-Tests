// Разовая (но можно запускать снова при необходимости) очистка всего,
// что накопилось от тестовых прогонов: issues с лейблами qa-bug/qa-run,
// история прогонов playwright.yml и qa-issue-trigger.yml, и файлы на
// Google Drive в рабочей папке (кроме latest.json — его не трогаем).
//
// Запускается ТОЛЬКО через .github/workflows/qa-cleanup.yml (ручной
// workflow_dispatch с обязательным подтверждением) — необратимо, поэтому
// не вызывается ни из какого другого места и не триггерится автоматически.
//
// Требует: GH_TOKEN (для gh CLI) и, опционально, GDRIVE_* (для очистки
// папки на Drive — без них просто пропускает этот шаг).

const { execFileSync } = require('child_process');

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

async function main() {
  console.log('=== Issues (qa-bug, qa-run) ===');
  await deleteIssuesByLabel('qa-bug');
  await deleteIssuesByLabel('qa-run');

  console.log('\n=== История прогонов ===');
  deleteWorkflowRuns('playwright.yml');
  deleteWorkflowRuns('qa-issue-trigger.yml');

  console.log('\n=== Google Drive ===');
  await cleanupDrive();

  console.log('\nГотово.');
}

async function deleteIssuesByLabel(label) {
  let list;
  try {
    list = JSON.parse(gh(['issue', 'list', '--label', label, '--state', 'all', '--json', 'number', '--limit', '500']));
  } catch (err) {
    console.warn(`Не удалось получить список issues с лейблом ${label}: ${err.message}`);
    return;
  }
  console.log(`${label}: ${list.length} issue(s)`);
  for (const { number } of list) {
    try {
      gh(['issue', 'delete', String(number), '--yes']);
      console.log(`  удалён #${number}`);
    } catch (err) {
      // Удаление issues иногда отключено на уровне организации — тогда
      // закрываем как запасной вариант, это тоже убирает их из Open Bugs.
      try {
        gh(['issue', 'close', String(number)]);
        console.log(`  удалить не вышло, закрыт #${number} (${err.message.split('\n')[0]})`);
      } catch (err2) {
        console.warn(`  не удалось ни удалить, ни закрыть #${number}: ${err2.message}`);
      }
    }
  }
}

function deleteWorkflowRuns(workflowFile) {
  let list;
  try {
    list = JSON.parse(gh(['run', 'list', '--workflow', workflowFile, '--json', 'databaseId', '--limit', '500']));
  } catch (err) {
    console.warn(`Не удалось получить список прогонов ${workflowFile}: ${err.message}`);
    return;
  }
  console.log(`${workflowFile}: ${list.length} run(s)`);
  for (const { databaseId } of list) {
    try {
      gh(['run', 'delete', String(databaseId)]);
      console.log(`  удалён run ${databaseId}`);
    } catch (err) {
      console.warn(`  не удалось удалить run ${databaseId}: ${err.message.split('\n')[0]}`);
    }
  }
}

async function cleanupDrive() {
  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    console.warn('GDRIVE_* не заданы — пропускаю очистку Drive.');
    return;
  }

  const { google } = require('googleapis');
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  let pageToken;
  let total = 0;
  do {
    const { data } = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and name != 'latest.json'`,
      fields: 'nextPageToken, files(id, name)',
      pageToken,
    });
    for (const file of data.files ?? []) {
      try {
        await drive.files.delete({ fileId: file.id });
        total++;
      } catch (err) {
        console.warn(`  не удалось удалить ${file.name}: ${err.message}`);
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  console.log(`Удалено файлов на Drive: ${total} (latest.json сохранён).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
