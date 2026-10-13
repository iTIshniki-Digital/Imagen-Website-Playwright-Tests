// Разовый помощник ДЛЯ CLAUDE (не для CI, не для дашборда — у страницы
// claude.ai Artifact нет возможности сделать fetch() ни на один внешний
// хост, см. scripts/README-qa-dashboard.md, раздел "Как синк работает
// на самом деле"). Когда пользователь просит синхронизировать дашборд:
//
//   node scripts/fetch-qa-dashboard-run.js <GDRIVE_LATEST_JSON_FILE_ID>
//
// Скачивает latest.json и все скриншоты/видео упавших проверок (публичные
// ссылки "anyone with the link", без ключей и авторизации) в локальную
// папку и печатает JSON-сводку с локальными путями — дальше Claude сам
// каждый файл грузит в хранилище ассетов артефакта (Artifact
// action:"upload_asset") и пишет результат в db (Artifact
// action:"write_db"), подставляя туда уже итоговые /_blob/<id> ссылки.
//
// Без аргументов, если задан GDRIVE_LATEST_JSON_FILE_ID в окружении —
// использует его.

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

function httpsGet(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'imagen-qa-dashboard-sync' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(httpsGet(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
      })
      .on('error', reject);
  });
}

function driveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

// Drive-ссылка на файл может указывать и на /uc?export=... (скриншоты,
// latest.json), и на /file/d/<id>/view (видео, см. publish-qa-dashboard-run.js) —
// оба случая сводим к id файла и скачиваем через export=download.
function driveFileIdFromUrl(url) {
  const ucMatch = url.match(/[?&]id=([^&]+)/);
  if (ucMatch) return decodeURIComponent(ucMatch[1]);
  const viewMatch = url.match(/\/file\/d\/([^/]+)/);
  if (viewMatch) return viewMatch[1];
  return null;
}

async function downloadFile(url, destPath) {
  const fileId = driveFileIdFromUrl(url);
  if (!fileId) throw new Error(`Не удалось распознать id файла в ссылке: ${url}`);
  const { buffer, contentType } = await httpsGet(driveDownloadUrl(fileId));
  const head = buffer.slice(0, 200).toString('utf8');
  if (/^\s*<!DOCTYPE html|^\s*<html/i.test(head)) {
    throw new Error(
      `Drive вернул HTML вместо файла (id=${fileId}) — обычно это страница-подтверждение для больших ` +
        `файлов (confirm=t) или файл стал недоступен. Открой ссылку руками: ${url}`
    );
  }
  fs.writeFileSync(destPath, buffer);
  return { bytes: buffer.length, contentType };
}

async function main() {
  const fileId = process.argv[2] || process.env.GDRIVE_LATEST_JSON_FILE_ID;
  if (!fileId) {
    console.error('Использование: node scripts/fetch-qa-dashboard-run.js <GDRIVE_LATEST_JSON_FILE_ID>');
    process.exit(1);
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-dashboard-sync-'));
  console.log(`Папка для скачанных файлов: ${outDir}`);

  const { buffer: jsonBuf } = await httpsGet(driveDownloadUrl(fileId));
  const run = JSON.parse(jsonBuf.toString('utf8'));
  console.log(`Прогон ${run.runId}: ${run.totals.passed} passed, ${run.totals.failed} failed, ${run.totals.skipped} skipped`);

  const manifest = { run, localFiles: {} };

  for (const check of run.totals.failingChecks || []) {
    if (check.screenshotUrl) {
      const dest = path.join(outDir, `${check.key}.png`.replace(/[^A-Za-z0-9_.-]/g, '_'));
      try {
        await downloadFile(check.screenshotUrl, dest);
        manifest.localFiles[check.screenshotUrl] = dest;
        console.log(`  screenshot ok: ${check.key} -> ${dest}`);
      } catch (err) {
        console.warn(`  screenshot FAILED: ${check.key}: ${err.message}`);
      }
    }
    if (check.videoUrl) {
      const dest = path.join(outDir, `${check.key}.webm`.replace(/[^A-Za-z0-9_.-]/g, '_'));
      try {
        await downloadFile(check.videoUrl, dest);
        manifest.localFiles[check.videoUrl] = dest;
        console.log(`  video ok: ${check.key} -> ${dest}`);
      } catch (err) {
        console.warn(`  video FAILED: ${check.key}: ${err.message}`);
      }
    }
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nГотово. Манифест: ${manifestPath}`);
  console.log('Дальше (делает Claude, не этот скрипт): upload_asset каждого файла из localFiles,');
  console.log('подставить вернувшиеся /_blob/<id> ссылки вместо driveUrl в run.categories[*].checks[*]');
  console.log('и run.totals.failingChecks[*], затем write_db в коллекции runs/bugs/meta.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
