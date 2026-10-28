/** Live reference-library acceptance. Removes only the temporary user/history it creates. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { requireDependency, requiredEnv } = require('../runtime.cjs');
const { MongoClient, ObjectId } = requireDependency('mongodb');
const root = path.resolve(__dirname, '../..');
const base = process.env.KNOWLEDGE_BASE_URL || 'http://localhost:8090/api';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const report = { checkedAt: new Date().toISOString(), baseUrl: base, checks: [] };
async function main() {
  const mongo = new MongoClient(requiredEnv('MONGO_URI'), { serverSelectionTimeoutMS: 10000 });
  const username = 'codex-library-' + randomBytes(6).toString('hex');
  let userId, connected = false;
  try {
    await mongo.connect();
    connected = true;
    async function call(endpoint, token, body) {
      const start = Date.now();
      const res = await fetch(base + endpoint, {
        method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: await res.json(), elapsedMs: Date.now() - start };
    }
    const password = randomBytes(24).toString('base64url');
    const registration = await call('/auth/register', null, { username, password });
    assert.equal(registration.status, 201);
    userId = (await mongo.db().collection('users').findOne({ username }))._id.toString();
    const token = registration.data.token;
    assert.equal((await call('/knowledge/stats')).status, 401);
    const stats = await call('/knowledge/stats', token);
    assert.equal(stats.status, 200);
    assert.deepEqual(stats.data, { documents: 1024, englishSummaries: 1016, chinesePdfs: 5, whoReferences: 3, pdfPages: 284 });
    report.stats = stats.data;
    report.checks.push({ name: 'authenticated-statistics', elapsedMs: stats.elapsedMs });

    const search = await call('/knowledge/documents?kw=' + encodeURIComponent('高血压'), token);
    assert.equal(search.status, 200);
    assert.ok(search.data.list.some((item) => item.id === 'nhc-hypertension-diet-2023'));
    assert.ok(search.data.list.some((item) => item.id === 'who-hypertension-zh'));
    assert.ok(search.data.list.every((item) => item.reviewStatus === 'pending'));
    assert.equal((await call('/knowledge/documents?page=0', token)).status, 400);
    assert.equal((await call('/knowledge/documents?kw=' + encodeURIComponent('" OR *'), token)).status, 200);
    report.checks.push({ name: 'chinese-search-and-query-validation', results: search.data.total, elapsedMs: search.elapsedMs });

    const english = await call('/knowledge/documents?kw=Asthma', token);
    assert.equal(english.status, 200);
    const topic = english.data.list.find((item) => item.title === 'Asthma');
    assert.ok(topic);
    const detail = await call('/knowledge/documents/' + encodeURIComponent(topic.id), token);
    const source = fs.readFileSync(path.join(root, 'data/knowledge-staging/medlineplus-en.ndjson'), 'utf8').trim().split(/\r?\n/).map(JSON.parse).find((item) => item.id === topic.id);
    assert.equal(detail.status, 200);
    assert.equal(sha256(detail.data.contentText), source.source.recordSha256);
    report.checks.push({ name: 'english-summary-original-checksum', elapsedMs: detail.elapsedMs });

    const pages = fs.readFileSync(path.join(root, 'data/knowledge-staging/reference-pages.ndjson'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    for (const page of [1, 109]) {
      const pdf = await call('/knowledge/documents/nhc-stroke-diet-2026?page=' + page, token);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.data.pageCount, 109);
      assert.equal(pdf.data.page, page);
      assert.equal(sha256(pdf.data.contentText), pages.find((item) => item.documentId === 'nhc-stroke-diet-2026' && item.pageNumber === page).sha256);
    }
    assert.equal((await call('/knowledge/documents/nhc-stroke-diet-2026?page=110', token)).status, 404);
    assert.equal((await call('/knowledge/documents/no-such-document', token)).status, 404);
    const draft = await call('/knowledge/documents/who-diabetes-zh', token);
    assert.equal(draft.status, 200);
    assert.equal(draft.data.textKind, 'adapted-draft');
    assert.equal(draft.data.reviewStatus, 'pending');
    report.checks.push({ name: 'pdf-page-integrity-and-draft-labels' });

    const answer = await call('/qa/ask', token, { question: '脑卒中有哪些食养指南' });
    assert.equal(answer.status, 201);
    assert.equal(answer.data.grounding.mode, 'reference-library');
    assert.equal(answer.data.provider, 'knowledge-library');
    assert.ok(answer.data.references.some((item) => item.id === 'nhc-stroke-diet-2026'));
    assert.deepEqual(answer.data.sources, []);
    assert.equal(answer.data.graphMatched, false);
    report.checks.push({ name: 'qa-reference-cards-without-generated-clinical-facts', elapsedMs: answer.elapsedMs });

    const clinical = await call('/qa/ask', token, { question: '高血压不能吃什么' });
    assert.equal(clinical.status, 201);
    assert.equal(clinical.data.grounding.mode, 'graph-facts');
    assert.equal(clinical.data.graphMatched, true);
    assert.ok(['ollama', 'graph'].includes(clinical.data.provider));
    assert.ok(clinical.data.sources.length > 0);
    for (const source of clinical.data.sources) {
      assert.equal(source.relation, '忌吃食物');
      assert.ok(clinical.data.answer.includes(`${source.text} [${source.id}]`));
    }
    assert.ok(clinical.data.references.some((item) => item.id === 'nhc-hypertension-diet-2023'));
    report.checks.push({ name: 'clinical-answers-keep-original-graph-facts-with-related-references', elapsedMs: clinical.elapsedMs });
    report.status = 'passed';
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
      }
      report.fixtureCleanup = connected ? 'passed' : 'not-needed';
    } catch (error) {
      report.fixtureCleanup = 'failed';
      throw error;
    } finally { await mongo.close(); }
  }
  fs.writeFileSync(path.join(root, 'docs/knowledge-sources/acceptance-latest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
main().catch((error) => { console.error(JSON.stringify({ knowledgeAcceptance: 'failed', diagnostic: error.message })); process.exitCode = 1; });
