/** Rotate exposed MongoDB/JWT secrets without putting credentials in argv/logs. */
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { requireDependency } = require('../runtime.cjs');
const { MongoClient } = requireDependency('mongodb');
const root = path.resolve(__dirname, '../..');
const getSecret = () => JSON.parse(execFileSync('kubectl', ['get', 'secret', 'medibrain-secret', '-n', 'medibrain', '-o', 'json'], { encoding: 'utf8' }));
const oldSecret = getSecret();
const oldUri = Buffer.from(oldSecret.data.MONGO_URI, 'base64').toString();
const parsed = new URL(oldUri);
const username = decodeURIComponent(parsed.username);
const authDb = parsed.searchParams.get('authSource') || parsed.pathname.slice(1) || 'admin';
const newPassword = randomBytes(32).toString('base64url');
const newClusterJwt = randomBytes(48).toString('base64url');
const newLocalJwt = randomBytes(48).toString('base64url');
function localUri(uri) { const target = new URL(uri); target.host = 'localhost:27017'; return target.toString(); }
function withPassword(uri, password) { const target = new URL(uri); target.password = password; return target.toString(); }
const newUri = withPassword(oldUri, newPassword);
const files = ['.env', 'apps/server/.env'].map(file => path.join(root, file)).filter(file => fs.existsSync(file));
const originals = new Map(files.map(file => [file, fs.readFileSync(file, 'utf8')]));
async function verify(uri) {
  const client = new MongoClient(localUri(uri), { serverSelectionTimeoutMS: 5000 });
  try { await client.connect(); await client.db().command({ ping: 1 }); }
  finally { await client.close(); }
}
async function change(uri, password) {
  const client = new MongoClient(localUri(uri), { serverSelectionTimeoutMS: 5000 });
  try { await client.connect(); await client.db(authDb).command({ updateUser: username, pwd: password }); }
  finally { await client.close(); }
}
function replaceSecret(data) {
  const current = getSecret();
  current.data = { ...current.data, ...data };
  delete current.metadata.managedFields;
  execFileSync('kubectl', ['replace', '-f', '-'], { input: JSON.stringify(current), encoding: 'utf8' });
}
async function main() {
  let changed = false;
  try {
    await verify(oldUri);
    // Persist new local configuration before changing DB auth; failures rollback.
    for (const [file, original] of originals) {
      let env = original;
      const match = /^MONGO_URI=(.*)$/m.exec(original);
      let mongoUri = match ? match[1].trim().replace(/^(["'])(.*)\1$/, '$2') : localUri(oldUri);
      if (!new URL(mongoUri).username) mongoUri = localUri(oldUri);
      if (decodeURIComponent(new URL(mongoUri).username) !== username) throw new Error('Local and cluster MongoDB user differ');
      for (const [key, value] of Object.entries({ MONGO_URI: withPassword(mongoUri, newPassword), JWT_SECRET: newLocalJwt })) {
        const regex = new RegExp('^' + key + '=.*$', 'm');
        env = regex.test(env) ? env.replace(regex, key + '=' + value) : env + '\n' + key + '=' + value + '\n';
      }
      fs.writeFileSync(file, env);
    }
    await change(oldUri, newPassword); changed = true;
    await verify(newUri);
    replaceSecret({ MONGO_URI: Buffer.from(newUri).toString('base64'), JWT_SECRET: Buffer.from(newClusterJwt).toString('base64') });
    let oldRejected = false;
    try { await verify(oldUri); } catch (error) { if (error.code === 18) oldRejected = true; else throw error; }
    if (!oldRejected) throw new Error('Old MongoDB password still accepted');
    // JSON is valid YAML. Exclude server metadata and obsolete unused API key.
    const current = getSecret();
    delete current.data.LLM_API_KEY;
    if (current.metadata.annotations) delete current.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
    delete current.metadata.managedFields;
    execFileSync('kubectl', ['replace', '-f', '-'], { input: JSON.stringify(current), encoding: 'utf8' });
    const localSecret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'medibrain-secret', namespace: 'medibrain' }, type: 'Opaque', data: current.data };
    fs.writeFileSync(path.join(root, 'deploy/k8s/secret.local.yaml'), JSON.stringify(localSecret, null, 2) + '\n');
    console.log(JSON.stringify({ mongoPasswordRotation: 'passed', oldPasswordRejected: true, jwtRotation: 'passed', localEnvAndClusterSecret: 'updated', localSecretFile: 'deploy/k8s/secret.local.yaml' }));
  } catch (error) {
    if (changed) await change(newUri, decodeURIComponent(parsed.password));
    for (const [file, original] of originals) fs.writeFileSync(file, original);
    replaceSecret({ MONGO_URI: oldSecret.data.MONGO_URI, JWT_SECRET: oldSecret.data.JWT_SECRET });
    throw error;
  }
}
main().catch(error => { console.error(JSON.stringify({ secretRotation: 'failed', code: error.code || error.name })); process.exitCode = 1; });
