/**
 * Top-5 命中率抽样验收（B 步骤验收项）
 * 50 条真实问答场景 → embedding → Milvus Top-5 → 检查期望实体是否命中
 * 用法：node scripts/embedding/evaluate-top5.js
 */
const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

const CASES = [
  // 高血压 / 血压相关
  { q: '血压高的人适合吃什么', expect: ['高血压', '血压高'] },
  { q: '血压高吃什么水果好', expect: ['高血压', '血压高'] },
  { q: '高血压患者饮食注意什么', expect: ['高血压'] },
  { q: '高血压有什么症状', expect: ['高血压'] },
  { q: '血压高能喝酒吗', expect: ['高血压', '血压高'] },
  { q: '高血压吃什么降压药', expect: ['高血压'] },
  { q: '量血压用什么设备', expect: ['血压计', '血压'] },
  // 感冒 / 发烧
  { q: '感冒了吃什么药', expect: ['感冒'] },
  { q: '感冒症状有哪些', expect: ['感冒'] },
  { q: '发烧了怎么退烧', expect: ['发烧', '发热'] },
  { q: '小孩发烧吃什么药', expect: ['小儿发烧', '发烧'] },
  // 糖尿病 / 血糖
  { q: '糖尿病人不能吃什么', expect: ['糖尿病'] },
  { q: '糖尿病有哪些并发症', expect: ['糖尿病'] },
  { q: '血糖高做什么检查', expect: ['血糖'] },
  { q: '查血糖需要什么检查项目', expect: ['血糖'] },
  { q: '胰岛素怎么用', expect: ['胰岛素'] },
  // 胃 / 消化
  { q: '胃炎有什么症状', expect: ['胃炎'] },
  { q: '胃溃疡吃什么药', expect: ['胃溃疡'] },
  { q: '胃痛怎么办', expect: ['胃痛', '胃炎'] },
  { q: '胃镜需要空腹吗', expect: ['胃镜'] },
  { q: '消化不良吃什么', expect: ['消化不良'] },
  { q: '胃不舒服应该做什么检查', expect: ['胃部检查', '胃镜'] },
  // 失眠 / 神经
  { q: '失眠怎么治疗', expect: ['失眠'] },
  { q: '晚上睡不着怎么办', expect: ['失眠'] },
  { q: '安眠药有哪些', expect: ['安眠药', '舒眠胶囊', '安眠补脑口服液'] },
  { q: '头痛挂什么科', expect: ['头痛'] },
  // 呼吸系统
  { q: '咳嗽吃什么药', expect: ['咳嗽'] },
  { q: '咳嗽不止是什么病', expect: ['咳嗽'] },
  { q: '哮喘发作怎么处理', expect: ['哮喘'] },
  { q: '肺炎有什么症状', expect: ['肺炎'] },
  { q: '支气管炎怎么治', expect: ['支气管炎'] },
  // 心血管
  { q: '冠心病如何治疗', expect: ['冠心病'] },
  { q: '心绞痛吃什么药', expect: ['心绞痛', '冠心病'] },
  { q: '胸闷心慌是什么原因', expect: ['胸闷', '心慌'] },
  // 肾 / 结石
  { q: '肾结石吃什么好', expect: ['肾结石'] },
  { q: '结石怎么治疗', expect: ['结石', '肾结石'] },
  { q: '尿路感染用什么药', expect: ['尿路感染'] },
  // 血液 / 贫血
  { q: '贫血吃什么补血', expect: ['贫血'] },
  { q: '缺铁性贫血怎么补', expect: ['贫血'] },
  { q: '血常规检查哪些项目', expect: ['血常规'] },
  // 肿瘤 / 癌症
  { q: '肺癌有哪些早期症状', expect: ['肺癌'] },
  { q: '癌症怎么早发现', expect: ['癌症'] },
  { q: '肿瘤化疗有什么副作用', expect: ['肿瘤', '化疗'] },
  // 骨科 / 关节
  { q: '关节炎用什么药', expect: ['关节炎'] },
  { q: '颈椎病挂哪个科', expect: ['颈椎病'] },
  { q: '骨质疏松怎么补钙', expect: ['骨质疏松'] },
  // 皮肤 / 过敏
  { q: '皮肤过敏怎么办', expect: ['过敏', '皮肤过敏'] },
  { q: '荨麻疹怎么治', expect: ['荨麻疹'] },
  // 肝 / 传染
  { q: '乙肝有什么症状', expect: ['乙肝', '肝炎'] },
  { q: '脂肪肝怎么调理', expect: ['脂肪肝'] },
  // 药品 / 检查
  { q: '布洛芬怎么吃', expect: ['布洛芬'] },
  { q: '阿司匹林有什么副作用', expect: ['阿司匹林'] },
  { q: '抗生素有哪些种类', expect: ['抗生素', '阿莫西林'] },
  { q: '心电图能检查什么', expect: ['心电图'] },
  { q: 'CT能查出什么病', expect: ['CT'] },
  { q: 'B超检查哪些部位', expect: ['B超'] },
  { q: '血常规能查出什么', expect: ['血常规'] },
];

async function main() {
  const c = new MilvusClient({ address: process.env.MILVUS_ADDRESS || 'localhost:19540' });
  let hit = 0;
  const fails = [];

  for (let i = 0; i < CASES.length; i++) {
    const { q, expect } = CASES[i];
    const er = await fetch('http://localhost:11434/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'bge-m3', input: [q] }),
    });
    const ej = await er.json();
    const sr = await c.search({
      collection_name: 'entities',
      vector: ej.embeddings[0],
      output_fields: ['entity_name'],
      limit: 5,
      metric_type: 'COSINE',
    });
    const top5 = sr.results.map((r) => r.entity_name);
    const matched = expect.find((e) => top5.includes(e));
    if (matched) {
      hit++;
    } else {
      fails.push({ q, expect, top5: top5.slice(0, 3) });
    }
  }

  const rate = (hit / CASES.length) * 100;
  console.log(`\n===== Top-5 命中率验收 =====`);
  console.log(`总数: ${CASES.length} | 命中: ${hit} | 命中率: ${rate.toFixed(1)}%`);
  console.log(`\n未命中 ${fails.length} 条:`);
  for (const f of fails) {
    console.log(`- Q: ${f.q}`);
    console.log(`  期望: ${f.expect.join('/')}`);
    console.log(`  实际 Top-3: ${f.top5.join(' | ')}`);
  }
  await c.closeConnection();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });