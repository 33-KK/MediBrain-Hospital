/** Actual deployed API/model/TTS smoke test; deletes only its own user/history. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { requireDependency, requiredEnv } = require('../runtime.cjs');
const { MongoClient, ObjectId } = requireDependency('mongodb');
const { EmbeddingService } = require('../../apps/server/dist/embedding/embedding.service');
const { ConfigService } = requireDependency('@nestjs/config');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8090/api';
async function main() {
  const mongo = new MongoClient(requiredEnv('MONGO_URI'));
  const username = 'codex-smoke-' + randomBytes(6).toString('hex');
  let userId, embedding, connected = false;
  try {
    await mongo.connect();
    connected = true;
    async function call(endpoint, token, body, method = body ? 'POST' : 'GET') {
      const res = await fetch(base + endpoint, {
        method, signal: AbortSignal.timeout(95_000),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const responseBody = await res.text();
      return { status: res.status, body: responseBody.trim() ? JSON.parse(responseBody) : null };
    }
    const password = randomBytes(24).toString('base64url');
    const reg = await call('/auth/register', null, { username, password });
    assert.equal(reg.status, 201);
    userId = (await mongo.db().collection('users').findOne({ username }))._id.toString();
    const login = await call('/auth/login', null, { username, password });
    assert.equal(login.status, 201);
    const token = login.body.token;
    assert.equal((await call('/history?all=true', token)).status, 400);
    const health = await call('/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    console.log(JSON.stringify({ liveHealth: health.body }));
    const start = Date.now();
    const answer = await call('/qa/ask', token, { question: '高血压不能吃什么' });
    assert.equal(answer.status, 201);
    assert.equal(answer.body.dimension, '忌吃食物');
    assert.equal(answer.body.graphMatched, true);
    assert.ok(['ollama', 'graph'].includes(answer.body.provider));
    assert.equal(answer.body.grounding.mode, 'graph-facts');
    for (const source of answer.body.sources) assert.ok(answer.body.answer.includes(`${source.text} [${source.id}]`));
    assert.ok(answer.body.answer.trim().length > 20);
    assert.ok(answer.body.sources.every(source => source.relation === '忌吃食物'));
    console.log(JSON.stringify({ actualQa: 'passed', provider: answer.body.provider, dimension: answer.body.dimension, sources: answer.body.sources.length, elapsedMs: Date.now() - start }));
    const history = await call('/history', token);
    assert.equal(history.body.total, 1);
    embedding = new EmbeddingService(new ConfigService({ embedding: { model: 'bge-m3', baseUrl: 'http://localhost:11434', milvusUri: 'localhost:19540', collection: 'entities', threshold: 0.6, topK: 5 } }));
    const vector = await embedding.embed('语义检索连接测试');
    assert.equal(vector.length, 1024);
    const candidates = await embedding.searchCandidates('血压偏高的人饮食应注意什么');
    assert.ok(candidates.length);
    console.log(JSON.stringify({ actualEmbedding: 'passed', dimensions: vector.length, semanticCandidates: candidates.length }));
    for (const route of ['/users', '/graph/meta', '/auth/admin-only']) {
      assert.equal((await call(route, token)).status, 404);
    }
    console.log(JSON.stringify({ retiredManagementRoutes: 'passed', historyPersistence: 'passed' }));
    const audio = await fetch(base + '/tts/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ text: '语音功能连接测试。' }), signal: AbortSignal.timeout(70_000) });
    if (audio.status !== 201) {
      const error = await audio.json();
      throw new Error('TTS failed: ' + error.message);
    }
    assert.match(audio.headers.get('content-type'), /^audio\/mpeg/);
    const bytes = Buffer.from(await audio.arrayBuffer());
    assert.ok(bytes.length > 1000);
    const file = path.join(os.tmpdir(), 'medibrain-tts-smoke-' + randomBytes(4).toString('hex') + '.mp3');
    fs.writeFileSync(file, bytes);
    console.log(JSON.stringify({ actualTts: 'passed', bytes: bytes.length, sample: file }));
    console.log(JSON.stringify({ deployedSmoke: 'passed', paidModelCalls: 0 }));
  } finally {
    try {
      if (embedding) await embedding.onModuleDestroy();
    } finally {
      try {
        if (connected) {
          const owned = await mongo.db().collection('users').findOne({ username });
          if (owned) {
            if (userId) assert.equal(owned._id.toString(), userId, 'Fixture ownership mismatch');
            userId = owned._id.toString();
          }
          if (userId) {
            const _id = new ObjectId(userId);
            await mongo.db().collection('qa_records').deleteMany({ userId });
            await mongo.db().collection('qa_conversations').deleteMany({ userId });
            await mongo.db().collection('qa_account_locks').deleteOne({ _id });
            await mongo.db().collection('users').deleteOne({ _id, username });
            assert.equal(await mongo.db().collection('qa_records').countDocuments({ userId }), 0);
            assert.equal(await mongo.db().collection('qa_conversations').countDocuments({ userId }), 0);
            assert.equal(await mongo.db().collection('qa_account_locks').countDocuments({ _id }), 0);
            assert.equal(await mongo.db().collection('users').countDocuments({ _id }), 0);
          }
          console.log(JSON.stringify({ ownedSmokeFixtureCleanup: 'passed' }));
        }
      } finally { await mongo.close(); }
    }
  }
}
main().catch(error => { console.error(JSON.stringify({ deployedSmoke: 'failed', diagnostic: error.message })); process.exitCode = 1; });
