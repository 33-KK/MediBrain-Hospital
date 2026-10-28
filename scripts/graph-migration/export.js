const { requireDependency, requiredEnv } = require('../runtime.cjs');
const fs = require('fs');
const neo4j = requireDependency('neo4j-driver');

const SRC_URI = process.env.SRC_URI || 'bolt://localhost:7687';
const SRC_USER = process.env.SRC_USER || 'neo4j';
const SRC_PASS = requiredEnv("SRC_PASS", "NEO4J_PASSWORD");
const OUT = process.env.OUT || 'graph-dump.cypher';

const BATCH = 5000;

function esc(s) {
  if (s == null) return 'null';
  return JSON.stringify(String(s));
}

async function main() {
  const driver = neo4j.driver(SRC_URI, neo4j.auth.basic(SRC_USER, SRC_PASS));
  const session = driver.session();

  const writeStream = fs.createWriteStream(OUT, { encoding: 'utf8' });
  writeStream.write('// MediBrain-Hospital 图谱全量导出\n');

  // 节点
  let skip = 0;
  while (true) {
    const res = await session.run(
      `MATCH (n) RETURN n SKIP ${skip} LIMIT ${BATCH}`
    );
    if (!res.records.length) break;
    for (const rec of res.records) {
      const n = rec.get('n');
      const labels = n.labels.length ? n.labels.join(':') : '';
      const props = Object.entries(n.properties)
        .map(([k, v]) => `\`${k}\`: ${esc(v)}`)
        .join(', ');
      writeStream.write(`CREATE (:${labels} {${props}});\n`);
    }
    skip += res.records.length;
    console.log(`节点已导出 ${skip}`);
    if (res.records.length < BATCH) break;
  }

  // 关系
  skip = 0;
  while (true) {
    const res = await session.run(
      `MATCH ()-[r]->() RETURN r, startNode(r) AS s, endNode(r) AS e SKIP ${skip} LIMIT ${BATCH}`
    );
    if (!res.records.length) break;
    for (const rec of res.records) {
      const r = rec.get('r');
      const s = rec.get('s');
      const e = rec.get('e');
      const sName = s.properties.name ?? s.properties['名称'];
      const eName = e.properties.name ?? e.properties['名称'];
      if (sName == null || eName == null) continue;
      const sLabel = s.labels[0] || '';
      const eLabel = e.labels[0] || '';
      const props = Object.entries(r.properties)
        .map(([k, v]) => `\`${k}\`: ${esc(v)}`)
        .join(', ');
      const propStr = props ? ` {${props}}` : '';
      writeStream.write(
        `MATCH (a:${sLabel} {\`名称\`: ${esc(sName)}}), (b:${eLabel} {\`名称\`: ${esc(eName)}}) CREATE (a)-[:\`${r.type}\`${propStr}]->(b);\n`
      );
    }
    skip += res.records.length;
    console.log(`关系已导出 ${skip}`);
    if (res.records.length < BATCH) break;
  }

  writeStream.end();
  console.log(`完成: ${OUT}`);
  await session.close();
  await driver.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
