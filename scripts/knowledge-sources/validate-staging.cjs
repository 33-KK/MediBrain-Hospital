/** Validate the actual downloaded review package; no database connection or application import. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const json = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const withinRoot = (relative) => {
  const resolved = path.resolve(root, relative);
  assert.ok(resolved.startsWith(root + path.sep), 'Artifact must stay in the workspace');
  return resolved;
};
const report = json('docs/knowledge-sources/collection-latest.json');
const references = json('docs/knowledge-sources/references-latest.json');
const pdfs = json('docs/knowledge-sources/pdf-inspection-latest.json');
const catalog = json('docs/knowledge-sources/source-catalog.json');
const records = fs.readFileSync(path.join(root, 'data/knowledge-staging/medlineplus-en.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const candidates = json('data/knowledge-staging/priority-diseases.json');
const chinese = json('docs/knowledge-sources/chinese-summary-candidates.json').records;
const byId = new Map(records.map((record) => [record.id, record]));
assert.equal(byId.size, records.length, 'Topic IDs must be unique');
assert.equal(records.length, report.englishSummariesCollected);
assert.equal(records.length + report.excludedEnglishTopics.length, report.languages.English);
assert.equal(candidates.length, report.priorityCandidates);
assert.equal(candidates.length, 20, 'All 20 priority proposals should have a source');
assert.equal(new Set(candidates.map((record) => record.diseaseName)).size, candidates.length);
assert.equal(sha256(fs.readFileSync(path.join(root, 'data/external/medlineplus', report.datasetDate, 'health-topics.xml'))), report.downloadSha256);
for (const record of [...records, ...candidates]) {
  assert.ok(record.summary.trim());
  assert.equal(record.source.recordSha256, sha256(record.summary));
  assert.equal(record.source.sha256, report.downloadSha256);
  assert.equal(new URL(record.source.topicUrl).hostname, 'medlineplus.gov');
  assert.equal(record.publishToQa, false);
  assert.equal(record.review.status, 'pending');
  assert.ok(record.review.required.includes('clinical-applicability'));
  assert.equal(record.contentScope.relatedTopicsAreClinicalRelations, false);
}
for (const record of candidates) {
  assert.equal(record.summary, byId.get(record.id)?.summary, 'Candidate must retain the original source text');
  assert.equal(record.summaryZh, null, 'Unreviewed English text must not masquerade as a Chinese translation');
}
for (const record of chinese) {
  const source = catalog.sources.find((item) => item.id === record.sourceId);
  assert.equal(record.sourceUrl, source?.url);
  assert.equal(record.sourceUpdatedOn, source?.sourceUpdatedOn);
  assert.ok(references.records.some((item) => item.id === record.sourceId && item.status === 'metadata-verified'));
  assert.equal(record.review.status, 'pending');
  assert.equal(record.publishToQa, false);
}
for (const record of references.records.filter((item) => item.status === 'archived')) {
  assert.equal(sha256(fs.readFileSync(withinRoot(record.localFile))), record.sha256);
  const inspection = pdfs.records.find((item) => item.id === record.id);
  assert.equal(inspection?.sha256, record.sha256);
  assert.equal(inspection?.titleAndEditionVerified, true);
  assert.equal(inspection?.clinicalContentReviewed, false);
  assert.ok(fs.existsSync(withinRoot(inspection.coverPreview)));
}
assert.equal(report.databaseWrites, 0);
assert.equal(report.qaPublishedRecords, 0);
assert.equal(references.databaseWrites, 0);
assert.equal(references.qaPublishedRecords, 0);
console.log(JSON.stringify({ validation: 'passed', englishSummaries: records.length, priorityProposals: candidates.length, chineseDrafts: chinese.length,
  archivedPdfs: references.archivedPdfs, verifiedWhoPages: references.metadataVerified, professionalReview: 'pending', publishedToQa: 0 }));
