const { requireDependency, requiredEnv } = require('../runtime.cjs');
/**
 * 离线索引：Neo4j 图谱实体 → bge-m3 embedding → Milvus
 * 用法：node scripts/embedding/index-graph.js
 * 幂等：同名实体 upsert，可重复运行；支持分批断点（--start 偏移）
 */

const fs = require('fs');
const path = require('path');
const { createHash } = require('node:crypto');
const neo4j = requireDependency('neo4j-driver');
const { MilvusClient, DataType } = requireDependency('@zilliz/milvus2-sdk-node');

const MILVUS_ADDR = process.env.MILVUS_ADDRESS || 'localhost:19540';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const NEO4J_URI = process.env.SRC_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.SRC_USER || 'neo4j';
const NEO4J_PASS = requiredEnv("SRC_PASS", "NEO4J_PASSWORD");
const COLLECTION = 'entities';
const DIM = 1024;
const BATCH = 32; // embedding 批大小
const DESC_MAX = 500; // 简介截断长度，防超 Ollama context
const PROGRESS_FILE = path.join(__dirname, 'index-progress.json');

let client;
let driver;

async function ensureCollection() {
  const has = await client.hasCollection({ collection_name: COLLECTION });
  if (!has.value) {
    await client.createCollection({
      collection_name: COLLECTION,
      fields: [
        { name: 'id', data_type: DataType.Int64, is_primary_key: true, autoID: true },
        { name: 'entity_name', data_type: DataType.VarChar, max_length: 512 },
        { name: 'entity_type', data_type: DataType.VarChar, max_length: 64 },
        { name: 'entity_desc', data_type: DataType.VarChar, max_length: 2048 },
        { name: 'embedding', data_type: DataType.FloatVector, dim: DIM },
      ],
    });
    await client.createIndex({
      collection_name: COLLECTION,
      index_name: 'embedding_idx',
      field_name: 'embedding',
      index_type: 'AUTOINDEX',
      metric_type: 'COSINE',
    });
    console.log(`集合已创建: ${COLLECTION} (dim=${DIM})`);
  } else {
    console.log(`集合已存在: ${COLLECTION}`);
  }
  await client.loadCollection({ collection_name: COLLECTION });
}

async function loadEntities() {
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (n) RETURN n.名称 AS name, labels(n)[0] AS label, coalesce(n.简介, n.疾病简介, n.疾病病因, '') AS desc`
    );
    const entities = [];
    for (const rec of res.records) {
      const name = rec.get('name');
      if (!name) continue;
      entities.push({
        entity_name: String(name),
        entity_type: (rec.get('label') || 'unknown'),
        entity_desc: (rec.get('desc') || '').slice(0, DESC_MAX),
      });
    }
    console.log(`Neo4j 实体数: ${entities.length}`);
    return entities;
  } finally {
    await session.close();
  }
}

async function embed(texts) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: texts }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`embedding 失败: ${res.status} ${errText.slice(0, 200)}`);
  }
  const j = await res.json();
  return j.embeddings;
}

// 降级重试：整批 → 半批 → 单条（去 desc 再试）
async function embedRobust(items) {
  try {
    const texts = items.map((e) => e.text);
    return await embed(texts);
  } catch (e) {
    if (items.length === 1) {
      try {
        return await embed([items[0].name]);
      } catch (e2) {
        console.warn(`跳过超长实体: ${items[0].name} (${e2.message})`);
        return [null];
      }
    }
    const half = Math.ceil(items.length / 2);
    const a = await embedRobust(items.slice(0, half));
    const b = await embedRobust(items.slice(half));
    return [...a, ...b];
  }
}

async function insertRows(rows) {
  // 每批 100 条写入 Milvus
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const existing = await client.query({
      collection_name: COLLECTION,
      filter: 'entity_name in ' + JSON.stringify(chunk.map(row => row.entity_name)),
      output_fields: ['id', 'entity_name', 'entity_type'],
      consistency_level: 'Strong', limit: 1000, timeout: 5000,
    });
    if (existing.status?.error_code !== 'Success') throw new Error('已有实体查询失败');
    const ids = new Map(existing.data.map(row => [JSON.stringify([row.entity_type, row.entity_name]), row.id]));
    const inserts = [];
    const updates = [];
    for (const r of chunk) {
      const row = {
        entity_name: r.entity_name,
        entity_type: r.entity_type,
        entity_desc: r.entity_desc,
        embedding: r.embedding,
      };
      const id = ids.get(JSON.stringify([r.entity_type, r.entity_name]));
      if (id === undefined) inserts.push(row);
      else updates.push({ ...row, id });
    }
    for (const [method, data] of [['insert', inserts], ['upsert', updates]]) {
      if (!data.length) continue;
      const res = await client[method]({ collection_name: COLLECTION, data, timeout: 10000 });
      if (res.status?.error_code !== 'Success') throw new Error(`${method} 失败`);
    }
  }
}

function readProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return { done: 0, total: 0, names: [] };
}

function writeProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

async function main() {
  client = new MilvusClient({ address: MILVUS_ADDR });
  driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));

  await ensureCollection();

  // 默认更新全部实体；显式 --resume 且图谱快照相同时才恢复进度。
  const prog = readProgress();
  const entities = await loadEntities();
  const fingerprint = createHash('sha256').update(JSON.stringify(entities)).digest('hex');
  const start = process.argv.includes('--resume') && prog.fingerprint === fingerprint ? prog.done : 0;
  writeProgress({ done: start, total: entities.length, fingerprint });

  let done = 0;
  const t0 = Date.now();
  for (let i = start; i < entities.length; i += BATCH) {
    const batch = entities.slice(i, i + BATCH);
    const items = batch.map((e) => ({
      ...e,
      text: e.entity_name + (e.entity_desc ? '：' + e.entity_desc : ''),
    }));
    const embeddings = await embedRobust(items);
    const rows = items
      .map((e, idx) => ({ ...e, embedding: embeddings[idx] }))
      .filter((r) => r.embedding);
    if (rows.length) await insertRows(rows);
    done += batch.length;
    if (done % 1000 < BATCH || i + BATCH >= entities.length) {
      const rate = Math.round(done / ((Date.now() - t0) / 1000));
      console.log(`已索引 ${i + batch.length}/${entities.length} (${rate} 条/秒)`);
      writeProgress({ done: i + batch.length, total: entities.length, fingerprint });
    }
  }
  fs.unlinkSync(PROGRESS_FILE);
  console.log(`索引完成: ${entities.length} 条, 耗时 ${Math.round((Date.now() - t0) / 1000)}s`);
  await driver.close();
  await client.closeConnection();
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
