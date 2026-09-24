// Разовый локальный скрипт — НЕ запускается в CI. Нужен один раз, чтобы
// получить refresh token для scripts/upload-report-to-drive.js.
// Запуск: node scripts/get-gdrive-refresh-token.js <client_id> <client_secret>
const { google } = require('googleapis');
const http = require('http');

const CLIENT_ID = process.argv[2];
const CLIENT_SECRET = process.argv[3];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Использование: node scripts/get-gdrive-refresh-token.js <client_id> <client_secret>');
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:3000/oauth2callback';
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // без этого Google не пришлёт refresh_token повторно
  scope: ['https://www.googleapis.com/auth/drive.file'],
});

console.log('\nОткрой эту ссылку в браузере и разреши доступ своему Google-аккаунту:\n');
console.log(authUrl);
console.log('\nЖду ответа...\n');

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.end();
    return;
  }

  const code = new URL(req.url, REDIRECT_URI).searchParams.get('code');
  if (!code) {
    res.end('Код не получен, попробуй ещё раз.');
    return;
  }

  res.end('Готово, можно закрыть эту вкладку и вернуться в терминал.');
  server.close();

  const { tokens } = await oauth2Client.getToken(code);
  console.log('GDRIVE_REFRESH_TOKEN:\n');
  console.log(tokens.refresh_token);
  console.log('\nСохрани это значение в GitHub Secrets как GDRIVE_REFRESH_TOKEN.');
});

server.listen(3000);
