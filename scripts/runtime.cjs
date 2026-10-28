const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const requireDependency = createRequire(path.join(root, 'apps/server/package.json'));
requireDependency('dotenv').config({ path: [path.join(root, 'apps/server/.env'), path.join(root, '.env')], quiet: true });

function requiredEnv(...names) {
  for (const name of names) if (process.env[name]) return process.env[name];
  throw new Error('必须配置环境变量: ' + names.join(' 或 '));
}
module.exports = { requireDependency, requiredEnv };
