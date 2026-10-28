# 医学知识库补充资料与采集结果

核验日期：2026-10-11。本次已完成在线来源筛选、官方数据下载、结构化清洗、PDF 逐页提取、Neo4j 资料库导入和应用部署。**1,024 份资料、284 页 PDF 原文已可在线检索阅读，专业医学复核尚未完成。**

## 实际取得的数据

| 来源 | 已完成 | 适合补充的内容 |
| --- | --- | --- |
| [MedlinePlus / 美国国家医学图书馆](https://medlineplus.gov/xml.html) | 下载 2026-10-10 官方 XML；清洗得到 **1,016 条英文主题摘要**，筛出 **20 个中文疾病的来源候选** | 疾病简介、英文别名、MeSH 术语编号、相关主题链接 |
| [国家卫健委 2023 年食养指南通知](https://www.nhc.gov.cn/sps/c100088/202301/f01895a06c5349ef999f25da833c166d.shtml) | 下载成人高脂血症、高血压食养指南 2023 年版，各 45、56 页 | 中文成人慢病食养参考 |
| [国家卫健委 2024 年食养指南通知](https://www.nhc.gov.cn/sps/c100088/202402/9ba512ba8e314a47a181db11d2fa188d.shtml) | 下载慢性肾脏病食养指南 2024 年版 69 页，以及高尿酸血症与痛风食养指南**配套问答** 5 页 | 按肾病分期整理营养参考，核对痛风与高尿酸血症的适用条件 |
| [国家卫健委 2026 年食养指南通知](https://www.nhc.gov.cn/sps/c100087/202604/a69d2fce21e040dc96cbc40b923a06d3.shtml) | 下载成人脑卒中食养指南 2026 年版 109 页 | 脑卒中相应阶段的营养与食养参考 |
| WHO 中文实况报道：[高血压](https://www.who.int/zh/news-room/fact-sheets/detail/hypertension)、[糖尿病](https://www.who.int/zh/news-room/fact-sheets/detail/diabetes)、[慢阻肺](https://www.who.int/zh/news-room/fact-sheets/detail/chronic-obstructive-pulmonary-disease-(copd)) | 核验 3 个页面元数据，分别标注 2025-09-25、2024-11-14、2026-06-10；整理 **3 条简短中文释义草稿** | 中文简介与概念边界的复核参考 |

5 份 PDF 共 **284 页**。已检查原件校验值、封面标题和年份，并渲染封面进行目视核对；这不代表已审阅全部正文或完成医学内容验收。采集程序访问这些 PDF 均返回 HTTP 200；通知页曾返回 HTTP 412，通知链接仍保留用于溯源。

MedlinePlus XML 共 2,033 个主题，其中英语 1,017、西班牙语 1,016。英语 COVID-19 主题（ID 3181）在本次 XML 中没有 `full-summary`，已记录并排除，未用模型补写。清洗保留表格行和单元格边界，避免诊断数值及 `and/or` 条件被拼接。

这 1,016 条是健康主题，包含检查及健康教育内容，**不等于新增 1,016 个疾病实体**。本次未抓取第三方百科、药品专论正文或图片。

## 项目中可以直接查看的文件

| 文件 | 内容 |
| --- | --- |
| [来源目录](knowledge-sources/source-catalog.json) | 11 个官方资源入口、下载模式、版本、用途及适用范围 |
| [摘要采集报告](knowledge-sources/collection-latest.json) | 实际数量、20 个候选病种、排除记录、XML 校验值 |
| [PDF 与链接采集报告](knowledge-sources/references-latest.json) | 5 份 PDF 的网址、时间、文件路径与 SHA-256；3 个 WHO 页面核验结果 |
| [PDF 检查报告](knowledge-sources/pdf-inspection-latest.json) | 标题、版次、页数、封面预览位置；专业审核未完成的标记 |
| [中文释义草稿](knowledge-sources/chinese-summary-candidates.json) | 高血压、糖尿病、慢阻肺的简短改写、所依据章节及来源；非 WHO 原文或官方译文 |
| [英文结构化数据](../data/knowledge-staging/medlineplus-en.ndjson) | 每行一个主题：摘要、别名、MeSH 编号、原始链接、校验值及复核状态 |
| [20 个优先疾病候选](../data/knowledge-staging/priority-diseases.json) | 对接现有 `疾病 / 名称 / 疾病简介` 字段的提案；英文原文保留，中文译文尚为空 |

原始 XML 位于 `data/external/medlineplus/2026-10-10/`。5 份 PDF 位于 `data/external/references/<来源ID>/original.pdf`。原件和批量数据位于已被 Git 忽略的 `data/` 下；小型来源目录、报告、草稿和采集脚本保存在项目中。

## 优先补充的 20 个病种

高血压、糖尿病、1 型糖尿病、2 型糖尿病、冠心病、脑卒中、慢性阻塞性肺疾病、哮喘、抑郁症、类风湿关节炎、甲状腺功能亢进、胃溃疡、胃癌、肺癌、肺炎、慢性肾脏病、高脂血症、痛风、肥胖、骨质疏松。

以上是**来源与中文实体的对应提案**，并未自动宣告它们等价。其中 `Peptic Ulcer` 范围比胃溃疡广；`Cholesterol` 是胆固醇相关主题，不能直接覆盖包含其他血脂异常的高脂血症。它们分别标为 `broader-topic-not-equivalent` 和 `related-topic-not-equivalent`。MeSH ID 与英文别名保留为参考信息，未直接建立别名或临床关系。

## 接入现有知识库的方式

### 已实现的资料库接入

导入程序 `scripts/knowledge-sources/import-library.cjs` 将资料存入现有 Neo4j 的独立资料节点，通过唯一 ID 重复导入，建立全文索引和 PDF 页码关系。实际导入 **1,024 份资料记录**（1,016 条英文摘要、5 份中文 PDF、3 个 WHO 来源及释义草稿），**284 页 PDF 正文**。其中 2 页未提取到文字，保留原始页码并提示查看 PDF，不用模型补写。

资料节点使用 `_MediBrainKnowledgeDocument` 和 `_MediBrainKnowledgePage` 标签，以 `title` 保存标题，不使用疾病实体的 `名称` 字段；不混入实体词典或疾病向量候选，不覆盖现有疾病属性或临床关系。文档与页面均保留来源和校验信息，专业复核状态保持待审核。

已部署的功能：

- 登录后可在 `/knowledge` 医学资料库按关键词检索，阅读英文摘要、中文释义草稿和按页提取的 PDF 原文，打开官方来源。
- 问答中的资料或指南请求（例如“脑卒中有哪些食养指南”）返回相关资料卡片；一般图谱问答可附相关资料。
- 资料展示与临床事实生成保持独立。未经专业复核的正文不自动成为药物、诊断阈值或饮食禁忌答案。
- 受登录保护的接口为 `GET /api/knowledge/stats`、`GET /api/knowledge/documents?kw=...&page=1`、`GET /api/knowledge/documents/:id?page=1`。

实际导入报告见 [import-latest.json](knowledge-sources/import-latest.json)。导入前后有名称的业务实体均为 **49,439**，没有新增或覆盖疾病事实。后端与前端已部署到现有 `kind-medibrain-prod` 集群，各 2 个副本。

[在线验收报告](knowledge-sources/acceptance-latest.json)记录了登录保护、统计、中文及英文全文检索、摘要校验值、PDF 第 1 和 109 页内容校验、页码越界与缺失资料处理、WHO 草稿标记、问答来源卡片测试。临时测试账号及记录已清理。浏览器验证了脑卒中资料检索、官方链接、PDF 翻页与无文字页提示，截图见 [资料库页面](screenshots/knowledge-library-2026-10-11.png)。

重复执行导入后，[数据库核验报告](knowledge-sources/database-verification-latest.json)确认文档仍为 1,024、页面节点和页码关系均为 284，全文索引为 `ONLINE`；所有文档保持待审核，均未设置业务实体的 `名称` 字段。已修正业务图谱列表和质量审计对内部资料节点、页码关系的过滤，避免将这些节点误报为缺少疾病名称。

本次部署镜像：后端 `medibrain-server:knowledge-v2-20261011`，前端 `medibrain-web:knowledge-20261011`。前后端容器构建、后端静态检查及 72 项单元测试通过；部署后各 2 个副本就绪，健康检查正常。在线单次验收中，中文检索约 42 毫秒、资料卡片问答约 384 毫秒、原有图谱问答约 5.35 秒；这组记录是当前环境的功能回归计时，不代表并发压测或延迟分位数。原有图谱问答保持逐条事实引用，并附相关资料卡片。

重新导入时，在项目根目录执行：

```powershell
# 默认只做数据校验和数量演练
node scripts/knowledge-sources/import-library.cjs

# 复用已有集群与数据库，启动本地访问
./scripts/maintenance/start-local-access.ps1 -Dependencies

# 从现有 Kubernetes Secret 在内存中读取认证信息，不输出密码
node scripts/knowledge-sources/import-library.cjs --apply --kubernetes

# 验证实际部署的资料检索与问答卡片，完成后清理自己的测试账号
node scripts/diagnostics/knowledge-library.cjs
```

写入前备份已有资料节点，文档与页面在一个事务内导入；出现不完整写入时回滚。已审核的资料记录会阻止此批量脚本覆盖，需走单独的更新审核流程。默认演练不连接数据库。

### 后续临床事实接入

1. 对照现有疾病节点确认名称、分型与范围，避免新增同名冲突实体。
2. 优先复核 3 条中文释义草稿；其余英语摘要须翻译并核对中国适用规范，尤其是诊断阈值和人群差异。
3. 食养内容需保留来源页码、人群、疾病阶段、肾功能或透析状态等条件。不能把食谱示例直接转换为无条件的“宜吃 / 忌吃”边。
4. 专业复核后的变更应逐条保存原文位置、版本、审核人、审核时间和变更前内容，再通过具有索引同步的正式写入路径更新图谱与向量索引。

所有结构化候选均为 `review.status = pending`、`publishToQa = false`。资料库允许检索原文，但不会把这些候选自动发布为临床事实。本次未制作医学专业审核记录，也未使用旧的 `scripts/graph-expansion/import.js` 导入候选。该旧脚本会覆盖同名节点属性，不适合承接未经复核的外部资料。

生成文件重新采集时会更新，后续审核记录应独立存放，避免写在会被重新生成的数据文件中。

## 使用条件与来源边界

- MedlinePlus [内容使用政策](https://medlineplus.gov/about/using/usingcontent/)明确健康主题摘要属于公共领域内容。本数据包保留 `Source: MedlinePlus, National Library of Medicine.` 署名；其链接指向的 A.D.A.M. 百科、ASHP 药物专论等另有权利限制，未采集正文。
- 国家卫健委资料保留官方原件供本地核验。目录没有把“公开发布”标记为“可无限制商业转载”；后续批量分发正文前应核对具体材料条件。
- WHO 目前只保留来源元数据和少量释义草稿，没有复制全文。[WHO 版权政策](https://www.who.int/about/policies/publishing/copyright)对不同材料和用途规定不同；草稿仍有使用条件复核项，不代表 WHO 对项目背书。
- [MeSH 官方下载入口](https://www.nlm.nih.gov/databases/download/mesh.html)和 [DailyMed API](https://dailymed.nlm.nih.gov/dailymed/webservices-help/v2/spls_api.cfm)本轮仅登记。没有下载完整术语库或美国药品标签，不能计入已扩充医学事实数量。

## 重新采集与检查

在项目根目录运行。采集与清洗需要 Node.js 20+ 和 Python 3.10+，无需数据库账号或 API Key。

```powershell
node scripts/knowledge-sources/collect-medlineplus.cjs
node scripts/knowledge-sources/collect-references.cjs
python -m unittest discover -s scripts/knowledge-sources -p 'test_*.py' -v
node scripts/knowledge-sources/validate-staging.cjs
```

PDF 封面检查另需 `pypdf` 与 Poppler。本次使用 Codex 随附运行时完成，项目应用没有新增依赖。环境可直接找到这些工具时可运行：

```powershell
python scripts/knowledge-sources/inspect-pdfs.py --renderer pdftoppm
```

重新采集 PDF 后，应先重新运行封面检查，再运行整包校验。`KNOWLEDGE_PYTHON` 可指定 XML 清洗用 Python 路径。采集器优先复用通过 SHA-256 检验的缓存；`--refresh` 才会重新下载已有原件。遇到访问限制会记录实际状态，不会伪造成功或绕过限制。

本次检查：6 项清洗回归测试通过；整包校验通过。校验涵盖原件哈希、摘要哈希、数量、候选映射、来源链接与待审核状态，**不代替医学内容审核**。
