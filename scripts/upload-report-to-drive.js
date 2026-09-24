const { google } = require('googleapis');
const fs = require('fs');

const REPORT_ZIP = 'playwright-report.zip';
const RETENTION_DAYS = 7;

async function main() {
  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;
  const folderId = process.env.GDRIVE_FOLDER_ID;

  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    console.error('GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET / GDRIVE_REFRESH_TOKEN / GDRIVE_FOLDER_ID не заданы — добавьте их в GitHub Secrets.');
    process.exit(1);
  }

  // Сервисные аккаунты не имеют собственной квоты хранилища в Google Drive
  // ("Service Accounts do not have storage quota") — без Google Workspace
  // (Shared Drives) загрузка файла сервисным аккаунтом падает с 403, даже
  // если папка расшарена на него как Editor. Поэтому тут OAuth от имени
  // обычного пользователя (см. scripts/get-gdrive-refresh-token.js) —
  // файл считается обычной загрузкой в личный Google Drive этого юзера.
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  await deleteOldReports(drive, folderId);
  await uploadReport(drive, folderId);
}

async function deleteOldReports(drive, folderId) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and createdTime < '${cutoff}'`,
    fields: 'files(id, name, createdTime)',
  });

  for (const file of data.files ?? []) {
    await drive.files.delete({ fileId: file.id });
    console.log(`Удалён отчёт старше ${RETENTION_DAYS} дней: ${file.name}`);
  }
}

async function uploadReport(drive, folderId) {
  const runNumber = process.env.GITHUB_RUN_NUMBER ?? 'local';
  const date = new Date().toISOString().slice(0, 10);
  const name = `report-${date}-run${runNumber}.zip`;

  const { data } = await drive.files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType: 'application/zip', body: fs.createReadStream(REPORT_ZIP) },
    fields: 'id',
  });

  console.log(`Отчёт загружен на Google Drive: ${name}`);
  console.log(`Ссылка: https://drive.google.com/file/d/${data.id}/view`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
