const fs = require('fs');
const path = require('path');
const neo4j = require('neo4j-driver');

const d = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'qm5E!tkB7batqBX'));

const ALL_REL_TYPES = ['疾病的症状', '疾病所需检查', '疾病使用药品', '疾病宜吃食物', '疾病忌吃食物', '疾病并发疾病', '疾病所属科目', '治疗的方法', '疾病别名', '疾病易感人群'];

// 从 JSON 收集所有涉及名称（疾病+别名+实体）
function collectNames() {
  const names = new Set();
  const dir = path.join(__dirname, 'data', 'diseases');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    names.add(data.name);
    for (const a of data.aliases || []) names.add(a);
  }
  return [...names];
}

async function main() {
  const s = d.session();
  const names = collectNames();
  let merged = 0;
  for (const name of names) {
    const r = await s.run('MATCH (n {名称: $name}) WHERE size(labels(n)) > 0 RETURN n, id(n) AS id, labels(n) AS l ORDER BY id(n)', { name });
    if (r.records.length <= 1) continue;
    const keepId = r.records[0].get('id');
    console.log(`合并 "${name}": ${r.records.length} 个节点 → 保留 id=${keepId} (${r.records[0].get('l').join(',')})`);
    for (let i = 1; i < r.records.length; i++) {
      const oldId = r.records[i].get('id');
      // 出边迁移
      for (const type of ALL_REL_TYPES) {
        const out = await s.run(
          `MATCH (a) WHERE id(a) = $old MATCH (a)-[r:${type}]->(t) RETURN t, id(t) AS tid`,
          { old: oldId },
        );
        for (const rec of out.records) {
          await s.run(
            `MATCH (k) WHERE id(k) = $keep MATCH (t) WHERE id(t) = $tid MERGE (k)-[r2:${type}]->(t)`,
            { keep: keepId, tid: rec.get('tid') },
          );
        }
        const inn = await s.run(
          `MATCH (a) WHERE id(a) = $old MATCH (s)-[r:${type}]->(a) RETURN s, id(s) AS sid`,
          { old: oldId },
        );
        for (const rec of inn.records) {
          await s.run(
            `MATCH (k) WHERE id(k) = $keep MATCH (s) WHERE id(s) = $sid MERGE (s)-[r2:${type}]->(k)`,
            { keep: keepId, sid: rec.get('sid') },
          );
        }
      }
      await s.run('MATCH (n) WHERE id(n) = $old DETACH DELETE n', { old: oldId });
      merged++;
    }
  }
  console.log(`\n完成: 合并清理 ${merged} 个重复节点`);
  await s.close();
  await d.close();
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });