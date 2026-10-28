const { requireDependency, requiredEnv } = require('../runtime.cjs');
const fs = require('fs');
const path = require('path');
const neo4j = requireDependency('neo4j-driver');

const TARGET = process.env.TARGET || 'bolt://localhost:7687';
const USER = process.env.USER || 'neo4j';
const PASS = requiredEnv("PASS", "NEO4J_PASSWORD");
const DATA_DIR = path.join(__dirname, 'data');

const RELS = {
  symptoms: '疾病的症状',
  tests: '疾病所需检查',
  drugs: '疾病使用药品',
  foods_ok: '疾病宜吃食物',
  foods_bad: '疾病忌吃食物',
  complications: '疾病并发疾病',
  department: '疾病所属科目',
  treatments: '治疗的方法',
  population: '疾病易感人群',
};

// 所有关系语句统一以 MATCH (d:疾病 {名称:$d}) 开头，避免 MERGE 新变量创建空节点
async function main() {
  const driver = neo4j.driver(TARGET, neo4j.auth.basic(USER, PASS), {
    maxTransactionRetryTime: 60000,
  });
  const session = driver.session();

  const diseasesDir = path.join(DATA_DIR, 'diseases');
  const files = fs.readdirSync(diseasesDir).filter((f) => f.endsWith('.json'));
  let imported = 0;
  let failed = 0;

  for (const file of files) {
    const disease = JSON.parse(fs.readFileSync(path.join(diseasesDir, file), 'utf8'));
    const name = disease.name;
    if (!name) { failed++; console.log(`跳过 ${file}: 缺少 name`); continue; }

    const tx = session.beginTransaction();
    try {
      await tx.run(`MERGE (d:疾病 {名称: $name}) SET d += $props`, {
        name,
        props: {
          ...(disease.desc && { 疾病简介: disease.desc }),
          ...(disease.cause && { 疾病病因: disease.cause }),
          ...(disease.prevention && { 预防措施: disease.prevention }),
          ...(disease.population?.length && { 疾病易感人群: disease.population.join('、') }),
        },
      });

      for (const alias of disease.aliases || []) {
        await tx.run(
          `MATCH (d:疾病 {名称: $d}) MERGE (a:疾病 {名称: $alias}) MERGE (a)-[:疾病别名]->(d)`,
          { d: name, alias },
        );
      }

      for (const s of disease.symptoms || []) {
        await tx.run(
          `MATCH (d:疾病 {名称: $d}) MERGE (n:疾病症状 {名称: $s}) MERGE (d)-[:${RELS.symptoms}]->(n)`,
          { d: name, s },
        );
      }

      for (const t of disease.tests || []) {
        await tx.run(
          `MATCH (d:疾病 {名称: $d}) MERGE (n:检查项目 {名称: $t}) MERGE (d)-[:${RELS.tests}]->(n)`,
          { d: name, t },
        );
      }

      for (const drug of disease.drugs || []) {
        const dn = typeof drug === 'string' ? drug : drug.name;
        const usage = typeof drug === 'string' ? undefined : drug.usage;
        await tx.run(
          `MATCH (d:疾病 {名称: $d}) MERGE (n:药品 {名称: $dn}) ${
            usage ? 'SET n.用法 = $usage' : ''
          } MERGE (d)-[:${RELS.drugs}]->(n)`,
          { d: name, dn, usage },
        );
      }

      for (const f of disease.foods_ok || []) {
        await tx.run(
          `MATCH (d:疾病 {名称: $d}) MERGE (n:食物 {名称: $f}) MERGE (d)-[:${RELS.foods_ok}]->(n)`,
          { d: name, f },
        );
      }
      for (const f of disease.foods_bad || []) {
        await tx.run(
          `MATCH (d:疾病 {名称: $d}) MERGE (n:食物 {名称: $f}) MERGE (d)-[:${RELS.foods_bad}]->(n)`,
          { d: name, f },
        );
      }

      for (const c of disease.complications || []) {
        await tx.run(
          `MATCH (d:疾病 {名称: $d}) MERGE (n:疾病 {名称: $c}) MERGE (d)-[:${RELS.complications}]->(n)`,
          { d: name, c },
        );
      }

      if (disease.department) {
        await tx.run(
          `MATCH (d:疾病 {名称: $d}) MERGE (n:科目 {名称: $dep}) MERGE (d)-[:${RELS.department}]->(n)`,
          { d: name, dep: disease.department },
        );
      }

      for (const m of disease.treatments || []) {
        await tx.run(
          `MATCH (d:疾病 {名称: $d}) MERGE (n:治疗方法 {名称: $m}) MERGE (d)-[:${RELS.treatments}]->(n)`,
          { d: name, m },
        );
      }

      await tx.commit();
      imported++;
      console.log(`✓ 导入: ${name}`);
    } catch (e) {
      try { await tx.rollback(); } catch (_) {}
      failed++;
      console.log(`✗ 失败 ${file}: ${e.message}`);
    }
  }

  console.log(`\n完成: 导入 ${imported} 个疾病, 失败 ${failed}`);
  await session.close();
  await driver.close();
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});