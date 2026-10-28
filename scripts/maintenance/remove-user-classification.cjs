/** Remove only obsolete account/history classification fields; preserve login data. */
const fs = require('node:fs');
const path = require('node:path');
const { requireDependency, requiredEnv } = require('../runtime.cjs');
const { MongoClient, BSON } = requireDependency('mongodb');
const root = path.resolve(__dirname, '../..');
const apply = process.argv.includes('--apply');

async function main() {
  const client = new MongoClient(requiredEnv('MONGO_URI'), { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const query = { $or: [{ role: { $exists: true } }, { identity: { $exists: true } }] };
    const snapshots = [];
    for (const name of ['users', 'qa_records']) {
      const collection = client.db().collection(name);
      snapshots.push({
        collection: name,
        total: await collection.countDocuments(),
        records: await collection.find(query, { projection: { _id: 1, role: 1, identity: 1 } }).toArray(),
      });
    }
    const report = {
      checkedAt: new Date().toISOString(),
      mode: apply ? 'apply' : 'dry-run',
      status: 'passed',
      collections: snapshots.map(({ collection, total, records }) => ({ collection, total, legacyRecords: records.length })),
    };
    if (apply) {
      const backupDirectory = path.join(root, 'data/backups');
      fs.mkdirSync(backupDirectory, { recursive: true });
      if (snapshots.some((item) => item.records.length)) {
        report.backup = path.join(backupDirectory, 'user-classification-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
        // Back up identifiers and obsolete fields only. No passwords or chat text.
        fs.writeFileSync(report.backup, BSON.EJSON.stringify(snapshots, null, 2), { flag: 'wx', mode: 0o600 });
      }
      for (const snapshot of snapshots) {
        const collection = client.db().collection(snapshot.collection);
        if (snapshot.records.length) {
          await collection.updateMany(
            { _id: { $in: snapshot.records.map((record) => record._id) } },
            { $unset: { role: '', identity: '' } },
          );
        }
        const remaining = await collection.countDocuments(query);
        if (remaining) throw new Error('仍有旧身份字段，请确认旧版应用已停止写入后重试');
        report.collections.find((item) => item.collection === snapshot.collection).remainingLegacyRecords = remaining;
      }
      const reportDirectory = path.join(root, 'docs/acceptance');
      fs.mkdirSync(reportDirectory, { recursive: true });
      fs.writeFileSync(path.join(reportDirectory, 'user-login-migration-latest.json'), JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify(report));
  } finally { await client.close(); }
}

main().catch((error) => {
  console.error(JSON.stringify({ migration: 'failed', code: error.code || error.name }));
  process.exitCode = 1;
});
