/** Verify disease attributes against a pinned upstream dataset; never execute upstream code.
 * Default is read-only. --apply writes import provenance only for exact matches,
 * retaining a local backup and guarding against concurrent property changes.
 * This does not certify clinical claims or the provenance of relationships.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { requireDependency } = require('../runtime.cjs');
const neo4j = requireDependency('neo4j-driver');
const root = path.resolve(__dirname, '../..');
const commit = '6d91e2ec76f70dd604b8a897a63b2ac6fba3ec95';
const repo = 'https://github.com/honeyandme/RAGQnASystem';
const metadataKey = '_medibrainImportProvenance';
const files = ['data/medical_new_2.json', 'data/medical.json'];
const mapping = { 名称: 'name', 疾病简介: 'desc', 疾病病因: 'cause', 预防措施: 'prevent', 治疗周期: 'cure_lasttime', 治愈概率: 'cured_prob', 疾病易感人群: 'easy_get' };
const fields = Object.keys(mapping);
const digest = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const signature = (props) => digest(JSON.stringify(fields.map((key) => props[key] ?? null)));
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('Source metadata HTTP ' + response.status);
  return response.json();
}
function parseRecords(bytes) {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (text.trimStart().startsWith('[')) return JSON.parse(text);
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line.trim().replace(/,$/, '')));
}
async function main() {
  const apply = process.argv.includes('--apply');
  const candidates = new Map();
  const sources = [];
  const cacheDir = path.join(os.tmpdir(), 'medibrain-upstream-' + commit);
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const file of files) {
    const meta = await json(`https://api.github.com/repos/honeyandme/RAGQnASystem/contents/${file}?ref=${commit}`);
    const cachedPath = path.join(cacheDir, path.basename(file));
    let bytes = fs.existsSync(cachedPath) ? fs.readFileSync(cachedPath) : null;
    const gitHash = (buffer) => digest(Buffer.concat([Buffer.from(`blob ${buffer.length}\0`), buffer]), 'sha1');
    if (!bytes || gitHash(bytes) !== meta.sha) {
      const response = await fetch(`https://raw.githubusercontent.com/honeyandme/RAGQnASystem/${commit}/${file}`, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error('Dataset HTTP ' + response.status);
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== meta.size || gitHash(bytes) !== meta.sha) throw new Error('Dataset blob verification failed');
      fs.writeFileSync(cachedPath, bytes);
    }
    const records = parseRecords(bytes);
    const source = { repo, commit, path: file, blobSha: meta.sha, sha256: digest(bytes), records: records.length };
    sources.push(source);
    for (const [index, record] of records.entries()) {
      const props = Object.fromEntries(Object.entries(mapping).map(([key, rawKey]) => [key, record[rawKey] ?? '']));
      const hash = signature(props);
      // Prefer medical_new_2.json, the file used by the upstream importer.
      if (!candidates.has(hash)) candidates.set(hash, { ...source, recordIndex: index + 1, matchHash: hash, scope: 'disease-properties', matchedProperties: fields });
    }
    console.log(JSON.stringify({ downloadedAndVerified: file, records: records.length }));
  }
  const secret = JSON.parse(execFileSync('kubectl', ['get', 'secret', 'medibrain-secret', '-n', 'medibrain', '-o', 'json'], { encoding: 'utf8' }));
  const driver = neo4j.driver('bolt://localhost:7688', neo4j.auth.basic('neo4j', Buffer.from(secret.data.NEO4J_PASSWORD, 'base64').toString()));
  try {
    const raw = await driver.executeQuery('MATCH (n:疾病) RETURN elementId(n) AS id,properties(n) AS props');
    const matches = [], unmatched = [];
    const timestamp = new Date().toISOString();
    for (const record of raw.records) {
      const props = record.get('props');
      const source = candidates.get(signature(props));
      const id = record.get('id');
      if (source) matches.push({ id, name: props.名称, source: { ...source, verifiedAt: timestamp }, expected: Object.fromEntries(fields.map((key) => [key, props[key] ?? null])), previous: props[metadataKey] ?? null });
      else unmatched.push({ id, name: props.名称 });
    }
    let applied = 0, backupFile;
    if (apply) {
      const backupDir = path.join(root, 'data/backups');
      fs.mkdirSync(backupDir, { recursive: true });
      backupFile = path.join(backupDir, 'import-provenance-' + timestamp.replace(/[:.]/g, '-') + '.json');
      fs.writeFileSync(backupFile, JSON.stringify({ timestamp, metadataKey, nodes: matches.map(({ id, previous }) => ({ id, previous })) }, null, 2) + '\n', { flag: 'wx' });
      for (let index = 0; index < matches.length; index += 250) {
        const rows = matches.slice(index, index + 250).map((match) => ({ id: match.id, expected: match.expected, provenance: JSON.stringify(match.source) }));
        const written = await driver.executeQuery(`UNWIND $rows AS row MATCH (n:疾病) WHERE elementId(n)=row.id
          AND all(k IN $fields WHERE n[k]=row.expected[k] OR (n[k] IS NULL AND row.expected[k] IS NULL))
          SET n._medibrainImportProvenance=row.provenance RETURN count(n) AS count`, { rows, fields });
        applied += written.records[0].get('count').toNumber();
      }
      if (applied !== matches.length) throw new Error('Concurrent edits detected; provenance applied to ' + applied + ' of ' + matches.length + ' nodes; backup: ' + backupFile);
    }
    const byFile = Object.fromEntries(files.map((file) => [file, matches.filter((match) => match.source.path === file).length]));
    const report = { timestamp, mode: apply ? 'apply' : 'read-only', repo, commit, sources, scope: 'Exact equality of seven disease properties; relationships and clinical correctness are not certified', total: raw.records.length, matched: matches.length, unmatched: unmatched.length, byFile, applied, backupFile: backupFile ? path.relative(root, backupFile).replaceAll('\\', '/') : undefined, unmatchedNodes: unmatched, clinicalAcceptance: 'pending-professional-review' };
    const reportDir = path.join(root, 'docs/acceptance');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'import-source-latest.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ sourceMatch: { total: report.total, matched: report.matched, unmatched: report.unmatched, byFile, applied }, clinicalAcceptance: report.clinicalAcceptance }));
  } finally { await driver.close(); }
}
main().catch((error) => { console.error(JSON.stringify({ sourceVerificationFailed: error.message })); process.exitCode = 1; });
