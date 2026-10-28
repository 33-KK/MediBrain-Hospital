const { requireDependency, requiredEnv } = require('../runtime.cjs');
const neo4j = requireDependency('neo4j-driver');

async function stats(uri, user, pass, name) {
  const d = neo4j.driver(uri, neo4j.auth.basic(user, pass));
  const s = d.session();
  try {
    const n = await s.run('MATCH (n) RETURN count(n) AS c');
    const r = await s.run('MATCH ()-[x]->() RETURN count(x) AS c');
    const b = await s.run('MATCH (n) WHERE labels(n)=[] RETURN count(n) AS c');
    const labels = await s.run('MATCH (n) UNWIND labels(n) AS l RETURN l, count(*) AS c ORDER BY c DESC');
    console.log(`[${name}] ${uri}`);
    console.log(`  节点: ${n.records[0].get('c')}  关系: ${r.records[0].get('c')}  空标签: ${b.records[0].get('c')}`);
    labels.records.forEach((x) => console.log(`    ${x.get('l')}: ${x.get('c')}`));
  } finally {
    await s.close();
    await d.close();
  }
}

(async () => {
  await stats(process.env.SRC_URI || 'bolt://localhost:7687', process.env.SRC_USER || 'neo4j', requiredEnv('SRC_PASS', 'NEO4J_PASSWORD'), '源库');
  await stats(process.env.DST_URI || 'bolt://localhost:7688', process.env.DST_USER || 'neo4j', requiredEnv('DST_PASS', 'PASS'), '集群库');
})().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
