/** Rotate Desktop and cluster credentials together with local env/Kubernetes Secret. */
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { requireDependency, requiredEnv } = require('../runtime.cjs');
const neo4j = requireDependency('neo4j-driver');
const root = path.resolve(__dirname, '../..');
const envFiles = ['.env', 'apps/server/.env'].map(name => path.join(root, name)).filter(file => fs.existsSync(file));
const originals = new Map(envFiles.map(file => [file, fs.readFileSync(file, 'utf8')]));
const user = process.env.NEO4J_USER || 'neo4j';
const desktopUri = process.env.NEO4J_URI;
const clusterUri = 'bolt://localhost:7688';
const desktopOld = requiredEnv('NEO4J_PASSWORD');
const secret = JSON.parse(execFileSync('kubectl', ['get', 'secret', 'medibrain-secret', '-n', 'medibrain', '-o', 'json'], { encoding: 'utf8' }));
const clusterOld = Buffer.from(secret.data.NEO4J_PASSWORD, 'base64').toString('utf8');
const desktopNew = randomBytes(32).toString('base64url');
const clusterNew = randomBytes(32).toString('base64url');
function patchSecret(values) {
  // replace accepts stdin on Windows; fetch the current resourceVersion on
  // every call so rollback cannot overwrite intervening Secret changes.
  const current = JSON.parse(execFileSync('kubectl', ['get', 'secret', 'medibrain-secret', '-n', 'medibrain', '-o', 'json'], { encoding: 'utf8' }));
  current.data = { ...current.data, ...values };
  delete current.metadata.managedFields;
  execFileSync('kubectl', ['replace', '-f', '-'], { input: JSON.stringify(current), encoding: 'utf8' });
  const localSecret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'medibrain-secret', namespace: 'medibrain' }, type: 'Opaque', data: current.data };
  fs.writeFileSync(path.join(root, 'deploy/k8s/secret.local.yaml'), JSON.stringify(localSecret, null, 2) + '\n');
}
async function verify(uri, password) {
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  try { await driver.verifyConnectivity(); await driver.executeQuery('RETURN 1 AS ok'); }
  finally { await driver.close(); }
}
async function change(uri, oldPassword, newPassword) {
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, oldPassword));
  const session = driver.session({ database: 'system' });
  try { await session.run('ALTER CURRENT USER SET PASSWORD FROM $oldPassword TO $newPassword', { oldPassword, newPassword }); }
  finally { await session.close(); await driver.close(); }
}
async function rejected(uri, password) {
  try { await verify(uri, password); return false; }
  catch (error) { if (error.code?.includes('Unauthorized')) return true; throw error; }
}
async function main() {
  let desktopChanged = false, clusterChanged = false;
  try {
    await verify(desktopUri, desktopOld);
    await verify(clusterUri, clusterOld);
    // Save usable new credentials before DB mutations; rollback restores originals.
    for (const [file, original] of originals) {
      let env = original;
      for (const [key, value] of Object.entries({ NEO4J_PASSWORD: desktopNew, DST_PASS: clusterNew })) {
        const regex = new RegExp('^' + key + '=.*$', 'm');
        env = regex.test(env) ? env.replace(regex, key + '=' + value) : env + '\n' + key + '=' + value + '\n';
      }
      fs.writeFileSync(file, env);
    }
    await change(desktopUri, desktopOld, desktopNew); desktopChanged = true;
    await verify(desktopUri, desktopNew);
    await change(clusterUri, clusterOld, clusterNew); clusterChanged = true;
    await verify(clusterUri, clusterNew);
    patchSecret({ NEO4J_PASSWORD: Buffer.from(clusterNew).toString('base64'), NEO4J_AUTH: Buffer.from(user + '/' + clusterNew).toString('base64') });
    if (!(await rejected(desktopUri, desktopOld)) || !(await rejected(clusterUri, clusterOld))) throw new Error('Old credentials still accepted');
    console.log(JSON.stringify({ neo4jPasswordRotation: 'passed', desktop: 'passed', cluster: 'passed', oldPasswordsRejected: true, localEnvAndClusterSecret: 'updated' }));
  } catch (error) {
    if (clusterChanged) await change(clusterUri, clusterNew, clusterOld);
    if (desktopChanged) await change(desktopUri, desktopNew, desktopOld);
    for (const [file, original] of originals) fs.writeFileSync(file, original);
    patchSecret({ NEO4J_PASSWORD: secret.data.NEO4J_PASSWORD, NEO4J_AUTH: secret.data.NEO4J_AUTH });
    throw error;
  }
}
main().catch(error => { console.error(JSON.stringify({ neo4jPasswordRotation: 'failed', code: error.code || error.name })); process.exitCode = 1; });
