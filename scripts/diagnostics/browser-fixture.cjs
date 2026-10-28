/** Temporary local browser-test account; never changes an existing user. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { requireDependency, requiredEnv } = require('../runtime.cjs');
const { MongoClient, ObjectId } = requireDependency('mongodb');
const bcrypt = requireDependency('bcryptjs');
const stateFile = path.join(os.tmpdir(), 'medibrain-browser-fixture.json');
async function removeOwnedFixture(mongo, state) {
  if (!/^codex-ui-[a-f0-9]{12}$/.test(state.username) || !/^[a-f\d]{24}$/i.test(state.id)) throw new Error('Invalid fixture ownership state');
  const _id = new ObjectId(state.id);
  const user = await mongo.db().collection('users').findOne({ _id });
  if (user && (user.username !== state.username || user.displayName !== '页面验证临时账号' || !await bcrypt.compare('Codex-UI-Test-2026', user.password))) throw new Error('Fixture ownership mismatch');
  await mongo.db().collection('qa_records').deleteMany({ userId: state.id });
  await mongo.db().collection('qa_conversations').deleteMany({ userId: state.id });
  await mongo.db().collection('qa_account_locks').deleteOne({ _id });
  await mongo.db().collection('users').deleteOne({ _id, username: state.username });
  assert.equal(await mongo.db().collection('qa_records').countDocuments({ userId: state.id }), 0);
  assert.equal(await mongo.db().collection('qa_conversations').countDocuments({ userId: state.id }), 0);
  assert.equal(await mongo.db().collection('qa_account_locks').countDocuments({ _id }), 0);
  assert.equal(await mongo.db().collection('users').countDocuments({ _id }), 0);
}
async function main() {
  const mongo = new MongoClient(requiredEnv('MONGO_URI'));
  try {
    await mongo.connect();
    if (process.argv.includes('--cleanup-interrupted')) {
      const username = 'codex-ui-d16efe756514';
      const user = await mongo.db().collection('users').findOne({ username });
      if (user) {
        await removeOwnedFixture(mongo, { id: user._id.toString(), username });
      }
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        if (state.username === username) fs.unlinkSync(stateFile);
      }
      console.log(JSON.stringify({ interruptedFixtureCleanup: 'passed', removed: Boolean(user) }));
      return;
    }
    if (process.argv.includes('--cleanup')) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      await removeOwnedFixture(mongo, state);
      fs.unlinkSync(stateFile);
      console.log(JSON.stringify({ browserFixtureCleanup: 'passed' }));
      return;
    }
    if (fs.existsSync(stateFile)) throw new Error('Clean up the existing owned fixture first');
    const user = { _id: new ObjectId(), username: 'codex-ui-' + randomBytes(6).toString('hex'), password: await bcrypt.hash('Codex-UI-Test-2026', 12), displayName: '页面验证临时账号', isActive: true, createdAt: new Date() };
    fs.writeFileSync(stateFile, JSON.stringify({ username: user.username, id: user._id.toString() }));
    await mongo.db().collection('users').insertOne(user);
    console.log(JSON.stringify({ browserFixture: 'created', username: user.username }));
  } finally { await mongo.close(); }
}
main().catch(error => { console.error(JSON.stringify({ browserFixture: 'failed', code: error.code || error.name })); process.exitCode = 1; });
