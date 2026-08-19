const fs = require('fs');
const readline = require('readline');
const neo4j = require('neo4j-driver');

const TARGET = process.env.TARGET || 'bolt://localhost:7688';
const USER = process.env.USER || 'neo4j';
const PASS = process.env.PASS || 'medibrain-secret';
const FILE = process.argv[2] || 'graph-dump.cypher';
const BATCH = Number(process.env.BATCH || 50);

async function main() {
  const driver = neo4j.driver(TARGET, neo4j.auth.basic(USER, PASS), {
    maxTransactionRetryTime: 60000,
  });
  const session = driver.session();

  console.log('清空数据库...');
  await session.run('MATCH (n) DETACH DELETE n');

  console.log('创建索引...');
  for (const label of ['疾病', '药物', '食物', '检查项目', '项目', '常见症状', '治疗方法', '药品商']) {
    try {
      await session.run(`CREATE INDEX idx_${label} IF NOT EXISTS FOR (n:${label}) ON (n.名称)`);
      console.log(`索引 ${label} 已创建`);
    } catch (e) {
      console.log(`索引 ${label} 跳过: ${e.message}`);
    }
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let batch = [];
  let total = 0;
  let failed = 0;

  const flush = async () => {
    const stmts = batch;
    batch = [];
    let tx;
    try {
      tx = session.beginTransaction();
      for (const stmt of stmts) {
        await tx.run(stmt);
      }
      await tx.commit();
      total += stmts.length;
    } catch (e) {
      try { if (tx) await tx.rollback(); } catch (_) {}
      failed += stmts.length;
      console.log(`批次失败 ${stmts.length} 条: ${e.message}`);
    }
    if (total % 20000 === 0) {
      console.log(`已提交 ${total} 条, 失败 ${failed}`);
    }
  };

  for await (const line of rl) {
    let s = line.trim();
    if (!s || s.startsWith('//')) continue;
    // 节点 CREATE → MERGE 幂等
    if (s.startsWith('CREATE (:') ) {
      s = s.replace(/^CREATE \(:/, 'MERGE (:');
    }
    // 关系 MATCH...CREATE → MATCH...MERGE 幂等
    if (s.includes(' CREATE (a)-[')) {
      s = s.replace(' CREATE (a)-[', ' MERGE (a)-[');
    }
    batch.push(s);
    if (batch.length >= BATCH) {
      await flush();
    }
  }
  if (batch.length) await flush();

  console.log(`导入完成: 成功 ${total}, 失败 ${failed}`);
  await session.close();
  await driver.close();
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});