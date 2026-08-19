const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

const QUERIES = [
  '血压高的人适合吃什么',
  '感冒了吃什么药',
  '糖尿病人不能吃什么',
  '安眠药有哪些',
  '查血糖需要做什么检查',
];

(async () => {
  const c = new MilvusClient({ address: 'localhost:19540' });
  const cnt = await c.getCollectionStatistics({ collection_name: 'entities' });
  console.log('集合行数:', cnt.data?.row_count || JSON.stringify(cnt));

  for (const q of QUERIES) {
    const er = await fetch('http://localhost:11434/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'bge-m3', input: [q] }),
    });
    const ej = await er.json();
    const sr = await c.search({
      collection_name: 'entities',
      vector: ej.embeddings[0],
      output_fields: ['entity_name', 'entity_type'],
      limit: 3,
    });
    const hits = sr.results
      .map((r) => `${r.entity_name}[${r.entity_type}] ${r.score.toFixed(4)}`)
      .join('\n    ');
    console.log(`\nQ: ${q}\n  1. ${hits}`);
  }
  await c.closeConnection();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });