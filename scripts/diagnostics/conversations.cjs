/** Real deployment acceptance. Writes and removes only random, owned test accounts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { requireDependency, requiredEnv } = require('../runtime.cjs');
const { MongoClient, ObjectId } = requireDependency('mongodb');

const base = (process.env.CONVERSATIONS_BASE_URL || 'http://localhost:8090/api').replace(/\/$/, '');
const reportPath = path.resolve(__dirname, '../../docs/acceptance/conversations-latest.json');
const report = { checkedAt: new Date().toISOString(), baseUrl: base, status: 'running', checks: [], fixtureCleanup: 'not-started' };
const prefix = 'conversation-' + randomBytes(8).toString('hex');
const names = [prefix + '-a', prefix + '-b'];
const password = randomBytes(24).toString('base64url');
const tokens = [];
const ownedIds = new Set();
const conversationPattern = /^[a-f\d]{24}$/i;

function safeMessage(error) {
  let message = String(error instanceof Error ? error.message : error);
  for (const value of [password, ...tokens, process.env.MONGO_URI].filter(Boolean)) message = message.split(value).join('[redacted]');
  return message.replace(/(mongodb(?:\+srv)?:\/\/)[^\s@]+@/gi, '$1[redacted]@').slice(0, 2000);
}

function writeReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}

async function call(endpoint, token, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + endpoint, {
    method,
    signal: AbortSignal.timeout(100_000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload = null;
  if (text.trim()) {
    try { payload = JSON.parse(text); }
    catch { throw new Error(`Non-JSON API response for ${method} ${endpoint}: HTTP ${response.status}`); }
  }
  return { status: response.status, body: payload };
}

async function check(name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    report.checks.push({ name, status: 'passed', durationMs: Date.now() - started, ...(details ? { details } : {}) });
  } catch (error) {
    report.checks.push({ name, status: 'failed', durationMs: Date.now() - started, error: safeMessage(error) });
    throw error;
  }
}

function verifyResponse(result) {
  assert.equal(result.status, 201, 'QA request must succeed');
  const answer = result.body;
  assert.equal(typeof answer.answer, 'string');
  assert.ok(conversationPattern.test(answer.conversationId), 'QA must return a conversation ID');
  assert.ok(conversationPattern.test(answer.recordId), 'QA must return a saved record ID');
  assert.equal(typeof answer.resolvedQuestion, 'string');
  assert.ok(Array.isArray(answer.context?.inheritedEntities), 'QA must return inherited context');
  assert.equal(typeof answer.context.needsClarification, 'boolean');
  assert.ok(Array.isArray(answer.sections), 'QA must return structured answer sections');
  assert.ok(Array.isArray(answer.sources), 'Graph sources must be an array');
  assert.ok(Array.isArray(answer.documentEvidence), 'Document evidence must be an array');
  const allEvidence = [...answer.sources, ...answer.documentEvidence];
  const evidenceIds = new Set(allEvidence.map((source) => source.id));
  const structuredIds = new Set();
  assert.equal(evidenceIds.size, allEvidence.length, 'Evidence IDs must be unique within a response');
  for (const section of answer.sections) {
    assert.equal(typeof section.title, 'string');
    assert.ok(Array.isArray(section.items));
    for (const item of section.items) {
      assert.equal(typeof item.text, 'string');
      assert.ok(Array.isArray(item.sourceIds));
      for (const id of item.sourceIds) {
        assert.ok(evidenceIds.has(id), 'Structured answer refers to missing evidence');
        structuredIds.add(id);
      }
    }
  }
  assert.deepEqual([...structuredIds].sort(), [...evidenceIds].sort(), 'Structured sections must include every displayed fact or excerpt');
  const citations = answer.answer.match(/\[(?:F|D)\d+\]/g) || [];
  for (const citation of citations) assert.ok(evidenceIds.has(citation.slice(1, -1)), 'Answer cites a missing evidence ID');
  return answer;
}

function verifyGraphAnswer(answer, disease) {
  assert.equal(answer.grounding.mode, 'graph-facts');
  assert.equal(answer.context.needsClarification, false);
  assert.ok(answer.sources.length > 0, 'Known disease question needs graph facts');
  assert.equal(answer.documentEvidence.length, 0, 'Graph answers must not relabel documents as graph facts');
  assert.ok(answer.entities.some((entity) => entity.name === disease && entity.type === '疾病'));
  for (const source of answer.sources) {
    assert.ok(/^F\d+$/.test(source.id));
    assert.ok(answer.answer.includes('[' + source.id + ']'), 'Graph evidence must be traceable in answer text');
  }
}

function compareSnapshot(record, answer) {
  assert.equal(record._id, answer.recordId);
  assert.equal(record.conversationId, answer.conversationId);
  assert.ok(record.snapshot, 'Restored history must contain the answer snapshot');
  for (const key of ['answer', 'sources', 'sections', 'documentEvidence', 'grounding', 'resolvedQuestion', 'context']) {
    assert.deepEqual(record.snapshot[key], answer[key], 'Restored snapshot changed ' + key);
  }
  assert.equal(Object.hasOwn(record, 'role'), false);
  assert.equal(Object.hasOwn(record, 'identity'), false);
}

async function main() {
  let mongo;
  let connected = false;
  let failure;
  try {
    mongo = new MongoClient(requiredEnv('MONGO_URI'), { serverSelectionTimeoutMS: 10_000 });
    await mongo.connect();
    connected = true;
    const db = mongo.db();
    await check('register-two-isolated-unclassified-accounts', async () => {
      for (const username of names) {
        const registration = await call('/auth/register', null, { username, password });
        assert.equal(registration.status, 201, 'Test account registration failed');
        const user = await db.collection('users').findOne({ username });
        assert.ok(user, 'Registered test user was not saved');
        ownedIds.add(user._id.toString());
        assert.equal(Object.hasOwn(user, 'role'), false);
        assert.equal(Object.hasOwn(user, 'identity'), false);
        assert.equal(typeof registration.body.token, 'string');
        tokens.push(registration.body.token);
      }
    });

    await check('authentication-and-malformed-id-validation', async () => {
      for (const endpoint of ['/conversations', '/conversations/' + new ObjectId().toString()]) {
        assert.equal((await call(endpoint)).status, 401);
      }
      assert.equal((await call('/qa/ask', null, { question: '高血压有哪些症状？' })).status, 401);
      assert.equal((await call('/conversations/' + new ObjectId().toString(), null, { title: 'test' }, 'PATCH')).status, 401);
      assert.equal((await call('/conversations/not-an-id', tokens[0])).status, 400);
      assert.equal((await call('/conversations/not-an-id', tokens[0], { title: 'test' }, 'PATCH')).status, 400);
      assert.equal((await call('/qa/ask', tokens[0], { question: '饮食呢？', conversationId: 'not-an-id' })).status, 400);
    });

    const answers = [];
    let mainId;
    await check('initial-question-and-disease-follow-up', async () => {
      const first = verifyResponse(await call('/qa/ask', tokens[0], { question: '高血压有哪些症状？' }));
      verifyGraphAnswer(first, '高血压');
      assert.deepEqual(first.context.inheritedEntities, []);
      mainId = first.conversationId;
      answers.push(first);
      const followUp = verifyResponse(await call('/qa/ask', tokens[0], { question: '饮食呢？', conversationId: mainId }));
      verifyGraphAnswer(followUp, '高血压');
      assert.ok(followUp.context.inheritedEntities.includes('高血压'));
      assert.ok(followUp.resolvedQuestion.includes('高血压'));
      assert.equal(followUp.conversationId, mainId);
      answers.push(followUp);
    });

    await check('explicit-disease-replaces-previous-context', async () => {
      const changed = verifyResponse(await call('/qa/ask', tokens[0], { question: '糖尿病有哪些症状？', conversationId: mainId }));
      verifyGraphAnswer(changed, '糖尿病');
      assert.deepEqual(changed.context.inheritedEntities, []);
      assert.equal(changed.entities.some((entity) => entity.name === '高血压'), false);
      answers.push(changed);
      const followUp = verifyResponse(await call('/qa/ask', tokens[0], { question: '需要做哪些检查？', conversationId: mainId }));
      verifyGraphAnswer(followUp, '糖尿病');
      assert.ok(followUp.context.inheritedEntities.includes('糖尿病'));
      assert.equal(followUp.context.inheritedEntities.includes('高血压'), false);
      assert.ok(followUp.resolvedQuestion.includes('糖尿病'));
      answers.push(followUp);
    });

    await check('restore-original-answer-evidence-and-order', async () => {
      const restored = await call('/conversations/' + mainId, tokens[0]);
      assert.equal(restored.status, 200);
      assert.equal(restored.body.conversation._id, mainId);
      assert.equal(restored.body.records.length, answers.length);
      restored.body.records.forEach((record, index) => compareSnapshot(record, answers[index]));
      const listing = await call('/conversations?page=1&pageSize=20', tokens[0]);
      assert.equal(listing.status, 200);
      assert.equal(listing.body.page, 1);
      assert.equal(listing.body.pageSize, 20);
      assert.equal(listing.body.total, 1);
      assert.equal(listing.body.list[0]._id, mainId);
    });

    await check('conversation-owner-isolation-and-rename-validation', async () => {
      assert.equal((await call('/conversations/' + mainId, tokens[1])).status, 404);
      assert.equal((await call('/conversations/' + mainId, tokens[1], { title: 'other user' }, 'PATCH')).status, 404);
      assert.equal((await call('/qa/ask', tokens[1], { question: '饮食呢？', conversationId: mainId })).status, 404);
      const otherList = await call('/conversations', tokens[1]);
      assert.equal(otherList.status, 200);
      assert.equal(otherList.body.total, 0);
      for (const title of ['   ', 'x'.repeat(81), 42]) {
        assert.equal((await call('/conversations/' + mainId, tokens[0], { title }, 'PATCH')).status, 400);
      }
      assert.equal((await call('/conversations/' + mainId, tokens[0], { title: 'x'.repeat(80) }, 'PATCH')).status, 200);
      const renamed = await call('/conversations/' + mainId, tokens[0], { title: '  血压与血糖随访  ' }, 'PATCH');
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.title, '血压与血糖随访');
      const refreshed = await call('/conversations/' + mainId, tokens[0]);
      assert.equal(refreshed.body.conversation.title, '血压与血糖随访');
    });

    await check('omitted-id-creates-a-new-conversation', async () => {
      const fresh = verifyResponse(await call('/qa/ask', tokens[0], { question: '高血压有哪些参考资料？' }));
      assert.notEqual(fresh.conversationId, mainId);
      assert.deepEqual(fresh.context.inheritedEntities, []);
      const listed = await call('/conversations', tokens[0]);
      assert.equal(listed.body.total, 2);
    });

    await check('ambiguous-multiple-diseases-require-clarification', async () => {
      const multiple = verifyResponse(await call('/qa/ask', tokens[1], { question: '高血压和糖尿病有哪些症状？' }));
      const followUp = verifyResponse(await call('/qa/ask', tokens[1], { question: '饮食呢？', conversationId: multiple.conversationId }));
      assert.equal(followUp.context.needsClarification, true);
      assert.deepEqual(followUp.context.inheritedEntities, []);
      assert.equal(followUp.sources.length, 0, 'Ambiguous context cannot silently select a disease');
      assert.equal(followUp.documentEvidence.length, 0);
    });

    let document;
    let otherDocument;
    let documentAnswer;
    await check('document-selection-and-excerpt-grounded-answer', async () => {
      const documents = await call('/knowledge/documents?kw=' + encodeURIComponent('高血压') + '&pageSize=20', tokens[0]);
      assert.equal(documents.status, 200);
      document = documents.body.list.find((item) => item.kind === 'dietary-pdf');
      assert.ok(document, 'The deployed library must contain the hypertension dietary PDF');
      otherDocument = documents.body.list.find((item) => item.id !== document.id);
      if (!otherDocument) {
        const otherList = await call('/knowledge/documents?pageSize=20', tokens[0]);
        assert.equal(otherList.status, 200);
        otherDocument = otherList.body.list.find((item) => item.id !== document.id);
      }
      assert.ok(otherDocument, 'Need a different real document to verify a locked document session');
      documentAnswer = verifyResponse(await call('/qa/ask', tokens[0], { question: '食盐摄入有哪些建议？', documentId: document.id }));
      assert.equal(documentAnswer.grounding.mode, 'document-excerpts');
      assert.equal(documentAnswer.graphMatched, false);
      assert.deepEqual(documentAnswer.sources, [], 'Original document quotations cannot become graph facts');
      assert.ok(documentAnswer.documentEvidence.length > 0, 'Document question must retrieve original excerpts');
      for (const item of documentAnswer.documentEvidence) {
        assert.equal(item.documentId, document.id);
        assert.ok(/^D\d+$/.test(item.id));
        assert.ok(Number.isInteger(item.page) && item.page > 0);
        assert.ok(Number.isInteger(item.paragraph) && item.paragraph > 0);
        assert.ok(item.text.trim());
        assert.equal(typeof item.title, 'string');
        assert.equal(typeof item.textKind, 'string');
        assert.equal(typeof item.language, 'string');
        assert.ok(/^https?:\/\//.test(item.url));
        assert.ok(/^[a-f\d]{64}$/i.test(item.originalSha256));
        assert.ok(documentAnswer.answer.includes('[' + item.id + ']'));
      }
      return { evidenceCount: documentAnswer.documentEvidence.length };
    });

    await check('every-document-citation-resolves-to-the-original-page-and-paragraph', async () => {
      const pages = new Map();
      for (const evidence of documentAnswer.documentEvidence) {
        if (!pages.has(evidence.page)) {
          const page = await call('/knowledge/documents/' + encodeURIComponent(document.id) + '?page=' + evidence.page, tokens[0]);
          assert.equal(page.status, 200);
          assert.ok(Array.isArray(page.body.paragraphs));
          pages.set(evidence.page, page.body);
        }
        const page = pages.get(evidence.page);
        assert.equal(page.originalSha256, evidence.originalSha256);
        const paragraph = page.paragraphs.find((item) => item.paragraph === evidence.paragraph);
        assert.ok(paragraph, 'Cited paragraph must exist on the cited page');
        assert.equal(paragraph.text, evidence.text, 'Citation must preserve the original paragraph text');
      }
      const restored = await call('/conversations/' + documentAnswer.conversationId, tokens[0]);
      assert.equal(restored.status, 200);
      assert.equal(restored.body.conversation.documentId, document.id);
      assert.equal(restored.body.records.length, 1);
      compareSnapshot(restored.body.records[0], documentAnswer);
    });

    await check('document-session-is-fixed-and-irrelevant-question-has-no-evidence', async () => {
      assert.equal((await call('/qa/ask', tokens[0], { question: '食盐摄入有哪些建议？', conversationId: documentAnswer.conversationId, documentId: otherDocument.id })).status, 400);
      const unrelated = verifyResponse(await call('/qa/ask', tokens[0], { question: '法国首都在哪里？', conversationId: documentAnswer.conversationId }));
      assert.equal(unrelated.grounding.mode, 'document-excerpts');
      assert.deepEqual(unrelated.sources, []);
      assert.deepEqual(unrelated.documentEvidence, [], 'Irrelevant questions must not receive medical excerpts');
      assert.equal(unrelated.graphMatched, false);
    });

    await check('history-and-conversation-lists-remain-owner-only-without-classification', async () => {
      for (let index = 0; index < tokens.length; index++) {
        const user = await db.collection('users').findOne({ username: names[index] });
        const history = await call('/history?pageSize=100', tokens[index]);
        assert.equal(history.status, 200);
        assert.ok(history.body.total > 0);
        for (const record of history.body.list) {
          assert.equal(record.userId, user._id.toString());
          assert.equal(Object.hasOwn(record, 'role'), false);
          assert.equal(Object.hasOwn(record, 'identity'), false);
        }
        const conversationList = await call('/conversations?pageSize=100', tokens[index]);
        assert.equal(conversationList.status, 200);
        const ownConversationIds = new Set((await db.collection('qa_conversations').find({ userId: user._id.toString() }).project({ _id: 1 }).toArray()).map((item) => item._id.toString()));
        assert.equal(conversationList.body.total, ownConversationIds.size);
        assert.ok(conversationList.body.list.every((item) => ownConversationIds.has(item._id)));
      }
      assert.equal((await call('/history?all=true', tokens[0])).status, 400);
      assert.equal((await call('/conversations?userId=' + [...ownedIds][1], tokens[0])).status, 400);
    });

    await check('owned-active-account-lease-rejects-parallel-qa-and-clear-without-blocking-another-account', async () => {
      const _id = new ObjectId([...ownedIds][0]);
      const leaseToken = 'acceptance-' + randomBytes(18).toString('hex');
      const beforeRecords = await db.collection('qa_records').countDocuments({ userId: _id.toString() });
      const beforeConversations = await db.collection('qa_conversations').countDocuments({ userId: _id.toString() });
      await db.collection('qa_account_locks').insertOne({ _id, leaseToken, leaseUntil: new Date(Date.now() + 180_000) });
      try {
        // A controlled owned lease makes the conflict check deterministic even on a fast model.
        const outcomes = await Promise.allSettled([
          call('/qa/ask', tokens[0], { question: '高血压有哪些参考资料？' }),
          call('/qa/ask', tokens[0], { question: '饮食呢？', conversationId: mainId }),
          call('/history', tokens[0], undefined, 'DELETE'),
          call('/qa/ask', tokens[1], { question: '高血压有哪些参考资料？' }),
        ]);
        for (const outcome of outcomes) assert.equal(outcome.status, 'fulfilled', 'Concurrent acceptance request failed to finish');
        for (const outcome of outcomes.slice(0, 3)) assert.equal(outcome.value.status, 409);
        verifyResponse(outcomes[3].value);
        assert.equal(await db.collection('qa_records').countDocuments({ userId: _id.toString() }), beforeRecords);
        assert.equal(await db.collection('qa_conversations').countDocuments({ userId: _id.toString() }), beforeConversations);
      } finally {
        await db.collection('qa_account_locks').deleteOne({ _id, leaseToken });
      }
    });

    await check('expired-owned-account-lease-can-be-reclaimed', async () => {
      const _id = new ObjectId([...ownedIds][0]);
      const leaseToken = 'expired-acceptance-' + randomBytes(18).toString('hex');
      await db.collection('qa_account_locks').insertOne({ _id, leaseToken, leaseUntil: new Date(Date.now() - 60_000) });
      try {
        verifyResponse(await call('/qa/ask', tokens[0], { question: '高血压有哪些参考资料？' }));
        assert.equal(await db.collection('qa_account_locks').countDocuments({ _id }), 0, 'Completed operation must release the reclaimed lease');
      } finally {
        await db.collection('qa_account_locks').deleteOne({ _id, leaseToken });
      }
    });

    await check('clear-own-history-removes-own-conversations-and-preserves-other-account', async () => {
      const otherHistory = await call('/history?pageSize=100', tokens[1]);
      const otherConversations = await call('/conversations?pageSize=100', tokens[1]);
      assert.equal((await call('/history', tokens[0], undefined, 'DELETE')).status, 200);
      assert.equal((await call('/history', tokens[0])).body.total, 0);
      assert.equal((await call('/conversations', tokens[0])).body.total, 0);
      assert.equal((await call('/conversations/' + mainId, tokens[0])).status, 404);
      assert.equal((await call('/qa/ask', tokens[0], { question: '饮食呢？', conversationId: mainId })).status, 404);
      assert.equal((await call('/history?pageSize=100', tokens[1])).body.total, otherHistory.body.total);
      assert.equal((await call('/conversations?pageSize=100', tokens[1])).body.total, otherConversations.body.total);
      assert.equal(await db.collection('qa_records').countDocuments({ userId: [...ownedIds][0] }), 0);
      assert.equal(await db.collection('qa_conversations').countDocuments({ userId: [...ownedIds][0] }), 0);
    });
    report.status = 'passed';
  } catch (error) {
    failure = error;
    report.status = 'failed';
    report.error = safeMessage(error);
  } finally {
    if (connected) {
      try {
        // Recover IDs even when registration saved a fixture but the HTTP response failed.
        const fixtures = await mongo.db().collection('users').find({ username: { $in: names } }).project({ _id: 1, username: 1 }).toArray();
        for (const fixture of fixtures) {
          assert.ok(names.includes(fixture.username), 'Refuse cleanup outside exact owned usernames');
          ownedIds.add(fixture._id.toString());
        }
        const ids = [...ownedIds];
        const records = ids.length ? await mongo.db().collection('qa_records').deleteMany({ userId: { $in: ids } }) : { deletedCount: 0 };
        const conversations = ids.length ? await mongo.db().collection('qa_conversations').deleteMany({ userId: { $in: ids } }) : { deletedCount: 0 };
        const locks = ids.length ? await mongo.db().collection('qa_account_locks').deleteMany({ _id: { $in: ids.map((id) => new ObjectId(id)) } }) : { deletedCount: 0 };
        const users = ids.length ? await mongo.db().collection('users').deleteMany({ _id: { $in: ids.map((id) => new ObjectId(id)) }, username: { $in: names } }) : { deletedCount: 0 };
        assert.equal(await mongo.db().collection('users').countDocuments({ username: { $in: names } }), 0);
        if (ids.length) {
          assert.equal(await mongo.db().collection('qa_records').countDocuments({ userId: { $in: ids } }), 0);
          assert.equal(await mongo.db().collection('qa_conversations').countDocuments({ userId: { $in: ids } }), 0);
          assert.equal(await mongo.db().collection('qa_account_locks').countDocuments({ _id: { $in: ids.map((id) => new ObjectId(id)) } }), 0);
        }
        report.fixtureCleanup = { status: 'passed', users: users.deletedCount, records: records.deletedCount, conversations: conversations.deletedCount, locks: locks.deletedCount };
      } catch (error) {
        report.fixtureCleanup = { status: 'failed', error: safeMessage(error) };
        report.status = 'failed';
        failure ||= error;
      }
    } else report.fixtureCleanup = 'not-needed-database-not-connected';
    if (mongo) {
      try { await mongo.close(); }
      catch (error) {
        report.status = 'failed';
        report.databaseCloseError = safeMessage(error);
        failure ||= error;
      }
    }
    report.completedAt = new Date().toISOString();
    writeReport();
    console.log(JSON.stringify(report));
    if (failure) process.exitCode = 1;
  }
}

main().catch((error) => {
  report.status = 'failed';
  report.error = safeMessage(error);
  report.completedAt = new Date().toISOString();
  try { writeReport(); } catch { /* Exit remains nonzero even if the report directory is unwritable. */ }
  console.error(JSON.stringify({ conversationAcceptance: 'failed', message: safeMessage(error) }));
  process.exitCode = 1;
});
