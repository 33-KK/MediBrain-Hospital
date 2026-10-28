/** Collect public-domain MedlinePlus topic summaries into an isolated review dataset.
 * No database writes, translations, external linked-page crawling or source-code execution.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const base = 'https://medlineplus.gov/xml.html';
const MAX_BYTES = 64 * 1024 * 1024;
async function download(url, maxBytes) {
  if (new URL(url).hostname !== 'medlineplus.gov') throw new Error('Unexpected source host');
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Source HTTP ' + response.status);
  if (new URL(response.url).hostname !== 'medlineplus.gov') throw new Error('Unexpected redirect');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Source exceeds download limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function main() {
  const html = (await download(base, 1024 * 1024)).toString('utf8');
  const urls = [...html.matchAll(/href\s*=\s*["']([^"']*\/mplus_topics_\d{4}-\d{2}-\d{2}\.xml)["']/gi)]
    .map((match) => new URL(match[1], base).href).sort().reverse();
  if (!urls.length) throw new Error('No published health-topic XML found');
  const url = urls[0];
  const datasetDate = /mplus_topics_(\d{4}-\d{2}-\d{2})\.xml$/.exec(url)[1];
  const dir = path.join(root, 'data/external/medlineplus', datasetDate);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'health-topics.xml');
  const manifestFile = path.join(dir, 'manifest.json');
  let manifest;
  if (fs.existsSync(file) && fs.existsSync(manifestFile) && !process.argv.includes('--refresh')) {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest.url !== url || manifest.sha256 !== createHash('sha256').update(fs.readFileSync(file)).digest('hex')) throw new Error('Cached dataset checksum mismatch');
  } else {
    const bytes = await download(url, MAX_BYTES);
    manifest = { publisher: 'MedlinePlus, National Library of Medicine', url, datasetDate, fetchedAt: new Date().toISOString(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), policyUrl: 'https://medlineplus.gov/about/using/usingcontent/', attribution: 'Source: MedlinePlus, National Library of Medicine.', scope: 'Health topic summaries and vocabulary only; no licensed encyclopedia, drug monographs, images or linked-page text' };
    const temporary = file + '.' + randomUUID() + '.part';
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, file);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(JSON.stringify({ sourceDownloaded: url, bytes: manifest.bytes, sha256: manifest.sha256 }));
  execFileSync(process.env.KNOWLEDGE_PYTHON || 'python', [path.join(__dirname, 'normalize-medlineplus.py'), file, manifestFile], { stdio: 'inherit', timeout: 60000 });
}
main().catch((error) => { console.error(JSON.stringify({ collectionFailed: error.message })); process.exitCode = 1; });
