/** Idempotent reference-library import. Does not overwrite disease facts or mark clinical review complete. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { requireDependency, requiredEnv } = require('../runtime.cjs');
const neo4j = requireDependency('neo4j-driver');
const root = path.resolve(__dirname, '../..');
const collection = 'official-medical-2026-10';
const json = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const ndjson = (name) => fs.readFileSync(path.join(root, name), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const topics = {
  'nhc-hyperlipidemia-diet-2023': ['高脂血症'], 'nhc-hypertension-diet-2023': ['高血压'],
  'nhc-ckd-diet-2024': ['慢性肾脏病'], 'nhc-stroke-diet-2026': ['脑卒中'],
  'nhc-gout-diet-qa-2024': ['痛风', '高尿酸血症'], 'who-hypertension-zh': ['高血压'],
  'who-diabetes-zh': ['糖尿病', '1型糖尿病', '2型糖尿病'],
  'who-copd-zh': ['慢性阻塞性肺疾病', '慢性阻塞性肺病'],
};
function driverForTarget() {
  if (!process.argv.includes('--kubernetes')) {
    return neo4j.driver(requiredEnv('NEO4J_URI'), neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', requiredEnv('NEO4J_PASSWORD')), { maxTransactionRetryTime: 0 });
  }
  const secret = JSON.parse(execFileSync('kubectl', ['get', 'secret', 'medibrain-secret', '-n', 'medibrain', '-o', 'json', '--request-timeout=10s'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }));
  return neo4j.driver('bolt://localhost:7688', neo4j.auth.basic('neo4j', Buffer.from(secret.data.NEO4J_PASSWORD, 'base64').toString()), { maxTransactionRetryTime: 0 });
}
function prepare() {
  const english = ndjson('data/knowledge-staging/medlineplus-en.ndjson');
  const candidates = json('data/knowledge-staging/priority-diseases.json');
  const catalog = json('docs/knowledge-sources/source-catalog.json').sources;
  const references = json('docs/knowledge-sources/references-latest.json').records;
  const drafts = json('docs/knowledge-sources/chinese-summary-candidates.json').records;
  const pages = ndjson('data/knowledge-staging/reference-pages.ndjson');
  const documents = english.map((item) => {
    if (item.source.recordSha256 !== sha256(item.summary)) throw new Error('English summary checksum mismatch');
    const related = candidates.filter((candidate) => candidate.id === item.id);
    return { id: item.id, title: item.title, kind: 'health-topic', language: 'en', publisher: item.source.publisher,
      url: item.source.topicUrl, version: item.source.datasetDate, attribution: item.source.attribution,
      originalSha256: item.source.sha256, contentSha256: sha256(item.summary), contentText: item.summary,
      topicsZh: related.map((candidate) => candidate.diseaseName), aliases: item.aliases,
      mapping: JSON.stringify(related.map((candidate) => ({ name: candidate.diseaseName, scope: candidate.mappingScope }))),
      mesh: JSON.stringify(item.mesh), contentScope: JSON.stringify(item.contentScope), pageCount: 0,
      reuse: 'Public-domain health-topic summary; retain NLM attribution', fetchedAt: item.source.fetchedAt };
  });
  for (const item of references) {
    if (!['archived', 'metadata-verified'].includes(item.status)) continue;
    const source = catalog.find((entry) => entry.id === item.id);
    if (!source) throw new Error('Missing source catalog entry');
    if (item.status === 'archived') {
      const file = path.resolve(root, item.localFile);
      if (!file.startsWith(root + path.sep) || sha256(fs.readFileSync(file)) !== item.sha256) throw new Error('PDF checksum mismatch');
    }
    const sourcePages = pages.filter((page) => page.documentId === item.id);
    const draft = drafts.find((entry) => entry.sourceId === item.id);
    documents.push({ id: item.id, title: source.title, kind: item.status === 'archived' ? 'dietary-pdf' : 'fact-sheet-link',
      language: 'zh', publisher: source.publisher, url: source.url, version: source.edition || source.sourceUpdatedOn,
      attribution: source.publisher, originalSha256: item.sha256,
      contentSha256: sha256(sourcePages.length ? sourcePages.map((page) => page.sha256).join('\n') : draft?.summaryZhDraft || ''),
      contentText: draft?.summaryZhDraft || '', textKind: draft ? 'adapted-draft' : 'original-page-text',
      topicsZh: topics[item.id] || [], aliases: [], mapping: '[]', mesh: '[]', contentScope: source.clinicalScope,
      pageCount: sourcePages.length, reuse: source.reuse, fetchedAt: item.checkedAt });
  }
  for (const item of documents) {
    const url = new URL(item.url);
    if (url.protocol !== 'https:' || !['medlineplus.gov', 'www.nhc.gov.cn', 'www.who.int'].includes(url.hostname)) throw new Error('Unexpected source URL');
    item.collection = collection;
    item.reviewStatus = 'pending';
    item.publishClinicalFacts = false;
    item.searchText = [item.title, ...item.topicsZh, ...item.aliases, item.contentText,
      ...pages.filter((page) => page.documentId === item.id).map((page) => page.text)].join('\n').toLowerCase();
  }
  if (new Set(documents.map((item) => item.id)).size !== documents.length) throw new Error('Duplicate document ID');
  if (new Set(pages.map((item) => item.id)).size !== pages.length) throw new Error('Duplicate PDF page ID');
  for (const page of pages) {
    const document = documents.find((item) => item.id === page.documentId);
    if (!document || page.sha256 !== sha256(page.text) || page.originalFileSha256 !== document.originalSha256) throw new Error('PDF page integrity mismatch');
  }
  return { documents, pages };
}
async function main() {
  const { documents, pages } = prepare();
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', documents: documents.length, pages: pages.length, clinicalFactWrites: 0 }));
    return;
  }
  const driver = driverForTarget();
  const timestamp = new Date().toISOString();
  const session = driver.session();
  try {
    await driver.verifyConnectivity();
    await session.run('CREATE CONSTRAINT medibrain_knowledge_document_id IF NOT EXISTS FOR (n:_MediBrainKnowledgeDocument) REQUIRE n.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT medibrain_knowledge_page_id IF NOT EXISTS FOR (n:_MediBrainKnowledgePage) REQUIRE n.id IS UNIQUE');
    await session.run('CREATE FULLTEXT INDEX medibrain_knowledge_text IF NOT EXISTS FOR (n:_MediBrainKnowledgeDocument) ON EACH [n.title, n.searchText]');
    const prior = await session.run('MATCH (n) WHERE n:_MediBrainKnowledgeDocument OR n:_MediBrainKnowledgePage RETURN labels(n) AS labels, properties(n) AS properties');
    const backupFile = path.join(root, 'data/backups/knowledge-library-' + timestamp.replace(/[:.]/g, '-') + '.json');
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.writeFileSync(backupFile, JSON.stringify(prior.records.map((record) => ({ labels: record.get('labels'), properties: record.get('properties') }))) + '\n', { flag: 'wx' });
    const before = await session.run('MATCH (n) WHERE n.名称 IS NOT NULL RETURN count(n) AS total');
    let documentCount = 0, pageCount = 0;
    await session.executeWrite(async (tx) => {
      const protectedRows = await tx.run('MATCH (n:_MediBrainKnowledgeDocument) WHERE n.id IN $ids AND n.reviewStatus <> "pending" RETURN count(n) AS count', { ids: documents.map((item) => item.id) });
      if (Number(protectedRows.records[0].get('count')) > 0) throw new Error('Reviewed library records require an explicit update workflow');
      for (let start = 0; start < documents.length; start += 100) {
        const rows = documents.slice(start, start + 100).map((item) => ({ ...item, importedAt: timestamp }));
        const result = await tx.run('UNWIND $rows AS row MERGE (n:_MediBrainKnowledgeDocument {id: row.id}) SET n += row RETURN count(n) AS count', { rows });
        documentCount += Number(result.records[0].get('count'));
      }
      for (let start = 0; start < pages.length; start += 100) {
        const result = await tx.run(`UNWIND $rows AS row MATCH (d:_MediBrainKnowledgeDocument {id: row.documentId})
          MERGE (p:_MediBrainKnowledgePage {id: row.id}) SET p += row, p.collection = $collection
          MERGE (d)-[:_MEDIBRAIN_HAS_PAGE]->(p) RETURN count(p) AS count`, { rows: pages.slice(start, start + 100), collection });
        pageCount += Number(result.records[0].get('count'));
      }
      if (documentCount !== documents.length || pageCount !== pages.length) throw new Error('Incomplete import; rolling back transaction');
    }, { timeout: 60000 });
    await session.run('CALL db.awaitIndexes(60)');
    const after = await session.run('MATCH (n) WHERE n.名称 IS NOT NULL RETURN count(n) AS total');
    if (Number(before.records[0].get('total')) !== Number(after.records[0].get('total'))) throw new Error('Business entity count unexpectedly changed');
    const result = { timestamp, status: 'imported', collection, documents: documentCount, englishSummaries: documents.filter((item) => item.kind === 'health-topic').length,
      chinesePdfs: documents.filter((item) => item.kind === 'dietary-pdf').length, whoReferences: documents.filter((item) => item.kind === 'fact-sheet-link').length,
      pdfPages: pageCount, clinicalFactWrites: 0, clinicalAcceptance: 'pending-professional-review',
      namedBusinessEntitiesBefore: Number(before.records[0].get('total')), namedBusinessEntitiesAfter: Number(after.records[0].get('total')),
      backupFile: path.relative(root, backupFile).replaceAll('\\', '/') };
    fs.writeFileSync(path.join(root, 'docs/knowledge-sources/import-latest.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { await session.close(); await driver.close(); }
}
main().catch((error) => { console.error(JSON.stringify({ importFailed: error.message })); process.exitCode = 1; });
