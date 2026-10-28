/** Prepare an ordinary demonstration account. Uses the same login flow as all accounts. */
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const directory = path.join(root, 'data/demo');
const credentialsFile = path.join(directory, 'teacher-credentials.json');
const base = 'http://127.0.0.1:8090/api';

async function call(endpoint, body) {
  const response = await fetch(base + endpoint, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
}

async function main() {
  fs.mkdirSync(directory, { recursive: true });
  const existing = fs.existsSync(credentialsFile);
  const credentials = existing
    ? JSON.parse(fs.readFileSync(credentialsFile, 'utf8'))
    : {
        username: 'teacher-demo-' + randomBytes(4).toString('hex'),
        password: randomBytes(18).toString('base64url'),
        createdAt: new Date().toISOString(),
        status: 'prepared',
      };
  if (!existing) {
    fs.writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2), { flag: 'wx', mode: 0o600 });
  }
  const body = { username: credentials.username, password: credentials.password };
  let login = await call('/auth/login', body);
  if (login.status === 401 && credentials.status === 'prepared') {
    const registration = await call('/auth/register', body);
    if (registration.status !== 201) throw new Error('演示账号创建失败，HTTP ' + registration.status);
    login = await call('/auth/login', body);
  }
  if (login.status !== 201 || login.data.user?.username !== credentials.username) {
    throw new Error('演示账号验证失败，未更改任何现有账号的密码');
  }
  delete credentials.role;
  delete credentials.identity;
  credentials.status = 'ready';
  fs.writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  const instructions = [
    'MediBrain 老师演示账号',
    '用户名：' + credentials.username,
    '密码：' + credentials.password,
    '',
    '请仅将本账号和临时链接发给老师。',
    '临时链接见同目录 teacher-demo-link.txt；电脑和 Docker 需保持运行。',
  ].join('\r\n');
  fs.writeFileSync(path.join(directory, 'teacher-access.txt'), '\ufeff' + instructions, { mode: 0o600 });
  console.log(JSON.stringify({ teacherAccount: 'ready', accessFile: path.join(directory, 'teacher-access.txt') }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
