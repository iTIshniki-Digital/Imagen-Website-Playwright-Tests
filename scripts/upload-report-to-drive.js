const { google } = require('googleapis');
const fs = require('fs');

const REPORT_ZIP = 'playwright-report.zip';
const RETENTION_DAYS = 7;

async function main() {
  const rawKey = process.env.GDRIVE_SA_KEY;
  const folderId = process.env.GDRIVE_FOLDER_ID;

  if (!rawKey || !folderId) {
    console.error('GDRIVE_SA_KEY или GDRIVE_FOLDER_ID не заданы — добавьте их в GitHub Secrets.');
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(rawKey),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

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
