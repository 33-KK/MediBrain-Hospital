# 事实约束、语音缓存与验收结果

日期：2026-10-08。本机 Docker / kind 集群已恢复。后端运行 `medibrain-server:review-v2-20261008`，前端运行 `medibrain-web:review-20261008`，各 2 个副本就绪；入口为 http://localhost:8090。MongoDB、Redis、Neo4j、Milvus、embedding 和 Ollama 健康检查通过。

## 本轮修复

- 模型仅返回现有事实编号的完整排列；服务端拒绝解释文本、未知编号、重复编号和遗漏项，用图谱原文构造答案。排序最多等待 5 秒，失败返回图谱顺序。
- 每条答案附带 F 编号、实体、关系和方向，前端可以展开完整依据。缺少用药剂量、相互作用等维度时，不用普通药品邻居替代。
- 同文本语音请求共享合成；临时文件通过完整 MP3 帧检查后原子发布，失败清理半成品，损坏缓存重新生成。
- 默认缓存 24 小时、512 个文件 / 256 MiB；每副本最多同时合成 2 个不同文本。缓存按最近访问时间在启动和请求时清理，各副本独立。
- 疾病详情和回答排除指向自身的疾病并发症关系。重复“胎膜早破”的两份记录存在属性冲突，回答和详情显示待专业复核；按名称修改、删除及增删歧义关系均被拒绝。原始节点和关系保留。
- 修复同名疾病被症状标签覆盖的问题：实体词典保留疾病身份，加载顺序不会绕过疾病冲突检查。其他实体歧义和意图识别仍需逐步扩展验收。
- HTML 禁止缓存，动态资源失效最多自动刷新一次，避免发布后旧 HTML 引用失效资源造成白屏。

事实约束保证返回文字与检索到的图谱记录一致，不证明原始医学记录正确。provider 标记表示参与排序，答案文字由服务端生成。

## 数据出处核验

按用户提供的 [RAGQnASystem 仓库](https://github.com/honeyandme/RAGQnASystem) 固定到提交 `6d91e2ec76f70dd604b8a897a63b2ac6fba3ec95`，核对 `data/medical_new_2.json` 与 `data/medical.json`。两份文件各包含 8,808 条记录，下载内容通过 Git blob SHA-1 和 SHA-256 校验。

当前 8,831 个疾病节点中，8,804 个的名称、简介、病因、预防措施、治疗周期、治愈概率、易感人群七项属性，与 `medical_new_2.json` 完全一致。只为这些节点写入 `_medibrainImportProvenance`，包含仓库、提交、文件、记录序号、内容校验和核验时间；写入前保存元数据备份，写入时校验属性未发生变化。没有修改医学属性或关系。

剩余 27 个节点未完全匹配，包括已扩充 / 改写的记录，保留来源待核验。详见 [比对报告与未匹配清单](acceptance/import-source-latest.json)。导入元数据备份位于报告列出的本机 `data/backups/`，未纳入 Git。

仓库 README 指向 [Open-KG 原始数据集](https://data.openkg.cn/dataset/disease-information)，该页面本次访问返回 502，尚未核验原始医学页面。当前标记只证明七项疾病属性的导入对应关系，不覆盖关系数据，也不等同于医学引用或专业审核。全库仍没有可识别的医学参考文献及专业审核记录。

## 验收证据

| 项目 | 结果与范围 |
| --- | --- |
| 后端检查 | lint / build 通过，10 个套件 66 项单测、13 项原问题回归、1 项接口测试通过。 |
| 前端构建 | 类型检查与 Docker 构建通过，最大 JS 分块约 463 KB。 |
| 真实问答内容 | 62/62 通过；覆盖 4 个疾病的 14 个维度、提示注入、未收录用药维度与冲突疾病；逐条对照 Neo4j。 |
| 自身并发症过滤 | 对实际存在自身并发症关系的 50 个疾病查询详情，均未返回自身并发症。 |
| 浏览器操作 | 临时账号登录、真实提问、4 条依据展开、语音开始和停止播放、冲突疾病详情提示均通过。 |
| 突发并发 | 1 / 2 / 4 / 8 路各 8 个请求，无错误；8 路 P95 3510 ms。 |
| 连续并发 | 4 路 80 个请求，无错误；P95 1168 ms，最大 1219 ms。 |
| 模型冷加载样例 | 卸载 qwen2.5:7b 后请求 5172 ms；未清空操作系统文件缓存，不代表整机冷启动。 |
| 真实语音并发 | 6 个同文本请求均返回完整 MP3；后续缓存读取 20 ms。 |
| 数据结构 | 49,439 个命名节点；缺名称和缺关系端点名称均为 0；1 组同名疾病、50 条自身并发症关系保留供复核。 |
| 导入对应关系 | 8,804 个有效核验标记、0 个过期 / 无效标记、27 个待核验。 |

内容、性能、冷加载按顺序执行。测试阈值与原始样本见 [问答内容报告](acceptance/content-latest.json)、[性能报告](acceptance/performance-latest.json)、[冷加载报告](acceptance/cold-latest.json)。全库结果见 [专业复核清单](acceptance/corpus-quality-latest.json)，最终运行状态见 [运行快照](acceptance/runtime-latest.json)。自动验收是本机小规模测试，不代表生产容量或临床认证。

浏览器证据：[依据展开与播放截图](screenshots/grounded-qa-2026-10-08.png)、[冲突提示截图](screenshots/conflict-review-2026-10-08.png)。中断留下的自建临时账号及本轮测试账号、问答历史均已清理，未清理业务用户。

## 仍需专业处理

临床内容验收保持“待专业审核”：需要复核原始医学内容、27 个未匹配节点、重复“胎膜早破”的两份版本和 50 条自身并发症记录，并为概率、周期等定量信息补充适用条件与医学依据。这些不能仅凭同名或技术检查自动判定正确。

语音仍使用 edge-tts，需要外部网络；Ollama 与 Docker 需保持启动。当前来源标记可通过下列脚本再次检查；医学属性被改动后，标记会失效或被节点编辑替换，不能继续当作已匹配版本。

## 复用命令

```powershell
./scripts/maintenance/start-local-access.ps1 -Dependencies
node scripts/diagnostics/qa-acceptance.cjs content
node scripts/diagnostics/qa-acceptance.cjs performance
node scripts/diagnostics/qa-acceptance.cjs cold
node scripts/diagnostics/content-quality.cjs
node scripts/maintenance/verify-import-source.cjs
# 只有精确匹配才写入导入出处，并在 data/backups 保存元数据备份：
node scripts/maintenance/verify-import-source.cjs --apply
```

问答验收脚本创建并清理自有临时用户和历史。content / performance / cold 顺序执行，避免互相影响性能；cold 会卸载本机配置的 Ollama 模型。全库检查和默认出处比对只读。
