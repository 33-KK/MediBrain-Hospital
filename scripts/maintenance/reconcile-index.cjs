/** Reconcile the deployed Neo4j graph and Milvus cache; require --apply to mutate. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { requireDependency } = require('../runtime.cjs');
const neo4j = requireDependency('neo4j-driver');
const { MilvusClient } = requireDependency('@zilliz/milvus2-sdk-node');
async function main() {
  const secret = JSON.parse(execFileSync('kubectl', ['get', 'secret', 'medibrain-secret', '-n', 'medibrain', '-o', 'json'], { encoding: 'utf8' }));
  const graph = neo4j.driver(process.env.INDEX_NEO4J_URI || 'bolt://localhost:7688', neo4j.auth.basic('neo4j', Buffer.from(secret.data.NEO4J_PASSWORD, 'base64').toString()));
  const vectors = new MilvusClient({ address: process.env.MILVUS_URI || 'localhost:19540', logLevel: 'error' });
  const collection = process.env.MILVUS_COLLECTION || 'entities';
  try {
    const snapshot = await graph.executeQuery('MATCH (n) WHERE n.名称 IS NOT NULL RETURN n.名称 AS name, labels(n)[0] AS label');
    const expected = new Set(snapshot.records.map(record => JSON.stringify([record.get('label'), record.get('name')])));
    const rows = [], seen = new Map(), removed = [];
    const iterator = await vectors.queryIterator({ collection_name: collection, batchSize: 1000, output_fields: ['id', 'entity_name', 'entity_type'], consistency_level: 'Strong', timeout: 10000 });
    for await (const batch of iterator) rows.push(...batch);
    for (const row of rows) {
      const key = JSON.stringify([row.entity_type, row.entity_name]);
      if (!expected.has(key)) { removed.push(row.id); continue; }
      const previous = seen.get(key);
      if (previous) {
        const latest = BigInt(row.id) > BigInt(previous.id) ? row : previous;
        removed.push(latest === row ? previous.id : row.id);
        seen.set(key, latest);
      } else seen.set(key, row);
    }
    const missing = [...expected].filter(key => !seen.has(key));
    const summary = { graphEntities: expected.size, vectorRows: rows.length, staleOrDuplicateRows: removed.length, missingEntities: missing.length, applied: false };
    if (process.argv.includes('--apply')) {
      if (missing.length) throw new Error('Missing vectors require backfill before cleanup');
      if (removed.length) {
        const backup = path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'medibrain-vector-backup-' + randomBytes(6).toString('hex') + '.jsonl');
        const backups = [];
        for (let i = 0; i < removed.length; i += 100) {
          const batch = removed.slice(i, i + 100);
          const result = await vectors.query({ collection_name: collection, filter: 'id in [' + batch.join(',') + ']', output_fields: ['*'], consistency_level: 'Strong', timeout: 10000 });
          if (result.status.error_code !== 'Success' || result.data.length !== batch.length) throw new Error('Vector backup incomplete');
          backups.push(...result.data);
        }
        fs.writeFileSync(backup, backups.map(row => JSON.stringify(row)).join('\n') + '\n');
        for (let i = 0; i < removed.length; i += 100) {
          const result = await vectors.deleteEntities({ collection_name: collection, expr: 'id in [' + removed.slice(i, i + 100).join(',') + ']', timeout: 10000 });
          if (result.status.error_code !== 'Success') throw new Error('Vector cleanup failed');
        }
        summary.backupFile = backup;
      }
      const after = await vectors.query({ collection_name: collection, filter: '', output_fields: ['count(*)'], consistency_level: 'Strong', timeout: 10000 });
      if (after.status.error_code !== 'Success' || Number(after.data[0]['count(*)']) !== expected.size) throw new Error('Vector count mismatch after cleanup');
      summary.applied = true;
    }
    console.log(JSON.stringify(summary));
  } finally { await graph.close(); await vectors.closeConnection(); }
}
main().catch(error => { console.error(JSON.stringify({ reconcile: 'failed', code: error.code || error.name, message: error.message?.slice(0, 100) })); process.exitCode = 1; });
