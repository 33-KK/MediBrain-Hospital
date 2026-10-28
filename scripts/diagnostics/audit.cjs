/** Offline regression checks: fixtures only; loopback HTTP; never load .env. */
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'apps/server/package.json'));
req('reflect-metadata');
const load = (name) => req(path.join(root, 'apps/server/dist', name));
const { Test } = req('@nestjs/testing');
const { ValidationPipe } = req('@nestjs/common');
const { ConfigService } = req('@nestjs/config');
const { JwtService } = req('@nestjs/jwt');
const { getRepositoryToken } = req('@nestjs/typeorm');
const { ObjectId } = req('mongodb');
const { AuthController } = load('auth/auth.controller');
const { AuthService } = load('auth/auth.service');
const { JwtStrategy } = load('auth/jwt.strategy');
const { User } = load('auth/entities/user.entity');
const { HistoryController } = load('history/history.controller');
const { HistoryService } = load('history/history.service');
const { AppController } = load('app.controller');
const { AppService } = load('app.service');
const { LlmGateway } = load('llm/llm.gateway');
const { TtsController } = load('tts/tts.controller');
const { TtsService } = load('tts/tts.service');
const { REDIS_CLIENT } = load('database/redis.module');
const { EntityRecognitionService } = load('entity/entity-recognition.service');
const { QaService } = load('qa/qa.service');
const { EmbeddingService } = load('embedding/embedding.service');
const findings = [];
const record = (id, evidence) => findings.push({ id, evidence });

