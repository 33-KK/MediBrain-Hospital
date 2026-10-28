/** Real MongoDB/Redis in disposable Docker containers; existing Neo4j is read-only. */
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { requireDependency } = require('../runtime.cjs');
requireDependency('reflect-metadata');
const { NestFactory } = requireDependency('@nestjs/core');
const { ValidationPipe } = requireDependency('@nestjs/common');
const { MongoClient } = requireDependency('mongodb');
const containers = [];
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000 }).trim();

function fixture(image, port) {
  const id = docker('run', '--detach', '--rm', '--name', 'medibrain-codex-fixture-' + randomBytes(5).toString('hex'), '--publish', `127.0.0.1:0:${port}`, image);
  assert.match(id, /^[a-f\d]{64}$/);
  containers.push(id);
  return Number(docker('port', id, String(port) + '/tcp').split(':').at(-1));
}

async function main() {
  let app;
  try {
    const mongoPort = fixture('mongo:7', 27017);
    const redisPort = fixture('redis:7-alpine', 6379);
    process.env.MONGO_URI = `mongodb://127.0.0.1:${mongoPort}/medibrain_fixture`;
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(redisPort);
    process.env.REDIS_PASSWORD = '';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
    process.env.EMBEDDING_BASE_URL = 'http://127.0.0.1:1';
    const probe = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
    try { await probe.connect(); await probe.db().command({ ping: 1 }); } finally { await probe.close(); }
    const { AppModule } = require('../../apps/server/dist/app.module');
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    async function call(endpoint, token, body, method = body ? 'POST' : 'GET') {
      const res = await fetch(base + '/api' + endpoint, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const responseBody = await res.text();
      return { status: res.status, body: responseBody.trim() ? JSON.parse(responseBody) : null };
    }
    const reg = await call('/auth/register', null, { username: 'codex-fixture', password: 'fixture-password' });
    assert.equal(reg.status, 201);
    const login = await call('/auth/login', null, { username: 'codex-fixture', password: 'fixture-password' });
    assert.equal(login.status, 201);
    const token = login.body.token;
    assert.equal((await call('/auth/profile', token)).status, 200);
    assert.equal((await call('/history?all=true', token)).status, 400);
    assert.equal((await call('/graph/meta', token)).status, 404);
    const answer = await call('/qa/ask', token, { question: '高血压不能吃什么' });
    assert.equal(answer.status, 201);
    assert.equal(answer.body.dimension, '忌吃食物');
    assert.equal(answer.body.graphMatched, true);
    assert.equal(answer.body.provider, 'graph');
    assert.ok(answer.body.sources.every(source => source.relation === '忌吃食物'));
    const history = await call('/history', token);
    assert.equal(history.status, 200);
    assert.equal(history.body.total, 1);
    const second = await call('/auth/register', null, { username: 'codex-fixture-second', password: 'fixture-password' });
    assert.equal(second.status, 201);
    const secondToken = second.body.token;
    const ownRecord = history.body.list[0];
    assert.equal((await call('/history/' + ownRecord._id, secondToken, undefined, 'DELETE')).status, 404);
    assert.equal((await call('/history', secondToken)).body.total, 0);
    const fixtureMongo = new MongoClient(process.env.MONGO_URI);
    try {
      await fixtureMongo.connect();
      const users = fixtureMongo.db().collection('users');
      await users.updateOne({ username: 'codex-fixture' }, { $set: { role: 'admin', identity: '医生' } });
      const legacyLogin = await call('/auth/login', null, { username: 'codex-fixture', password: 'fixture-password' });
      assert.equal(legacyLogin.status, 201);
      assert.equal(legacyLogin.body.user.role, undefined);
      assert.equal(legacyLogin.body.user.identity, undefined);
      assert.equal(legacyLogin.body.user.password, undefined);
      const profile = await call('/auth/profile', token);
      assert.equal(profile.body.role, undefined);
      assert.equal(profile.body.identity, undefined);
      assert.equal((await call('/users', token)).status, 404);
      assert.equal((await call('/auth/admin-only', token)).status, 404);
      assert.equal((await call('/chat-test', token, { message: 'test' })).status, 404);
      for (const method of ['POST', 'PUT', 'DELETE']) {
        assert.equal((await call('/graph/nodes', token, {}, method)).status, 404);
      }
      await users.updateOne({ username: 'codex-fixture' }, { $set: { isActive: false } });
      assert.equal((await call('/auth/profile', token)).status, 401);
      await users.updateOne({ username: 'codex-fixture' }, { $set: { isActive: true } });
    } finally { await fixtureMongo.close(); }
    await call('/history', token, undefined, 'DELETE');
    assert.equal((await call('/history', token)).body.total, 0);
    assert.equal((await call('/health')).status, 200);
    assert.equal((await call('/health/live')).status, 200);
    assert.equal((await call('/health/ready')).status, 200);
    console.log(JSON.stringify({ liveIntegration: 'passed', register: 'passed', login: 'passed', permissions: 'passed', negativeDietQuestion: 'passed', historyPersistence: 'passed', singleLoginAndHistoryIsolation: 'passed', health: 'passed', paidModelCalls: 0 }));
  } finally {
    if (app) {
      await app.close();
      await app.get(require('../../apps/server/dist/neo4j/neo4j.constants').NEO4J_DRIVER).close();
      await app.get(require('../../apps/server/dist/database/redis.module').REDIS_CLIENT).quit();
    }
    for (const id of containers.reverse()) {
      assert.match(id, /^[a-f\d]{64}$/);
      docker('stop', id);
    }
    console.log(JSON.stringify({ fixtureContainersCleanup: 'passed' }));
  }
}
main().catch(error => {
  console.error(JSON.stringify({
    integration: 'failed',
    errorCode: error.code || error.name,
    assertion: error.code === 'ERR_ASSERTION' ? error.message : undefined,
    syntaxDiagnostic: error instanceof SyntaxError ? error.message : undefined,
    syntaxLocation: error instanceof SyntaxError ? error.stack?.split('\n').slice(1, 4) : undefined,
  }));
  process.exitCode = 1;
});
