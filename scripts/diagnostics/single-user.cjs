/** Verify the deployed single-account flow; remove only owned test users/history. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { requireDependency, requiredEnv } = require('../runtime.cjs');
const { MongoClient, ObjectId } = requireDependency('mongodb');
const base = process.env.SINGLE_USER_BASE_URL || 'http://localhost:8090/api';
const report = { checkedAt: new Date().toISOString(), baseUrl: base, checks: [] };
const reportPath = path.resolve(__dirname, '../../docs/acceptance/single-user-latest.json');

async function main() {
  const mongo = new MongoClient(requiredEnv('MONGO_URI'), { serverSelectionTimeoutMS: 10000 });
  const prefix = 'single-user-' + randomBytes(6).toString('hex');
  const names = [prefix + '-a', prefix + '-b'];
  const invalidName = prefix + '-invalid';
  const ownedNames = [...names, invalidName];
  const ownedIds = [];
  const password = randomBytes(18).toString('base64url');
  let connected = false;
  try {
    await mongo.connect();
    connected = true;
    const call = async (endpoint, token, body, method = body ? 'POST' : 'GET') => {
      const response = await fetch(base + endpoint, {
        method, signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const responseBody = await response.text();
      return { status: response.status, body: responseBody.trim() ? JSON.parse(responseBody) : null };
    };
    const tokens = [];
    for (const username of names) {
      const registration = await call('/auth/register', null, { username, password });
      assert.equal(registration.status, 201);
      const user = await mongo.db().collection('users').findOne({ username });
      ownedIds.push(user._id.toString());
      assert.equal(Object.hasOwn(user, 'role'), false);
      assert.equal(Object.hasOwn(user, 'identity'), false);
      tokens.push(registration.body.token);
      const payload = JSON.parse(Buffer.from(registration.body.token.split('.')[1], 'base64url').toString());
      assert.equal(Object.hasOwn(payload, 'role'), false);
      assert.equal(Object.hasOwn(payload, 'identity'), false);
    }
    report.checks.push('registration-and-token-have-no-classification');
    assert.equal((await call('/auth/register', null, { username: invalidName, password, identity: '患者' })).status, 400);
    // Simulate existing metadata on our own fixture only; password is unchanged.
    await mongo.db().collection('users').updateOne({ username: names[0] }, { $set: { role: 'admin', identity: '医生' } });
    const legacyLogin = await call('/auth/login', null, { username: names[0], password });
    assert.equal(legacyLogin.status, 201);
    assert.equal(Object.hasOwn(legacyLogin.body.user, 'role'), false);
    assert.equal(Object.hasOwn(legacyLogin.body.user, 'identity'), false);
    assert.equal(Object.hasOwn(legacyLogin.body.user, 'password'), false);
    const profile = await call('/auth/profile', tokens[0]);
    assert.deepEqual(Object.keys(profile.body).sort(), ['userId', 'username']);
    report.checks.push('legacy-account-password-compatible-and-metadata-ignored');
    for (const token of [undefined, tokens[0]]) {
      for (const endpoint of ['/users', '/auth/admin-only', '/graph/meta']) {
        assert.equal((await call(endpoint, token)).status, 404);
      }
      for (const method of ['POST', 'PUT', 'DELETE']) {
        assert.equal((await call('/graph/nodes', token, {}, method)).status, 404);
      }
      assert.equal((await call('/chat-test', token, { message: 'test' })).status, 404);
    }
    report.checks.push('management-endpoints-removed-for-all-accounts');
    for (const token of tokens) {
      const answer = await call('/qa/ask', token, { question: '高血压有哪些参考资料' });
      assert.equal(answer.status, 201);
      assert.equal(answer.body.grounding.mode, 'reference-library');
      assert.ok(answer.body.references.length);
    }
    const mine = await call('/history', tokens[0]);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.total, 1);
    assert.ok(mine.body.list.every((record) => record.userId === ownedIds[0]));
    const recordId = mine.body.list[0]._id;
    await mongo.db().collection('qa_records').updateOne({ userId: ownedIds[0] }, { $set: { identity: '患者家属' } });
    assert.equal(Object.hasOwn((await call('/history', tokens[0])).body.list[0], 'identity'), false);
    assert.equal((await call('/history?all=true', tokens[0])).status, 400);
    assert.equal((await call('/history?userId=' + ownedIds[1], tokens[0])).status, 400);
    assert.equal((await call('/history/' + recordId, tokens[1], undefined, 'DELETE')).status, 404);
    assert.ok(await mongo.db().collection('qa_records').findOne({ userId: ownedIds[0] }));
    assert.equal((await call('/history', tokens[0], undefined, 'DELETE')).status, 200);
    assert.equal((await call('/history', tokens[0])).body.total, 0);
    assert.equal((await call('/history', tokens[1])).body.total, 1);
    assert.equal((await call('/conversations', tokens[0])).body.total, 0);
    assert.equal((await call('/conversations', tokens[1])).body.total, 1);
    report.checks.push('history-list-delete-and-clear-are-owner-only');
    assert.equal((await call('/knowledge/stats')).status, 401);
    assert.equal((await call('/knowledge/stats', tokens[0])).status, 200);
    const disease = await call('/qa/disease?name=' + encodeURIComponent('高血压'), tokens[0]);
    assert.equal(disease.status, 200);
    assert.equal(disease.body.disease.name, '高血压');
    report.checks.push('knowledge-and-read-only-disease-graph-available');
    report.status = 'passed';
  } finally {
    try {
      if (connected) {
        const owned = await mongo.db().collection('users').find({ username: { $in: ownedNames } }).project({ _id: 1 }).toArray();
        const ids = [...new Set([...ownedIds, ...owned.map((user) => user._id.toString())])];
        const objectIds = ids.map((id) => new ObjectId(id));
        if (ids.length) {
          await mongo.db().collection('qa_records').deleteMany({ userId: { $in: ids } });
          await mongo.db().collection('qa_conversations').deleteMany({ userId: { $in: ids } });
          await mongo.db().collection('qa_account_locks').deleteMany({ _id: { $in: objectIds } });
          await mongo.db().collection('users').deleteMany({ _id: { $in: objectIds }, username: { $in: ownedNames } });
          assert.equal(await mongo.db().collection('qa_records').countDocuments({ userId: { $in: ids } }), 0);
          assert.equal(await mongo.db().collection('qa_conversations').countDocuments({ userId: { $in: ids } }), 0);
          assert.equal(await mongo.db().collection('qa_account_locks').countDocuments({ _id: { $in: objectIds } }), 0);
        }
        assert.equal(await mongo.db().collection('users').countDocuments({ username: { $in: ownedNames } }), 0);
      }
      report.fixtureCleanup = connected ? 'passed' : 'not-needed';
    } catch (error) {
      report.fixtureCleanup = 'failed';
      throw error;
    } finally { await mongo.close(); }
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
main().catch((error) => {
  report.status = 'failed';
  report.error = error.message;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ singleUserAcceptance: 'failed', message: error.message }));
  process.exitCode = 1;
});