async function main() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medibrain-audit-'));
  const fixtureFile = path.join(fixtureDir, 'audit-marker.txt');
  const audioDir = path.join(fixtureDir, 'tts-audio');
  fs.mkdirSync(audioDir);
  fs.writeFileSync(fixtureFile, 'AUDIT_FIXTURE_ONLY');
  const tts = new TtsService(new ConfigService({ TTS_CACHE_DIR: audioDir }));
  const users = new Map();
  const ordinary = { _id: new ObjectId(), username: 'audit-user', role: 'user', identity: '普通用户', isActive: true };
  const admin = { _id: new ObjectId(), username: 'audit-admin', role: 'admin', isActive: true };
  users.set(ordinary.username, ordinary);
  users.set(admin.username, admin);
  const userRepo = {
    findOneBy: async ({ username, _id }) => username ? users.get(username) : [...users.values()].find(user => user._id.equals(_id)),
    create: (value) => ({ ...value, _id: new ObjectId() }),
    save: async (user) => { users.set(user.username, user); return user; },
  };
  const historyRepo = {
    findAndCount: async (options) => [[{ userId: options.where?.userId || 'different-user', question: options.where ? 'AUDIT_MY_RECORD' : 'AUDIT_OTHER_USER' }], 1],
    findOneBy: async () => null,
  };
  const history = new HistoryService(historyRepo);
  const config = new ConfigService({ app: { jwtSecret: 'audit-isolated-secret' } });
  const jwt = new JwtService({ secret: 'audit-isolated-secret' });
  const ordinaryToken = jwt.sign({ sub: ordinary._id.toString(), role: 'admin' }); // Legacy claims must be ignored.
  const adminToken = jwt.sign({ sub: admin._id.toString() });
  const validAudio = path.join(audioDir, 'a'.repeat(32) + '.mp3');
  const completeAudio = Buffer.alloc(834);
  completeAudio.writeUInt32BE(0xfffb9000, 0);
  completeAudio.writeUInt32BE(0xfffb9000, 417);
  fs.writeFileSync(validAudio, completeAudio);
  let app;
  try {
    const module = await Test.createTestingModule({
      controllers: [AuthController, HistoryController, AppController, TtsController],
      providers: [
        AuthService, JwtStrategy, AppService,
        { provide: ConfigService, useValue: config },
        { provide: JwtService, useValue: jwt },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: HistoryService, useValue: history },
        { provide: LlmGateway, useValue: { providerName: 'audit', chat: async () => 'AUDIT_MODEL_RESPONSE' } },
        { provide: TtsService, useValue: tts },
        { provide: REDIS_CLIENT, useValue: { eval: async () => [1, 60] } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const http = async (url, token, body) => {
      const response = await fetch(base + url, {
        method: body ? 'POST' : 'GET',
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, text: await response.text() };
    };
    const rejected = await http('/api/auth/register', null, { username: 'audit-new-user', password: 'audit-password', identity: '医生' });
    assert.equal(rejected.status, 400);
    const registered = await http('/api/auth/register', null, { username: 'audit-new-user', password: 'audit-password' });
    assert.equal(registered.status, 201);
    const token = JSON.parse(registered.text).token;
    assert.equal(jwt.decode(token).role, undefined);
    assert.equal(jwt.decode(token).identity, undefined);
    const profile = await http('/api/auth/profile', ordinaryToken);
    assert.equal(profile.status, 200);
    assert.deepEqual(Object.keys(JSON.parse(profile.text)).sort(), ['userId', 'username']);
    record('single-login-without-roles', { rejectedLegacyFields: rejected.status, registerStatus: registered.status });
    users.get('audit-new-user').isActive = false;
    assert.equal((await http('/api/auth/profile', token)).status, 401);
    record('disabled-account-still-rejected', { status: 401 });
    assert.equal((await http('/api/history?all=true', ordinaryToken)).status, 400);
    assert.equal((await http('/api/history?all=true', adminToken)).status, 400);
    const mine = await http('/api/history', ordinaryToken);
    assert.equal(mine.status, 200);
    assert.match(mine.text, /AUDIT_MY_RECORD/);
    record('history-access-control', { ownHistoryStatus: mine.status, legacyAllRejected: true });
    const audio = await http('/api/tts/audio/..%2Faudit-marker.txt', ordinaryToken);
    assert.equal(audio.status, 400);
    assert.doesNotMatch(audio.text, /AUDIT_FIXTURE_ONLY/);
    const safeAudio = await http('/api/tts/audio/' + 'a'.repeat(32) + '.mp3', ordinaryToken);
    assert.equal(safeAudio.status, 200);
    assert.equal(safeAudio.text, completeAudio.toString());
    record('tts-directory-traversal-blocked', { invalidStatus: audio.status, validStatus: safeAudio.status });
    for (const legacy of ['/api/auth/admin-only', '/api/users', '/api/graph/meta']) {
      assert.equal((await http(legacy, adminToken)).status, 404);
    }
    assert.equal((await http('/api/chat-test', adminToken, { message: 'AUDIT_ONLY' })).status, 404);
    record('retired-management-endpoints', { status: 404 });
    assert.equal((await http('/api/history?page=-2&pageSize=1000000', ordinaryToken)).status, 400);
    const validPage = await http('/api/history?page=2&pageSize=10', ordinaryToken);
    assert.equal(validPage.status, 200);
    assert.equal(JSON.parse(validPage.text).page, 2);
    assert.equal(JSON.parse(validPage.text).pageSize, 10);
    record('pagination-validation', { invalidStatus: 400, validStatus: validPage.status });
    let malformed;
    try { await history.remove('invalid-id', 'audit-user'); } catch (err) { malformed = err.getStatus(); }
    assert.equal(malformed, 400);
    record('invalid-history-id', { status: malformed });
  } finally {
    if (app) await app.close();
    // Delete only the two fixed files and the fixture directories created above.
    fs.unlinkSync(fixtureFile);
    fs.unlinkSync(validAudio);
    fs.rmdirSync(audioDir);
    fs.rmdirSync(fixtureDir);
  }

  const entity = new EntityRecognitionService({ loadEntityDictionary: async () => new Map([['高血压', '疾病'], ['布洛芬', '药品']]) });
  await entity.reloadDictionary();
  const intent = entity.analyzeIntent('高血压不能吃什么');
  assert.equal(intent.dimension, '忌吃食物');
  record('negative-diet-intent', { question: '高血压不能吃什么', actual: intent.dimension, expected: '忌吃食物' });
  let neighborsCalled = false;
  const graph = {
    getDiseaseInfo: async () => null,
    getEntityNeighbors: async () => { neighborsCalled = true; return { neighbors: [{ entity: 'AUDIT_DISEASE', relation: '疾病使用药品' }] }; },
  };
  const llm = { providerName: 'audit', chat: async () => { throw new Error('AUDIT_MODEL_OFFLINE'); } };
  const qa = new QaService(graph, entity, llm, { searchCandidates: async () => [] }, { related: async () => [] });
  const drug = await qa.ask('布洛芬用于什么疾病');
  assert.equal(neighborsCalled, true);
  assert.equal(drug.graphMatched, true);
  assert.match(drug.answer, /AUDIT_DISEASE/);
  assert.equal(drug.provider, 'graph');
  record('recognized-drug-neighbors-skipped', { recognized: drug.entities, graphMatched: drug.graphMatched, neighborsCalled });
  const unavailable = new QaService({ getDiseaseInfo: async () => { throw new Error('AUDIT_NEO4J_OFFLINE'); } }, entity, llm, { searchCandidates: async () => [] }, { related: async () => [] });
  const failure = await unavailable.ask('高血压有什么症状');
  assert.equal(failure.knowledgeUnavailable, true);
  assert.match(failure.answer, /暂时不可用/);
  record('neo4j-failure-handled', { knowledgeUnavailable: failure.knowledgeUnavailable });

  const { llmConfig } = load('config/configuration');
  // This process uses synthetic keys only; no .env is loaded by this script.
  process.env.LLM_PROVIDER = 'bailian';
  process.env.DEEPSEEK_API_KEY = 'AUDIT_DEEPSEEK';
  process.env.DEEPSEEK_BASE_URL = 'https://deepseek.invalid';
  process.env.BAILIAN_API_KEY = 'AUDIT_BAILIAN';
  process.env.BAILIAN_BASE_URL = 'https://bailian.invalid';
  delete process.env.LLM_BASE_URL;
  const selected = llmConfig();
  assert.equal(selected.apiKey, 'AUDIT_BAILIAN');
  assert.equal(selected.baseUrl, 'https://bailian.invalid');
  record('bailian-configuration', { provider: selected.provider, selectedBailianKey: true });

  const embedding = new EmbeddingService(new ConfigService());
  embedding.embed = async () => [1, 0];
  let searchOptions;
  embedding.milvus = { search: async (options) => {
    searchOptions = options;
    assert.equal(options.timeout, 5000);
    return { results: [] };
  } };
  await embedding.searchCandidates('AUDIT_ONLY');
  record('milvus-timeout-configured', { timeout: searchOptions.timeout });

  const historySource = fs.readFileSync(path.join(root, 'apps/web/src/views/History.vue'), 'utf8');
  assert.doesNotMatch(historySource, /viewAll|isAdmin|提问身份/);
  record('history-only-current-user-ui', { legacySwitchRemoved: true });
  console.log(JSON.stringify({ mode: 'regression', passed: findings.length, checks: findings }, null, 2));
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
