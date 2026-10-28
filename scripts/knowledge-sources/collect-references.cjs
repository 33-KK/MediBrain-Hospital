/** Archive explicitly listed official PDFs and verify link metadata. Never write to databases. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/knowledge-sources/source-catalog.json'), 'utf8'));
const allowedHosts = new Set(['www.nhc.gov.cn', 'www.who.int']);
const digest = (data) => createHash('sha256').update(data).digest('hex');

function assertUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.port || url.username || url.password) {
    throw new Error('Unexpected official-source URL');
  }
}

async function collect(source) {
  if (!/^[a-z0-9-]+$/.test(source.id)) throw new Error('Invalid source ID');
  assertUrl(source.url);
  const dir = path.join(root, 'data/external/references', source.id);
  const pdfFile = path.join(dir, 'original.pdf');
  const manifestFile = path.join(dir, 'manifest.json');
  if (source.collectionMode === 'archive-pdf' && fs.existsSync(pdfFile) && fs.existsSync(manifestFile) && !process.argv.includes('--refresh')) {
    const cached = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const bytes = fs.readFileSync(pdfFile);
    if (cached.requestedUrl !== source.url || cached.sha256 !== digest(bytes) || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new Error('Cached reference checksum or format mismatch');
    }
    return { ...cached, status: 'archived', cacheUsed: true };
  }
  const response = await fetch(source.url, { signal: AbortSignal.timeout(45000), redirect: 'manual' });
  if (!response.ok) {
    await response.body?.cancel();
    return { id: source.id, requestedUrl: source.url, checkedAt: new Date().toISOString(), status: 'unavailable', httpStatus: response.status };
  }
  const chunks = [];
  let size = 0;
  const maxSize = source.collectionMode === 'archive-pdf' ? 25 * 1024 * 1024 : 2 * 1024 * 1024;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxSize) throw new Error('Reference exceeds size limit');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  const record = { id: source.id, requestedUrl: source.url, checkedAt: new Date().toISOString(), httpStatus: response.status, bytes: size, sha256: digest(bytes) };
  if (source.collectionMode === 'archive-pdf') {
    if (size < 1000 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Response is not a PDF');
    fs.mkdirSync(dir, { recursive: true });
    const temporary = pdfFile + '.' + randomUUID() + '.part';
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, pdfFile);
    Object.assign(record, { status: 'archived', localFile: path.relative(root, pdfFile).replaceAll('\\', '/'), textExtracted: false });
    fs.writeFileSync(manifestFile, JSON.stringify(record, null, 2) + '\n');
  } else {
    const html = bytes.toString('utf8');
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim();
    if (!title || !title.includes(source.title)) throw new Error('Unexpected reference-page title');
    Object.assign(record, { status: 'metadata-verified', pageTitle: title, fullTextStored: false });
  }
  return record;
}

async function main() {
  const records = [];
  for (const source of catalog.sources) {
    if (!['archive-pdf', 'metadata-only'].includes(source.collectionMode)) continue;
    let record;
    try { record = await collect(source); }
    catch (error) { record = { id: source.id, requestedUrl: source.url, checkedAt: new Date().toISOString(), status: 'error', error: error.message }; }
    records.push(record);
    console.log(JSON.stringify({ id: record.id, status: record.status, httpStatus: record.httpStatus, bytes: record.bytes }));
  }
  const report = { generatedAt: new Date().toISOString(), catalogEntries: catalog.sources.length, attemptedReferences: records.length,
    archivedPdfs: records.filter((record) => record.status === 'archived').length,
    metadataVerified: records.filter((record) => record.status === 'metadata-verified').length,
    unavailable: records.filter((record) => ['unavailable', 'error'].includes(record.status)).length,
    databaseWrites: 0, qaPublishedRecords: 0, records };
  fs.writeFileSync(path.join(root, 'docs/knowledge-sources/references-latest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ archivedPdfs: report.archivedPdfs, metadataVerified: report.metadataVerified, unavailable: report.unavailable }));
  if (records.some((record) => record.status === 'error')) process.exitCode = 1;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
